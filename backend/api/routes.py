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

from pydantic import BaseModel
from fastapi import HTTPException
from backend.database.models import LeagueMember, RosterPlayer

# Модель для принятия данных с сайта
class SaveTeamRequest(BaseModel):
    user_id: int
    roster_ids: list[int] # Список из 17 ID игроков
    balance: float

@router.post("/save_team")
async def save_team(req: SaveTeamRequest, db: AsyncSession = Depends(get_db)):
    """Сохраняет состав пользователя в базу данных"""
    # Для MVP просто ищем пользователя в "Глобальной Лиге" (создадим ее, если нет)
    from backend.database.models import League, User
    
    # 1. Проверяем юзера
    user = await db.get(User, req.user_id)
    if not user:
        # Если юзера нет в базе (он не нажимал /start), создадим его
        user = User(id=req.user_id, display_name="Manager")
        db.add(user)
        
    # 2. Ищем глобальную лигу
    res_league = await db.execute(select(League).where(League.is_global == True))
    global_league = res_league.scalar_one_or_none()
    if not global_league:
        global_league = League(name="General Leaderboard", invite_code="GLOBAL", is_global=True)
        db.add(global_league)
        await db.flush()
        
    # 3. Ищем профиль юзера в этой лиге
    res_member = await db.execute(
        select(LeagueMember).where(LeagueMember.user_id == user.id, LeagueMember.league_id == global_league.id)
    )
    member = res_member.scalar_one_or_none()
    if not member:
        member = LeagueMember(league_id=global_league.id, user_id=user.id, budget=req.balance)
        db.add(member)
        await db.flush()
        
    # 4. Сохраняем РОСТЕР
    # Удаляем старый
    from sqlalchemy import delete
    await db.execute(delete(RosterPlayer).where(RosterPlayer.member_id == member.id))
    
    # Добавляем новый
    for pid in req.roster_ids:
        if pid is not None:
            # Получаем игрока, чтобы узнать позицию и цену покупки
            player = await db.get(NHLPlayer, pid)
            if player:
                rp = RosterPlayer(
                    member_id=member.id,
                    player_id=player.id,
                    roster_position=player.position.name,
                    acquired_price=player.price
                )
                db.add(rp)
                
    # Обновляем баланс
    member.budget = req.balance
    await db.commit()
    
    return {"status": "success", "message": "Team saved!"}