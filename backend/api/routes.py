# backend/api/routes.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from backend.database.engine import async_session
from backend.database.models import NHLPlayer, LeagueMember, RosterPlayer, League, User

router = APIRouter()

async def get_db():
    async with async_session() as session:
        yield session

@router.get("/players")
async def get_players(position: str = None, db: AsyncSession = Depends(get_db)):
    query = select(NHLPlayer).where(NHLPlayer.is_active == True)
    if position:
        query = query.where(NHLPlayer.position == position)
    query = query.order_by(NHLPlayer.price.desc())
    
    result = await db.execute(query)
    players = result.scalars().all()
    
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

@router.get("/my_team")
async def get_my_team(user_id: int, db: AsyncSession = Depends(get_db)):
    # Загружаем состав ВМЕСТЕ с данными игроков (selectinload), чтобы узнать их позицию
    res_member = await db.execute(select(LeagueMember).where(LeagueMember.user_id == user_id))
    member = res_member.scalar_one_or_none()
    
    if not member:
        return {"balance": 10000.0, "roster": []}

    res_roster = await db.execute(
        select(RosterPlayer)
        .options(selectinload(RosterPlayer.player))
        .where(RosterPlayer.member_id == member.id)
    )
    roster = res_roster.scalars().all()
    
    return {
        "balance": member.budget,
        "captain_id": member.captain_id,
        "roster": [{"id": r.player_id, "pos": r.player.position.name} for r in roster]
    }

class SaveTeamRequest(BaseModel):
    user_id: int
    roster_ids: list[int | None]
    balance: float
    captain_id: int | None = None

@router.post("/save_team")
async def save_team(req: SaveTeamRequest, db: AsyncSession = Depends(get_db)):
    user = await db.get(User, req.user_id)
    if not user:
        user = User(id=req.user_id, display_name="Manager")
        db.add(user)
        
    res_league = await db.execute(select(League).where(League.is_global == True))
    global_league = res_league.scalar_one_or_none()
    if not global_league:
        global_league = League(name="General Leaderboard", invite_code="GLOBAL", is_global=True)
        db.add(global_league)
        await db.flush()
        
    res_member = await db.execute(
        select(LeagueMember).where(LeagueMember.user_id == user.id, LeagueMember.league_id == global_league.id)
    )
    member = res_member.scalar_one_or_none()
    if not member:
        member = LeagueMember(league_id=global_league.id, user_id=user.id, budget=req.balance)
        db.add(member)
        await db.flush()
        
    await db.execute(delete(RosterPlayer).where(RosterPlayer.member_id == member.id))
    
    for pid in req.roster_ids:
        if pid is not None:
            player = await db.get(NHLPlayer, pid)
            if player:
                # 🌟 БАГ ПОФИКШЕН: Убрали roster_position
                rp = RosterPlayer(
                    member_id=member.id,
                    player_id=player.id,
                    acquired_price=player.price
                )
                db.add(rp)
                
    member.budget = req.balance
    member.captain_id = req.captain_id
    await db.commit()
    
    return {"status": "success"}