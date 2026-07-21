# backend/populate_db.py
import asyncio
import logging
import math
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
    
    # 🌟 АКТУАЛЬНЫЙ СЕЗОН (Подготовка к 2026/2027)
    current_season = "20262027"
    past_season = "20252026" # Прошлый сезон для расчета цен
    
    logger.info(f"Fetching NHL rosters for {current_season}...")
    players_data = await nhl_api.get_all_teams_roster(current_season)
    
    # Если НХЛ еще не обновила ростеры на 26/27, API может вернуть пустоту.
    # Перестрахуемся и возьмем 25/26, если данных нет.
    if not players_data:
        logger.warning(f"No rosters for {current_season}. Falling back to {past_season}...")
        players_data = await nhl_api.get_all_teams_roster(past_season)
    
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
                    id=player_id, full_name=full_name, team_abbr=p.get("team_abbr", ""),
                    position=position, headshot_url=p.get("headshot", ""), price=400.0
                )
                session.add(new_player)
        await session.commit()

    logger.info(f"Calculating Prices based on past performance and ZEROING stats for Season Start...")
    async with async_session() as session:
        result = await session.execute(select(NHLPlayer))
        all_players = result.scalars().all()
        
        for player in all_players:
            # Спрашиваем статистику за ПРОШЛЫЙ сезон для цены
            game_log = await nhl_api._request(f"player/{player.id}/game-log/{past_season}/2")
            if not game_log or "gameLog" not in game_log:
                player.price = 400.0
                player.fantasy_points = 0.0
                player.games_played = 0
                continue
                
            games = game_log["gameLog"]
            gp = len(games)
            points = 0.0
            
            for g in games:
                if player.position == PlayerPosition.G:
                    saves, ga, shutout = g.get("saves", 0), g.get("goalsAgainst", 0), g.get("shutouts", 0)
                    win = g.get("decision") == "W"
                    points += (saves * 0.4) - (ga * 1.0)
                    if shutout > 0: points += 10.0
                    if win: points += 6.0
                else:
                    points += (g.get("goals", 0) * 8.0) + (g.get("assists", 0) * 4.0) + (g.get("plusMinus", 0) * 1.0)
                    points += (g.get("powerPlayGoals", 0) * 2.0) + (g.get("shorthandedGoals", 0) * 4.0)
                    points += (g.get("gameWinningGoals", 0) * 2.0) + (g.get("otGoals", 0) * 2.0)
            
            expected_season_pts = (points / gp) * 82.0 if gp > 0 else 0
            
            # Индексация 1.1 и округление до сотен вверх
            raw_price = (expected_season_pts * 1.1) + 100
            final_price = math.ceil(raw_price / 100) * 100
            
            player.price = max(400.0, float(final_price))
            
            # 🌟 ОБНУЛЯЕМ ОЧКИ! База готова к первому дню сезона.
            player.fantasy_points = 0.0
            player.games_played = 0
            
        await session.commit()
        logger.info("Database is ready for Season Start! 0 Points, Calculated Prices.")

    await nhl_api.close()

if __name__ == "__main__":
    asyncio.run(populate())