# backend/api/routes.py
import random
import string
import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, desc
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from datetime import datetime

from backend.database.engine import async_session
from backend.database.models import NHLPlayer, LeagueMember, RosterPlayer, League, User
from backend.services.nhl_api import nhl_api

router = APIRouter()
logger = logging.getLogger(__name__)

async def get_db():
    async with async_session() as session:
        yield session

class SaveTeamRequest(BaseModel):
    user_id: int
    user_name: str
    roster_ids: list[int | None]
    balance: float
    captain_id: int | None = None

class CreateLeagueRequest(BaseModel):
    user_id: int
    user_name: str
    name: str
    team_name: str

class JoinLeagueRequest(BaseModel):
    user_id: int
    user_name: str
    invite_code: str
    team_name: str

async def get_or_create_user(db: AsyncSession, user_id: int, user_name: str):
    user = await db.get(User, user_id)
    if not user:
        user = User(id=user_id, display_name=user_name)
        db.add(user)
    else:
        user.display_name = user_name
    return user

@router.get("/players")
async def get_players(position: str = None, db: AsyncSession = Depends(get_db)):
    query = select(NHLPlayer).where(NHLPlayer.is_active == True)
    if position: query = query.where(NHLPlayer.position == position)
    query = query.order_by(NHLPlayer.price.desc())
    result = await db.execute(query)
    return [{"id": p.id, "name": p.full_name, "team": p.team_abbr, "position": p.position.name, "price": p.price, "points": p.fantasy_points, "photo": p.headshot_url} for p in result.scalars().all()]

@router.get("/my_team")
async def get_my_team(user_id: int, db: AsyncSession = Depends(get_db)):
    # 🌟 ЖЕСТКИЙ ФИКС ОШИБКИ 500: Сначала ищем глобальную лигу!
    res_league = await db.execute(select(League).where(League.is_global == True))
    global_league = res_league.scalar_one_or_none()
    
    if not global_league:
        return {"balance": 10000.0, "roster": [], "captain_id": None, "transfers_used": 0, "captain_changes": 0}

    # Теперь ищем юзера ИМЕННО в глобальной лиге
    res_member = await db.execute(
        select(LeagueMember).where(LeagueMember.user_id == user_id, LeagueMember.league_id == global_league.id)
    )
    member = res_member.scalar_one_or_none()
    
    if not member:
        return {"balance": 10000.0, "roster": [], "captain_id": None, "transfers_used": 0, "captain_changes": 0}

    res_roster = await db.execute(
        select(RosterPlayer).options(selectinload(RosterPlayer.player)).where(RosterPlayer.member_id == member.id)
    )
    roster = res_roster.scalars().all()
    
    return {
        "balance": member.budget,
        "captain_id": member.captain_id,
        "transfers_used": member.transfers_used,
        "captain_changes": member.captain_changes_used, # Отдаем фронтенду
        "roster": [{"id": r.player_id, "pos": r.player.position.name} for r in roster]
    }

@router.post("/save_team")
async def save_team(req: SaveTeamRequest, db: AsyncSession = Depends(get_db)):
    try:
        user = await get_or_create_user(db, req.user_id, req.user_name)
        res_league = await db.execute(select(League).where(League.is_global == True))
        global_league = res_league.scalar_one_or_none()
        if not global_league:
            global_league = League(name="General Leaderboard", invite_code="GLOBAL", is_global=True)
            db.add(global_league)
            await db.flush()
            
        res_member = await db.execute(select(LeagueMember).where(LeagueMember.user_id == user.id, LeagueMember.league_id == global_league.id))
        member = res_member.scalar_one_or_none()
        if not member:
            member = LeagueMember(league_id=global_league.id, user_id=user.id, budget=req.balance)
            db.add(member)
            await db.flush()
            
        # 🌟 ИДЕАЛЬНАЯ ЛОГИКА ТРАНСФЕРОВ И КАПИТАНА 🌟
        res_old_roster = await db.execute(select(RosterPlayer).where(RosterPlayer.member_id == member.id))
        old_roster = res_old_roster.scalars().all()
        old_ids = set([r.player_id for r in old_roster])
        new_ids = set([pid for pid in req.roster_ids if pid is not None])
        
        # Если старый состав меньше 17 человек — это бесплатный стартовый драфт!
        is_initial_draft = len(old_ids) < 17 
        
        if not is_initial_draft:
            # 1. Проверяем замены игроков
            new_players_added = len(new_ids - old_ids)
            if member.transfers_used + new_players_added > 6:
                raise HTTPException(status_code=400, detail=f"Превышен лимит замен! Доступно: {6 - member.transfers_used}")
            member.transfers_used += new_players_added
            
            # 2. Проверяем смену капитана
            if req.captain_id and req.captain_id != member.captain_id:
                if member.captain_changes_used >= 1:
                    raise HTTPException(status_code=400, detail="Превышен лимит! Капитана можно менять 1 раз в неделю.")
                member.captain_changes_used += 1
                
        # Перезаписываем ростер
        await db.execute(delete(RosterPlayer).where(RosterPlayer.member_id == member.id))
        for pid in req.roster_ids:
            if pid is not None:
                player = await db.get(NHLPlayer, pid)
                if player: 
                    db.add(RosterPlayer(member_id=member.id, player_id=player.id, acquired_price=player.price))
                    
        member.budget = req.balance
        member.captain_id = req.captain_id
        await db.commit()
        return {"status": "success"}
        
    except HTTPException:
        raise # Пробрасываем HTTP-ошибки на фронтенд как есть
    except Exception as e:
        logger.error(f"Save Team Error: {str(e)}")
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")

