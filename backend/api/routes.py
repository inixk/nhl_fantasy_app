# backend/api/routes.py
import asyncio
import random
import string

from sqlalchemy import desc
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from backend.database.engine import async_session
from backend.database.models import NHLPlayer, LeagueMember, RosterPlayer, League, User

# 🌟 ИМПОРТ API НХЛ ДЛЯ ТАБЛИЦ
from backend.services.nhl_api import nhl_api

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
    res_member = await db.execute(select(LeagueMember).where(LeagueMember.user_id == user_id))
    member = res_member.scalar_one_or_none()
    
    if not member:
        return {"balance": 10000.0, "roster": [], "captain_id": None}

    res_roster = await db.execute(
        select(RosterPlayer).options(selectinload(RosterPlayer.player)).where(RosterPlayer.member_id == member.id)
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
                rp = RosterPlayer(member_id=member.id, player_id=player.id, acquired_price=player.price)
                db.add(rp)
                
    member.budget = req.balance
    member.captain_id = req.captain_id
    await db.commit()
    
    return {"status": "success"}

# 🌟 НАШ НОВЫЙ ЭНДПОИНТ ДЛЯ ТАБЛИЦ НХЛ
@router.get("/nhl/standings")
async def get_nhl_standings():
    """Возвращает актуальную таблицу НХЛ (проксируем оригинальное API)"""
    data = await nhl_api.get_standings()
    if not data or "standings" not in data:
        raise HTTPException(status_code=500, detail="Failed to fetch standings")
    return data["standings"]

from datetime import datetime

@router.get("/nhl/leaders")
async def get_nhl_leaders(category: str):
    """Отдает списки Топ-20 по выбранной категории"""
    now = datetime.utcnow()
    season = f"{now.year}{now.year+1}" if now.month >= 9 else f"{now.year-1}{now.year}"
    
    if category == "points":
        return await nhl_api.get_skater_stats(season, "points")
    elif category == "goals":
        return await nhl_api.get_skater_stats(season, "goals")
    elif category == "assists":
        return await nhl_api.get_skater_stats(season, "assists")
    elif category == "russians":
        return await nhl_api.get_skater_stats(season, "points", nationalities=["RUS", "BLR"])
    elif category == "sv_pct":
        return await nhl_api.get_goalie_stats(season, "savePct")
    elif category == "gaa":
        return await nhl_api.get_goalie_stats(season, "goalsAgainstAverage")
    
    return []

@router.get("/nhl/scores")
async def get_nhl_scores(date: str = "now"):
    """Возвращает матчи на выбранную дату с авторами голов, вратарями и Тремя звездами"""
    schedule = await nhl_api.get_schedule(date)
    if not schedule or "gameWeek" not in schedule:
        return []
        
    target_games = []
    for day in schedule["gameWeek"]:
        if date == "now" or day["date"] == date:
            target_games = day.get("games", [])
            break
            
    if not target_games:
        return []
        
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
        elif state in ("FINAL", "OFF"):
            status = "✅ FINAL"
            
        game_data = {
            "id": g_id, "home": home, "away": away,
            "home_score": home_score, "away_score": away_score,
            "status": status, "startTimeUTC": game.get("startTimeUTC", ""),
            "goals": [], "goalies": [], "three_stars": [] # 🌟 ДОБАВЛЕН НОВЫЙ КЛЮЧ
        }
        
        if state in ("LIVE", "CRIT", "FINAL", "OFF"):
            boxscore, landing = await asyncio.gather(
                nhl_api.get_game_boxscore(g_id),
                nhl_api.get_game_landing(g_id)
            )
            
            if landing and "summary" in landing:
                # ПАРСИНГ ГОЛОВ
                if "scoring" in landing["summary"]:
                    for p in landing["summary"]["scoring"]:
                        period_name = p.get("periodDescriptor", {}).get("periodType", "")
                        period_num = p.get("periodDescriptor", {}).get("number", 0)
                        
                        if period_name == "OT": p_title = "Овертайм"
                        elif period_name == "SO": p_title = "Буллиты"
                        else: p_title = f"{period_num} Период"
                            
                        goals_list = p.get("goals", [])
                        if goals_list:
                            game_data["goals"].append(f"<div class='period-divider'>{p_title}</div>")
                            for g in goals_list:
                                team_dict = g.get("teamAbbrev", {})
                                team_abbrev = team_dict.get("default", "TBD") if isinstance(team_dict, dict) else team_dict
                                time = g.get("timeInPeriod", "00:00")
                                
                                name_dict = g.get("name", {})
                                if isinstance(name_dict, dict) and "default" in name_dict:
                                    scorer = name_dict["default"]
                                else:
                                    s_first = g.get("firstName", {}).get("default", "")
                                    s_last = g.get("lastName", {}).get("default", "")
                                    scorer = f"{s_first[0]}. {s_last}" if s_first else (s_last or "Unknown")
                                
                                assists = []
                                for a in g.get("assists", []):
                                    a_name_dict = a.get("name", {})
                                    if isinstance(a_name_dict, dict) and "default" in a_name_dict:
                                        assists.append(a_name_dict["default"])
                                    else:
                                        a_first = a.get("firstName", {}).get("default", "")
                                        a_last = a.get("lastName", {}).get("default", "")
                                        assists.append(f"{a_first[0]}. {a_last}" if a_first else a_last)
                                
                                ast_str = f" ({', '.join(assists)})" if assists else ""
                                game_data["goals"].append(f"<b>{team_abbrev}</b> {time} - {scorer}{ast_str}")
                
                # 🌟 ПАРСИНГ ТРЕХ ЗВЕЗД
                if "threeStars" in landing["summary"]:
                    for star in landing["summary"]["threeStars"]:
                        star_num = star.get("star", "?")
                        team_abbrev = star.get("teamAbbrev", "TBD")
                        
                        name_dict = star.get("name", {})
                        if isinstance(name_dict, dict) and "default" in name_dict:
                            star_name = name_dict["default"]
                        else:
                            s_first = star.get("firstName", {}).get("default", "")
                            s_last = star.get("lastName", {}).get("default", "")
                            star_name = f"{s_first[0]}. {s_last}" if s_first else (s_last or "Unknown")
                            
                        # Если 1-я звезда, рисуем 3 эмодзи, если 2-я - два и т.д.
                        icons = "⭐" * (4 - int(star_num)) if str(star_num).isdigit() else "⭐"
                        game_data["three_stars"].append(f"{icons} <b>{star_name}</b> ({team_abbrev})")

            # ПАРСИНГ ВРАТАРЕЙ
            if boxscore and "playerByGameStats" in boxscore:
                for team_key, t_abbr in [("awayTeam", away), ("homeTeam", home)]:
                    goalies = boxscore["playerByGameStats"].get(team_key, {}).get("goalies", [])
                    for go in goalies:
                        name_dict = go.get("name", {})
                        if isinstance(name_dict, dict) and "default" in name_dict:
                            g_name = name_dict["default"]
                        else:
                            g_first = go.get("firstName", {}).get("default", "")
                            g_last = go.get("lastName", {}).get("default", "")
                            g_name = f"{g_first[0]}. {g_last}" if g_first else (g_last or "Unknown")
                            
                        sa = go.get("shotsAgainst", 0)
                        sv = go.get("saves", 0)
                        sv_pct = go.get("savePctg", "0.000")
                        
                        try:
                            sv_pct_str = f"{float(sv_pct):.3f}"
                        except:
                            sv_pct_str = "0.000"
                            
                        if sa > 0 or go.get("timeOnIce", "00:00") != "00:00":
                            game_data["goalies"].append(f"<b>{t_abbr}</b> {g_name}: {sv}/{sa} SV ({sv_pct_str})")
                            
        return game_data
        
    tasks = [fetch_game_details(g) for g in target_games]
    results = await asyncio.gather(*tasks)
    return results

# ==========================================
# 🏆 ЭНДПОИНТЫ ДЛЯ ЛИГ (LEAGUES)
# ==========================================

class CreateLeagueRequest(BaseModel):
    user_id: int
    name: str

class JoinLeagueRequest(BaseModel):
    user_id: int
    invite_code: str

def generate_invite_code(length=8):
    """Генерирует случайный 8-значный код из букв и цифр"""
    chars = string.ascii_uppercase + string.digits
    return ''.join(random.choice(chars) for _ in range(length))

@router.get("/leagues/general")
async def get_general_leaderboard(user_id: int, db: AsyncSession = Depends(get_db)):
    """Возвращает Топ-100 глобального лидерборда и позицию самого юзера"""
    # Ищем глобальную лигу
    res_league = await db.execute(select(League).where(League.is_global == True))
    global_league = res_league.scalar_one_or_none()
    if not global_league:
        return {"leaderboard": [], "user_rank": None}

    # Достаем всех участников глобальной лиги, отсортированных по очкам (total_points)
    res_members = await db.execute(
        select(LeagueMember, User)
        .join(User, LeagueMember.user_id == User.id)
        .where(LeagueMember.league_id == global_league.id)
        .order_by(desc(LeagueMember.total_points))
    )
    
    leaderboard = []
    user_rank = None
    
    # Формируем рейтинг
    for rank, (member, user) in enumerate(res_members, start=1):
        if member.user_id == user_id:
            user_rank = {
                "rank": rank,
                "name": user.display_name,
                "points": member.total_points
            }
            
        if rank <= 100: # Отдаем только Топ-100 для экономии трафика
            leaderboard.append({
                "rank": rank,
                "name": user.display_name,
                "points": member.total_points,
                "is_me": member.user_id == user_id
            })
            
    return {"leaderboard": leaderboard, "user_rank": user_rank}


@router.get("/leagues/my")
async def get_my_leagues(user_id: int, db: AsyncSession = Depends(get_db)):
    """Возвращает список частных лиг, в которых состоит пользователь"""
    res = await db.execute(
        select(League)
        .join(LeagueMember)
        .where(LeagueMember.user_id == user_id, League.is_global == False)
    )
    leagues = res.scalars().all()
    
    return [{"id": l.id, "name": l.name, "invite_code": l.invite_code} for l in leagues]


@router.post("/leagues/create")
async def create_league(req: CreateLeagueRequest, db: AsyncSession = Depends(get_db)):
    """Создает новую лигу и добавляет туда создателя"""
    invite_code = generate_invite_code()
    
    # Убеждаемся, что код уникальный (хоть шанс совпадения и мизерный)
    while (await db.execute(select(League).where(League.invite_code == invite_code))).scalar_one_or_none():
        invite_code = generate_invite_code()

    new_league = League(
        name=req.name,
        invite_code=invite_code,
        is_global=False
    )
    db.add(new_league)
    await db.flush() # Получаем ID новой лиги
    
    # Добавляем создателя в лигу
    member = LeagueMember(league_id=new_league.id, user_id=req.user_id)
    db.add(member)
    await db.commit()
    
    return {"status": "success", "league_id": new_league.id, "invite_code": invite_code}


@router.post("/leagues/join")
async def join_league(req: JoinLeagueRequest, db: AsyncSession = Depends(get_db)):
    """Добавляет пользователя в лигу по инвайт-коду"""
    # Ищем лигу по коду
    res_league = await db.execute(select(League).where(League.invite_code == req.invite_code.upper()))
    league = res_league.scalar_one_or_none()
    
    if not league:
        raise HTTPException(status_code=404, detail="Лига не найдена. Проверьте код.")
        
    # Проверяем, не состоит ли он уже там
    res_member = await db.execute(
        select(LeagueMember).where(LeagueMember.league_id == league.id, LeagueMember.user_id == req.user_id)
    )
    if res_member.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Вы уже состоите в этой лиге!")
        
    # Добавляем юзера
    member = LeagueMember(league_id=league.id, user_id=req.user_id)
    db.add(member)
    await db.commit()
    
    return {"status": "success", "league_name": league.name}


@router.get("/leagues/{league_id}/leaderboard")
async def get_league_leaderboard(league_id: int, user_id: int, db: AsyncSession = Depends(get_db)):
    """Возвращает лидерборд конкретной частной лиги"""
    res_members = await db.execute(
        select(LeagueMember, User)
        .join(User, LeagueMember.user_id == User.id)
        .where(LeagueMember.league_id == league_id)
        .order_by(desc(LeagueMember.total_points))
    )
    
    leaderboard = []
    for rank, (member, user) in enumerate(res_members, start=1):
        leaderboard.append({
            "rank": rank,
            "name": user.display_name,
            "points": member.total_points,
            "is_me": member.user_id == user_id
        })
            
    return {"leaderboard": leaderboard}