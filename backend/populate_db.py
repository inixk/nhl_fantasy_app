# backend/populate_db.py
import asyncio
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database.engine import init_db, async_session
from database.models import NHLPlayer, PlayerPosition
from services.nhl_api import nhl_api

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def populate():
    # 1. Создаем пустую базу
    await init_db()
    logger.info("Database tables created.")
    
    # 2. Скачиваем ростеры
    logger.info("Fetching NHL rosters...")
    players_data = await nhl_api.get_all_teams_roster("20242025")
    
    async with async_session() as session:
        for p in players_data:
            player_id = p.get("id")
            if not player_id: continue
            
            existing = await session.get(NHLPlayer, player_id)
            
            # Объединяем нападающих в F
            pos_code = p.get("positionCode", "C")
            if pos_code in ["C", "L", "R"]:
                position = PlayerPosition.F
            elif pos_code == "D":
                position = PlayerPosition.D
            else:
                position = PlayerPosition.G
                
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
                    price=1000.0 # Базовая цена
                )
                session.add(new_player)
        await session.commit()
        logger.info(f"Added {len(players_data)} players to DB.")

    # 3. Вычисляем стартовые цены на бирже (Минимум 1000 FC)
    logger.info("Calculating Fantasy Prices...")
    async with async_session() as session:
        result = await session.execute(select(NHLPlayer))
        all_players = result.scalars().all()
        
        for player in all_players:
            stats = await nhl_api.get_player_info(player.id)
            if not stats: continue
            
            featured = stats.get("featuredStats", {}).get("regularSeason", {}).get("subSeason", {})
            points = 0.0
            gp = featured.get("gamesPlayed", 0)
            
            # Приближенная оценка для стартовой цены
            if player.position == PlayerPosition.G:
                wins = featured.get("wins", 0)
                shutouts = featured.get("shutouts", 0)
                gaa = featured.get("goalsAgainstAvg", 0)
                sv_pct = featured.get("savePctg", 0.0)
                
                ga = gaa * gp
                saves = ((sv_pct * ga) / (1 - sv_pct)) if (1 - sv_pct) > 0 else 0
                
                points += saves * 0.2
                points -= ga * 2.0
                points += shutouts * 10.0
                points += wins * 5.0
            else:
                points += featured.get("goals", 0) * 8.0
                points += featured.get("assists", 0) * 4.0
                points += featured.get("plusMinus", 0) * 1.0
                points += featured.get("powerPlayPoints", 0) * 2.0
            
            # Экстраполируем очки на 82 матча
            if gp > 0:
                expected_season_pts = (points / gp) * 82.0
            else:
                expected_season_pts = 0
                
            player.fantasy_points = points
            player.games_played = gp
            player.price = max(1000.0, round(expected_season_pts))
            
        await session.commit()
        logger.info("Prices calculated and saved!")

    await nhl_api.close()

if __name__ == "__main__":
    asyncio.run(populate())