@router.get("/nhl/standings")
async def get_nhl_standings():
    data = await nhl_api.get_standings()
    if not data or "standings" not in data: raise HTTPException(status_code=500, detail="Failed to fetch standings")
    return data["standings"]

# 🌟 УНИВЕРСАЛЬНЫЙ ПАРСЕР ИМЕН ДЛЯ НХЛ
def get_player_name(obj_data: dict) -> str:
    if not obj_data: return "Unknown"
    # Проверяем формат {"name": {"default": "Имя"}}
    if "name" in obj_data and isinstance(obj_data["name"], dict):
        return obj_data["name"].get("default", "Unknown")
    # Проверяем формат {"firstName": {"default": "Имя"}, "lastName": ...}
    first = obj_data.get("firstName", {}).get("default", "")
    last = obj_data.get("lastName", {}).get("default", "")
    if first and last: return f"{first[0]}. {last}"
    if last: return last
    return "Unknown"

@router.get("/nhl/scores")
async def get_nhl_scores(date: str = "now"):
    schedule = await nhl_api.get_schedule(date)
    if not schedule or "gameWeek" not in schedule: return []
    target_games = []
    for day in schedule["gameWeek"]:
        if date == "now" or day["date"] == date:
            target_games = day.get("games", [])
            break
    if not target_games: return []
    
    async def fetch_game_details(game):
        g_id = game["id"]
        state = game.get("gameState", "")
        home = game.get("homeTeam", {}).get("abbrev", "TBD")
        away = game.get("awayTeam", {}).get("abbrev", "TBD")
        home_score = game.get("homeTeam", {}).get("score", 0)
        away_score = game.get("awayTeam", {}).get("score", 0)
        status = "Scheduled"
        if state in ("LIVE", "CRIT"):
            period = game.get("periodDescriptor", {}).get("number", 0)
            clock = game.get("clock", {}).get("timeRemaining", "")
            status = f"🔴 P{period} {clock}"
        elif state in ("FINAL", "OFF"): status = "✅ FINAL"
        game_data = {"id": g_id, "home": home, "away": away, "home_score": home_score, "away_score": away_score, "status": status, "goals": [], "goalies": [], "three_stars": []}
        
        if state in ("LIVE", "CRIT", "FINAL", "OFF"):
            boxscore, landing = await asyncio.gather(nhl_api.get_game_boxscore(g_id), nhl_api.get_game_landing(g_id))
            if landing and "summary" in landing:
                if "scoring" in landing["summary"]:
                    for p in landing["summary"]["scoring"]:
                        period_name = p.get("periodDescriptor", {}).get("periodType", "")
                        period_num = p.get("periodDescriptor", {}).get("number", 0)
                        p_title = "Овертайм" if period_name == "OT" else ("Буллиты" if period_name == "SO" else f"{period_num} Период")
                        goals_list = p.get("goals", [])
                        if goals_list:
                            game_data["goals"].append(f"<div class='period-divider'>{p_title}</div>")
                            for g in goals_list:
                                team_abbrev = g.get("teamAbbrev", {}).get("default", "TBD") if isinstance(g.get("teamAbbrev"), dict) else g.get("teamAbbrev", "TBD")
                                time = g.get("timeInPeriod", "00:00")
                                scorer = get_player_name(g)
                                assists = [get_player_name(a) for a in g.get("assists", [])]
                                ast_str = f" ({', '.join(assists)})" if assists else ""
                                game_data["goals"].append(f"<b>{team_abbrev}</b> {time} - {scorer}{ast_str}")
                if "threeStars" in landing["summary"]:
                    for star in landing["summary"]["threeStars"]:
                        star_num = star.get("star", "?")
                        team_abbrev = star.get("teamAbbrev", "TBD")
                        star_name = get_player_name(star)
                        icons = "⭐" * (4 - int(star_num)) if str(star_num).isdigit() else "⭐"
                        game_data["three_stars"].append(f"{icons} <b>{star_name}</b> ({team_abbrev})")
            if boxscore and "playerByGameStats" in boxscore:
                for team_key, t_abbr in [("awayTeam", away), ("homeTeam", home)]:
                    for go in boxscore["playerByGameStats"].get(team_key, {}).get("goalies", []):
                        g_name = get_player_name(go)
                        sa, sv, sv_pct = go.get("shotsAgainst", 0), go.get("saves", 0), go.get("savePctg", "0.000")
                        sv_pct_str = f"{float(sv_pct):.3f}" if sv_pct else "0.000"
                        if sa > 0 or go.get("timeOnIce", "00:00") != "00:00":
                            game_data["goalies"].append(f"<b>{t_abbr}</b> {g_name}: {sv}/{sa} SV ({sv_pct_str})")
        return game_data
    tasks = [fetch_game_details(g) for g in target_games]
    return await asyncio.gather(*tasks)

