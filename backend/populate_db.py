# backend/populate_db.py
import asyncio
import logging
import math # 🌟 ДОБАВЛЕН ИМПОРТ MATH ДЛЯ ОКРУГЛЕНИЯ
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database.engine import init_db, async_session
from backend.database.models import NHLPlayer, PlayerPosition
from backend.services.nhl_api import nhl_api

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def populate():
    await init_db()
    logger.info("Database tables created.")
    
    current_season = "20252026"
    logger.info(f"Fetching NHL rosters for {current_season}...")
    players_data = await nhl_api.get_all_teams_roster(current_season)
    
    async with async_session() as session:
        for p in players_data:
            player_id = p.get("id")
            if not player_id: continue
            
            existing = await session.get(NHLPlayer, player_id)
            
            pos_code = p.get("positionCode", "C")
            if pos_code in ["C", "L", "R"]: position = PlayerPosition.F
            elif pos_code == "D": position = PlayerPosition.D
            else: position = PlayerPosition.G
                
            first = p.get("firstName", {}).get("default", "")
            last = p.get("lastName", {}).get("default", "")
            full_name = f"{first} {last}"
            
            if not existing:
                new_player = NHLPlayer(
                    id=player_id,
                    full_name=full_name,
                    team_abbr=p.get("team_abbr", ""),
                    position=position,
                    headshot_url=p.get("headshot", ""),
                    price=400.0 # Базовая минималка до расчета
                )
                session.add(new_player)
        await session.commit()

    logger.info(f"Calculating Prices and ZEROING stats for Season Start...")
    async with async_session() as session:
        result = await session.execute(select(NHLPlayer))
        all_players = result.scalars().all()
        
        for player in all_players:
            game_log = await nhl_api._request(f"player/{player.id}/game-log/{current_season}/2")
            if not game_log or "gameLog" not in game_log:
                # Если игрок вообще не играл в прошлом сезоне, ставим ему минималку 400 FC
                player.price = 400.0
                player.fantasy_points = 0.0
                player.games_played = 0
                continue
                
            games = game_log["gameLog"]
            gp = len(games)
            points = 0.0
            
            for g in games:
                if player.position == PlayerPosition.G:
                    saves = g.get("saves", 0)
                    ga = g.get("goalsAgainst", 0)
                    shutout = g.get("shutouts", 0)
                    win = g.get("decision") == "W"
                    # Баффнутые статы вратарей
                    points += (saves * 0.4) - (ga * 1.0)
                    if shutout > 0: points += 10.0
                    if win: points += 6.0
                else:
                    goals = g.get("goals", 0)
                    assists = g.get("assists", 0)
                    pm = g.get("plusMinus", 0)
                    ppg = g.get("powerPlayGoals", 0)
                    shg = g.get("shorthandedGoals", 0)
                    gwg = g.get("gameWinningGoals", 0)
                    otg = g.get("otGoals", 0)
                    points += (goals * 8.0) + (assists * 4.0) + (pm * 1.0)
                    points += (ppg * 2.0) + (shg * 4.0) + (gwg * 2.0) + (otg * 2.0)
            
            if gp > 0:
                expected_season_pts = (points / gp) * 82.0
            else:
                expected_season_pts = 0
                
            # 🌟 ФОРМУЛА СТОИМОСТИ (Множитель 1.8 + 100 FC + Округление до сотен ВВЕРХ)
            raw_price = (expected_season_pts * 1.8) + 100
            final_price = math.ceil(raw_price / 100) * 100
            
            # Минимальная цена - 400 FC
            player.price = max(400.0, float(final_price))
            
            # 🌟 ОБНУЛЯЕМ ОЧКИ! (Симулируем старт сезона)
            player.fantasy_points = 0.0
            player.games_played = 0
            
        await session.commit()
        logger.info("Database is ready for Season Start! 0 Points, Calculated Prices.")

    await nhl_api.close()

if __name__ == "__main__":
    asyncio.run(populate())