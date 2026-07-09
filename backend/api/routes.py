# backend/api/routes.py
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database.engine import async_session
from backend.database.models import NHLPlayer

router = APIRouter()

# Функция-зависимость для получения сессии базы данных
async def get_db():
    async with async_session() as session:
        yield session

@router.get("/players")
async def get_players(position: str = None, db: AsyncSession = Depends(get_db)):
    """
    Возвращает список всех активных игроков. 
    Можно отфильтровать по позиции (?position=F)
    """
    query = select(NHLPlayer).where(NHLPlayer.is_active == True)
    
    if position:
        query = query.where(NHLPlayer.position == position)
        
    # Сортируем от самых дорогих к дешевым
    query = query.order_by(NHLPlayer.price.desc())
    
    result = await db.execute(query)
    players = result.scalars().all()
    
    # Формируем красивый JSON-ответ
    response = []
    for p in players:
        response.append({
            "id": p.id,
            "name": p.full_name,
            "team": p.team_abbr,
            "position": p.position.name,
            "price": p.price,
            "points": p.fantasy_points,
            "photo": p.headshot_url
        })
        
    return response