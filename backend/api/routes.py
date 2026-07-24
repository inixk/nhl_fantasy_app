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
from backend.database.models import NHLPlayer, LeagueMember, RosterPlayer, League, User, DraftPick, DraftStatus, LeagueType
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
    league_type: str = "bull_market"

class JoinLeagueRequest(BaseModel):
    user_id: int
    user_name: str
    invite_code: str
    team_name: str

class DraftPickRequest(BaseModel):
    user_id: int
    player_id: int

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

# 🌟 ИСПРАВЛЕНО: Теперь эндпоинт принимает league_id!
@router.get("/my_team")
async def get_my_team(user_id: int, league_id: int = None, db: AsyncSession = Depends(get_db)):
    if league_id:
        res_league = await db.execute(select(League).where(League.id == league_id))
        target_league = res_league.scalar_one_or_none()
    else:
        res_league = await db.execute(select(League).where(League.is_global == True))
        target_league = res_league.scalar_one_or_none()
        
    if not target_league:
        return {"balance": 10000.0, "roster": [], "captain_id": None, "transfers_used": 0, "captain_changes": 0}

    res_member = await db.execute(select(LeagueMember).where(LeagueMember.user_id == user_id, LeagueMember.league_id == target_league.id))
    member = res_member.scalar_one_or_none()
    if not member:
        return {"balance": 10000.0, "roster": [], "captain_id": None, "transfers_used": 0, "captain_changes": 0}

    res_roster = await db.execute(select(RosterPlayer).options(selectinload(RosterPlayer.player)).where(RosterPlayer.member_id == member.id))
    
    # 🌟 Отдаем также статус is_benched (Для скамейки)
    return {
        "balance": member.budget, "captain_id": member.captain_id, "transfers_used": member.transfers_used, "captain_changes": member.captain_changes_used,
        "roster": [{"id": r.player_id, "pos": r.player.position.name, "is_benched": r.is_benched} for r in res_roster.scalars().all()]
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
            
        res_old_roster = await db.execute(select(RosterPlayer).where(RosterPlayer.member_id == member.id))
        old_roster = res_old_roster.scalars().all()
        old_ids = set([r.player_id for r in old_roster])
        new_ids = set([pid for pid in req.roster_ids if pid is not None])
        
        is_initial_draft = len(old_ids) < 17 
        if not is_initial_draft:
            new_players_added = len(new_ids - old_ids)
            if member.transfers_used + new_players_added > 6:
                raise HTTPException(status_code=400, detail=f"Превышен лимит замен! Доступно: {6 - member.transfers_used}")
            member.transfers_used += new_players_added
            if req.captain_id and req.captain_id != member.captain_id:
                if member.captain_changes_used >= 1: raise HTTPException(status_code=400, detail="Капитана можно менять 1 раз в неделю.")
                member.captain_changes_used += 1
                
        await db.execute(delete(RosterPlayer).where(RosterPlayer.member_id == member.id))
        for pid in req.roster_ids:
            if pid is not None:
                player = await db.get(NHLPlayer, pid)
                if player: db.add(RosterPlayer(member_id=member.id, player_id=player.id, acquired_price=player.price))
                    
        member.budget = req.balance
        member.captain_id = req.captain_id
        await db.commit()
        return {"status": "success"}
    except HTTPException: raise 
    except Exception as e:
        logger.error(f"Save Team Error: {str(e)}")
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")

@router.get("/nhl/standings")
async def get_nhl_standings():
    data = await nhl_api.get_standings()
    if not data or "standings" not in data: raise HTTPException(status_code=500, detail="Failed to fetch standings")
    return data["standings"]

def get_player_name(obj_data: dict) -> str:
    if not obj_data: return "Unknown"
    if "name" in obj_data and isinstance(obj_data["name"], dict): return obj_data["name"].get("default", "Unknown")
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

@router.get("/player/{player_id}/logs")
async def get_player_logs(player_id: int, db: AsyncSession = Depends(get_db)):
    player = await db.get(NHLPlayer, player_id)
    if not player: raise HTTPException(status_code=404, detail="Player not found")
    now = datetime.utcnow()
    season = f"{now.year}{now.year+1}" if now.month >= 9 else f"{now.year-1}{now.year}"
    past_season = f"{int(season[:4])-1}{int(season[4:])-1}"
    
    stats_info = await nhl_api.get_player_info(player_id)
    season_stats = {}
    if stats_info and "featuredStats" in stats_info:
        subSeason = stats_info["featuredStats"].get("regularSeason", {}).get("subSeason", {})
        season_stats = subSeason

    log_data = await nhl_api._request(f"player/{player_id}/game-log/{season}/2")
    games = log_data.get("gameLog", []) if log_data else []
    if not games:
        log_data = await nhl_api._request(f"player/{player_id}/game-log/{past_season}/2")
        games = log_data.get("gameLog", []) if log_data else []

    logs = []
    for g in games:
        pts = 0.0
        toi = g.get("toi", g.get("timeOnIce", "00:00"))
        pim = g.get("pim", 0)
        raw_stats = {"toi": toi, "pim": pim}

        if player.position.name == "G":
            saves, ga, shutouts = g.get("saves", 0), g.get("goalsAgainst", 0), g.get("shutouts", 0)
            win = g.get("decision") == "W"
            pts = (saves * 0.4) - (ga * 1.0) + (shutouts * 10.0) + (win * 6.0)
            sv_pct = g.get("savePctg", 0.0)
            try: sv_pct_str = f"{float(sv_pct):.3f}"
            except: sv_pct_str = "0.000"
            raw_stats.update({"sv": saves, "ga": ga, "sv_pct": sv_pct_str})
        else:
            goals, assists, pm = g.get("goals", 0), g.get("assists", 0), g.get("plusMinus", 0)
            ppg, shg = g.get("powerPlayGoals", 0), g.get("shorthandedGoals", 0)
            gwg, otg = g.get("gameWinningGoals", 0), g.get("otGoals", 0)
            pts = (goals * 8.0) + (assists * 4.0) + (pm * 1.0) + (ppg * 2.0) + (shg * 4.0) + (gwg * 2.0) + (otg * 2.0)
            raw_stats.update({"g": goals, "a": assists, "pm": pm})

        logs.append({"date": g.get("gameDate", ""), "opponent": g.get("opponentAbbrev", "TBD"), "points": round(pts, 1), "raw": raw_stats})
    return {"player_name": player.full_name, "position": player.position.name, "logs": logs, "season_stats": season_stats}

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
        team_name = member.team_name if member.team_name != "My Team" else f"Team {user.display_name}"
        if member.user_id == user_id: user_rank = {"rank": rank, "name": team_name, "manager": user.display_name, "points": member.total_points, "user_id": member.user_id, "is_commish": False}
        if rank <= 100: leaderboard.append({"rank": rank, "name": team_name, "manager": user.display_name, "points": member.total_points, "is_me": member.user_id == user_id, "user_id": member.user_id, "is_commish": False})
    return {"leaderboard": leaderboard, "user_rank": user_rank}

@router.get("/leagues/my")
async def get_my_leagues(user_id: int, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(League).join(LeagueMember).where(LeagueMember.user_id == user_id, League.is_global == False))
    leagues = res.scalars().all()
    result = []
    for l in leagues:
        top_res = await db.execute(select(LeagueMember).where(LeagueMember.league_id == l.id).order_by(desc(LeagueMember.total_points)).limit(1))
        top_member = top_res.scalar_one_or_none()
        top_text = f"Top: {top_member.team_name} ({round(top_member.total_points)} FC)" if top_member else "No members"
        result.append({"id": l.id, "name": l.name, "invite_code": l.invite_code, "top_manager": top_text, "league_type": l.league_type.value, "draft_status": l.draft_status.value})
    return result

@router.post("/leagues/create")
async def create_league(req: CreateLeagueRequest, db: AsyncSession = Depends(get_db)):
    await get_or_create_user(db, req.user_id, req.user_name)
    invite_code = generate_invite_code()
    while (await db.execute(select(League).where(League.invite_code == invite_code))).scalar_one_or_none():
        invite_code = generate_invite_code()
    l_type = LeagueType.SNAKE_DRAFT if req.league_type == "snake_draft" else LeagueType.BULL_MARKET
    new_league = League(name=req.name, invite_code=invite_code, is_global=False, league_type=l_type)
    db.add(new_league)
    await db.flush()
    db.add(LeagueMember(league_id=new_league.id, user_id=req.user_id, team_name=req.team_name, is_commissioner=True))
    await db.commit()
    return {"status": "success", "league_id": new_league.id, "invite_code": invite_code}

@router.post("/leagues/join")
async def join_league(req: JoinLeagueRequest, db: AsyncSession = Depends(get_db)):
    await get_or_create_user(db, req.user_id, req.user_name)
    res_league = await db.execute(select(League).where(League.invite_code == req.invite_code.upper()))
    league = res_league.scalar_one_or_none()
    if not league: raise HTTPException(status_code=404, detail="Лига не найдена.")
    if league.league_type == LeagueType.SNAKE_DRAFT:
        res_count = await db.execute(select(LeagueMember).where(LeagueMember.league_id == league.id))
        if len(res_count.scalars().all()) >= 15: raise HTTPException(status_code=400, detail="Лига заполнена (Макс 15 человек).")
        if league.draft_status != DraftStatus.PRE_DRAFT: raise HTTPException(status_code=400, detail="Драфт в этой лиге уже начался или завершен!")
    res_member = await db.execute(select(LeagueMember).where(LeagueMember.league_id == league.id, LeagueMember.user_id == req.user_id))
    if res_member.scalar_one_or_none(): raise HTTPException(status_code=400, detail="Вы уже в этой лиге!")
    db.add(LeagueMember(league_id=league.id, user_id=req.user_id, team_name=req.team_name))
    await db.commit()
    return {"status": "success", "league_name": league.name}

@router.get("/leagues/{league_id}/leaderboard")
async def get_league_leaderboard(league_id: int, user_id: int, db: AsyncSession = Depends(get_db)):
    res_members = await db.execute(select(LeagueMember, User).join(User, LeagueMember.user_id == User.id).where(LeagueMember.league_id == league_id).order_by(desc(LeagueMember.total_points)))
    leaderboard = []
    is_commish = False
    for rank, (member, user) in enumerate(res_members, start=1):
        if member.user_id == user_id and member.is_commissioner: is_commish = True
        leaderboard.append({"rank": rank, "name": member.team_name, "manager": user.display_name, "points": member.total_points, "is_me": member.user_id == user_id, "user_id": member.user_id, "is_commish": member.is_commissioner})
    return {"leaderboard": leaderboard, "is_commissioner": is_commish}

@router.delete("/leagues/{league_id}")
async def delete_league(league_id: int, user_id: int, db: AsyncSession = Depends(get_db)):
    league = await db.get(League, league_id)
    if not league: raise HTTPException(404, "League not found")
    res_member = await db.execute(select(LeagueMember).where(LeagueMember.league_id == league_id, LeagueMember.user_id == user_id))
    member = res_member.scalar_one_or_none()
    if not member or not member.is_commissioner: raise HTTPException(403, "Только создатель может удалить лигу")
    await db.execute(delete(DraftPick).where(DraftPick.league_id == league_id))
    res_league_members = await db.execute(select(LeagueMember.id).where(LeagueMember.league_id == league_id))
    member_ids = res_league_members.scalars().all()
    if member_ids: await db.execute(delete(RosterPlayer).where(RosterPlayer.member_id.in_(member_ids)))
    await db.execute(delete(LeagueMember).where(LeagueMember.league_id == league_id))
    await db.delete(league)
    await db.commit()
    return {"status": "success"}

@router.get("/leagues/{league_id}/lobby")
async def get_league_lobby(league_id: int, user_id: int, db: AsyncSession = Depends(get_db)):
    league = await db.get(League, league_id)
    if not league: raise HTTPException(status_code=404, detail="League not found")
    res_members = await db.execute(select(LeagueMember, User).join(User, LeagueMember.user_id == User.id).where(LeagueMember.league_id == league_id))
    members = []
    is_commish = False
    for member, user in res_members:
        members.append({"name": member.team_name, "manager": user.display_name, "is_me": member.user_id == user_id, "is_commish": member.is_commissioner})
        if member.user_id == user_id and member.is_commissioner: is_commish = True
    return {"name": league.name, "invite_code": league.invite_code, "draft_status": league.draft_status.value, "members": members, "is_commissioner": is_commish, "max_members": 15}

@router.post("/leagues/{league_id}/start_draft")
async def start_draft(league_id: int, user_id: int, db: AsyncSession = Depends(get_db)):
    league = await db.get(League, league_id)
    if not league or league.league_type != LeagueType.SNAKE_DRAFT: raise HTTPException(400, "Not a snake draft league")
    if league.draft_status != DraftStatus.PRE_DRAFT: raise HTTPException(400, "Draft already started")
    res_member = await db.execute(select(LeagueMember).where(LeagueMember.league_id == league_id, LeagueMember.user_id == user_id))
    member = res_member.scalar_one_or_none()
    if not member or not member.is_commissioner: raise HTTPException(403, "Только создатель может запустить драфт")
    res_members = await db.execute(select(LeagueMember).where(LeagueMember.league_id == league_id))
    all_members = res_members.scalars().all()
    if len(all_members) < 2: raise HTTPException(400, "Нужно минимум 2 участника для старта")
    member_uids = [m.user_id for m in all_members]
    random.shuffle(member_uids)
    overall = 1
    for round_num in range(1, 18):
        round_order = member_uids if round_num % 2 != 0 else list(reversed(member_uids))
        for pick_num, uid in enumerate(round_order, 1):
            db.add(DraftPick(league_id=league.id, user_id=uid, round_number=round_num, pick_number=pick_num, overall_pick=overall))
            overall += 1
    league.draft_status = DraftStatus.DRAFTING
    league.current_pick_index = 1
    league.draft_order = {"order": member_uids}
    await db.commit()
    return {"status": "success"}

@router.get("/leagues/{league_id}/draft_board")
async def get_draft_board(league_id: int, user_id: int, db: AsyncSession = Depends(get_db)):
    league = await db.get(League, league_id)
    if not league: raise HTTPException(404, "League not found")
    res_current = await db.execute(select(DraftPick, User).join(User, DraftPick.user_id == User.id).where(DraftPick.league_id == league_id, DraftPick.player_id == None).order_by(DraftPick.overall_pick).limit(1))
    current = res_current.first()
    current_pick_data = None
    if current:
        dp, u = current
        current_pick_data = {"user_id": dp.user_id, "manager": u.display_name, "round": dp.round_number, "pick": dp.pick_number, "overall": dp.overall_pick}
    res_drafted = await db.execute(select(DraftPick).where(DraftPick.league_id == league_id, DraftPick.player_id != None))
    drafted_ids = [d.player_id for d in res_drafted.scalars().all()]
    
    my_roster = []
    res_member = await db.execute(select(LeagueMember).where(LeagueMember.league_id == league_id, LeagueMember.user_id == user_id))
    member = res_member.scalar_one_or_none()
    if member:
        res_rost = await db.execute(select(RosterPlayer).options(selectinload(RosterPlayer.player)).where(RosterPlayer.member_id == member.id))
        for r in res_rost.scalars().all(): my_roster.append({"id": r.player_id, "pos": r.player.position.name, "name": r.player.full_name, "is_benched": r.is_benched})
    return {"status": league.draft_status.value, "current_pick": current_pick_data, "drafted_ids": drafted_ids, "my_roster": my_roster}

@router.post("/leagues/{league_id}/draft_pick")
async def make_draft_pick(league_id: int, req: DraftPickRequest, db: AsyncSession = Depends(get_db)):
    league = await db.get(League, league_id)
    if not league or league.league_type != LeagueType.SNAKE_DRAFT: raise HTTPException(400, "Not a snake draft league")
    if league.draft_status != DraftStatus.DRAFTING: raise HTTPException(400, "Draft is not active")
    res_current = await db.execute(select(DraftPick).where(DraftPick.league_id == league_id, DraftPick.player_id == None).order_by(DraftPick.overall_pick).limit(1))
    current_pick = res_current.scalar_one_or_none()
    if not current_pick:
        league.draft_status = DraftStatus.POST_DRAFT
        await db.commit()
        raise HTTPException(400, "Драфт завершен")
    if current_pick.user_id != req.user_id: raise HTTPException(403, "Сейчас не твой ход!")
    res_check = await db.execute(select(DraftPick).where(DraftPick.league_id == league_id, DraftPick.player_id == req.player_id))
    if res_check.scalar_one_or_none(): raise HTTPException(400, "Этого игрока уже забрали!")
    player = await db.get(NHLPlayer, req.player_id)
    if not player: raise HTTPException(404, "Игрок не найден")
    res_member = await db.execute(select(LeagueMember).where(LeagueMember.league_id == league_id, LeagueMember.user_id == req.user_id))
    member = res_member.scalar_one_or_none()
    res_roster = await db.execute(select(RosterPlayer).options(selectinload(RosterPlayer.player)).where(RosterPlayer.member_id == member.id))
    current_roster = res_roster.scalars().all()
    pos_counts = {"F": 0, "D": 0, "G": 0}
    for rp in current_roster: pos_counts[rp.player.position.name] += 1
    limits = {"F": 9, "D": 6, "G": 2}
    starting_limits = {"F": 6, "D": 4, "G": 1}
    if pos_counts[player.position.name] >= limits[player.position.name]: raise HTTPException(400, f"Лимит на позицию {player.position.name} исчерпан ({limits[player.position.name]} макс.)")
    is_benched = pos_counts[player.position.name] >= starting_limits[player.position.name]
    current_pick.player_id = player.id
    current_pick.picked_at = datetime.utcnow()
    league.current_pick_index += 1
    db.add(RosterPlayer(member_id=member.id, player_id=player.id, acquired_price=0.0, is_benched=is_benched))
    res_next = await db.execute(select(DraftPick).where(DraftPick.league_id == league_id, DraftPick.player_id == None).order_by(DraftPick.overall_pick).limit(1))
    if not res_next.scalar_one_or_none(): league.draft_status = DraftStatus.POST_DRAFT
    await db.commit()
    return {"status": "success"}