@router.get("/nhl/leaders")
async def get_nhl_leaders(category: str):
    now = datetime.utcnow()
    season = f"{now.year}{now.year+1}" if now.month >= 9 else f"{now.year-1}{now.year}"
    if category == "points": return await nhl_api.get_skater_stats(season, "points")
    elif category == "goals": return await nhl_api.get_skater_stats(season, "goals")
    elif category == "assists": return await nhl_api.get_skater_stats(season, "assists")
    elif category == "russians": return await nhl_api.get_skater_stats(season, "points", nationalities=["RUS", "BLR"])
    elif category == "sv_pct": return await nhl_api.get_goalie_stats(season, "savePct")
    elif category == "gaa": return await nhl_api.get_goalie_stats(season, "goalsAgainstAverage")
    return []

def generate_invite_code(length=8):
    return ''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(length))

@router.get("/leagues/general")
async def get_general_leaderboard(user_id: int, db: AsyncSession = Depends(get_db)):
    res_league = await db.execute(select(League).where(League.is_global == True))
    global_league = res_league.scalar_one_or_none()
    if not global_league: return {"leaderboard": [], "user_rank": None}
    res_members = await db.execute(select(LeagueMember, User).join(User, LeagueMember.user_id == User.id).where(LeagueMember.league_id == global_league.id).order_by(desc(LeagueMember.total_points)))
    leaderboard, user_rank = [], None
    for rank, (member, user) in enumerate(res_members, start=1):
        team_name = member.team_name if member.team_name != "My Team" else f"{user.display_name}'s Team"
        if member.user_id == user_id: user_rank = {"rank": rank, "name": team_name, "manager": user.display_name, "points": member.total_points}
        if rank <= 100: leaderboard.append({"rank": rank, "name": team_name, "manager": user.display_name, "points": member.total_points, "is_me": member.user_id == user_id})
    return {"leaderboard": leaderboard, "user_rank": user_rank}

# 🌟 ОБНОВЛЕНО: ТЕПЕРЬ ПОКАЗЫВАЕМ ТОП МЕНЕДЖЕРА ЛИГИ
@router.get("/leagues/my")
async def get_my_leagues(user_id: int, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(League).join(LeagueMember).where(LeagueMember.user_id == user_id, League.is_global == False))
    leagues = res.scalars().all()
    result = []
    for l in leagues:
        # Ищем лидера этой лиги
        top_res = await db.execute(select(LeagueMember).where(LeagueMember.league_id == l.id).order_by(desc(LeagueMember.total_points)).limit(1))
        top_member = top_res.scalar_one_or_none()
        top_text = f"Top: {top_member.team_name} ({round(top_member.total_points)} FC)" if top_member else "No members"
        result.append({"id": l.id, "name": l.name, "invite_code": l.invite_code, "top_manager": top_text})
    return result

@router.post("/leagues/create")
async def create_league(req: CreateLeagueRequest, db: AsyncSession = Depends(get_db)):
    await get_or_create_user(db, req.user_id, req.user_name)
    invite_code = generate_invite_code()
    while (await db.execute(select(League).where(League.invite_code == invite_code))).scalar_one_or_none():
        invite_code = generate_invite_code()
    new_league = League(name=req.name, invite_code=invite_code, is_global=False)
    db.add(new_league)
    await db.flush()
    db.add(LeagueMember(league_id=new_league.id, user_id=req.user_id, team_name=req.team_name))
    await db.commit()
    return {"status": "success", "league_id": new_league.id, "invite_code": invite_code}

@router.post("/leagues/join")
async def join_league(req: JoinLeagueRequest, db: AsyncSession = Depends(get_db)):
    await get_or_create_user(db, req.user_id, req.user_name)
    res_league = await db.execute(select(League).where(League.invite_code == req.invite_code.upper()))
    league = res_league.scalar_one_or_none()
    if not league: raise HTTPException(status_code=404, detail="Лига не найдена.")
    res_member = await db.execute(select(LeagueMember).where(LeagueMember.league_id == league.id, LeagueMember.user_id == req.user_id))
    if res_member.scalar_one_or_none(): raise HTTPException(status_code=400, detail="Вы уже в этой лиге!")
    db.add(LeagueMember(league_id=league.id, user_id=req.user_id, team_name=req.team_name))
    await db.commit()
    return {"status": "success", "league_name": league.name}

@router.get("/leagues/{league_id}/leaderboard")
async def get_league_leaderboard(league_id: int, user_id: int, db: AsyncSession = Depends(get_db)):
    res_members = await db.execute(select(LeagueMember, User).join(User, LeagueMember.user_id == User.id).where(LeagueMember.league_id == league_id).order_by(desc(LeagueMember.total_points)))
    leaderboard = [{"rank": rank, "name": member.team_name, "manager": user.display_name, "points": member.total_points, "is_me": member.user_id == user_id} for rank, (member, user) in enumerate(res_members, start=1)]
    return {"leaderboard": leaderboard}