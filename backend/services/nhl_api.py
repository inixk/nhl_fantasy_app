# backend/services/nhl_api.py
import aiohttp
import logging
from typing import Optional

logger = logging.getLogger(__name__)

class NHLApiService:
    def __init__(self):
        self.base_url = "https://api-web.nhle.com/v1"
        self.stats_url = "https://api.nhle.com/stats/rest" # Для бомбардиров
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30))
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    async def _request(self, endpoint: str) -> Optional[dict]:
        session = await self._get_session()
        url = f"{self.base_url}/{endpoint}"
        try:
            async with session.get(url) as resp:
                if resp.status == 200:
                    return await resp.json()
                logger.error(f"NHL API error {resp.status}: {url}")
                return None
        except Exception as e:
            logger.error(f"NHL API request failed: {e}")
            return None

    # --- МЕТОДЫ ДЛЯ ФЭНТАЗИ БД ---
    async def get_all_teams_roster(self, season: str = "20252026") -> list[dict]:
        """Скачивает ростеры всех 32 команд"""
        teams = ["ANA", "BOS", "BUF", "CGY", "CAR", "CHI", "COL", "CBJ", "DAL", "DET", "EDM", "FLA", "LAK", "MIN", "MTL", "NSH", "NJD", "NYI", "NYR", "OTT", "PHI", "PIT", "SJS", "SEA", "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WPG", "WSH"]
        all_players = []
        for abbr in teams:
            roster = await self._request(f"roster/{abbr}/{season}")
            if roster:
                for group in ["forwards", "defensemen", "goalies"]:
                    for player in roster.get(group, []):
                        player["team_abbr"] = abbr
                        all_players.append(player)
        return all_players

    async def get_player_info(self, player_id: int) -> Optional[dict]:
        return await self._request(f"player/{player_id}/landing")

    # 🌟 ВОТ ОНИ! МЕТОДЫ ДЛЯ ВКЛАДКИ "NHL STATS" 🌟
    
    async def get_standings(self) -> Optional[dict]:
        """Турнирные таблицы"""
        return await self._request("standings/now")
        
    async def get_playoffs(self, season: str) -> Optional[dict]:
        """Сетка плей-офф"""
        return await self._request(f"playoff-series/carousel/{season}/")

    async def get_schedule(self) -> Optional[dict]:
        """Расписание и результаты"""
        return await self._request("schedule/now")
        
# 🌟 НОВЫЕ МЕТОДЫ ДЛЯ ЛИДЕРОВ (Спринт 4.2) 🌟
    
    async def get_skater_stats(self, season: str, sort_field: str, limit: int = 20, nationalities: list = None) -> list:
        """Статистика полевых игроков (Голы, Очки, Передачи)"""
        session = await self._get_session()
        cayenne_exp = f"seasonId={season} and gameTypeId=2"
        
        if nationalities:
            nats = ",".join([f"'{n}'" for n in nationalities])
            cayenne_exp += f" and nationalityCode in ({nats})"
            
        params = {
            "isAggregate": "false", "isGame": "false",
            "sort": f'[{{"property":"{sort_field}","direction":"DESC"}}]',
            "start": "0", "limit": str(limit), "cayenneExp": cayenne_exp
        }
        
        url = f"{self.stats_url}/en/skater/summary"
        try:
            async with session.get(url, params=params) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("data", [])
                return []
        except Exception:
            return []

    async def get_goalie_stats(self, season: str, sort_field: str, limit: int = 20) -> list:
        """Статистика вратарей (%ОБ, КН). Стоит лимит от 10 сыгранных матчей!"""
        session = await self._get_session()
        cayenne_exp = f"seasonId={season} and gameTypeId=2 and gamesPlayed>=10"
        
        # КН (gaa) должен сортироваться по ВОЗРАСТАНИЮ (чем меньше, тем лучше)
        direction = "ASC" if sort_field == "goalsAgainstAverage" else "DESC"
            
        params = {
            "isAggregate": "false", "isGame": "false",
            "sort": f'[{{"property":"{sort_field}","direction":"{direction}"}}]',
            "start": "0", "limit": str(limit), "cayenneExp": cayenne_exp
        }
        
        url = f"{self.stats_url}/en/goalie/summary"
        try:
            async with session.get(url, params=params) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("data", [])
                return []
        except Exception:
            return []
    # 🌟 МЕТОДЫ ДЛЯ КАЛЕНДАРЯ И СКОРБОРДА (Спринт 4.3)
    async def get_schedule(self, date_str: str = "now") -> Optional[dict]:
        """Расписание матчей на конкретную дату (YYYY-MM-DD) или сегодня"""
        return await self._request(f"schedule/{date_str}")

    async def get_game_landing(self, game_id: int) -> Optional[dict]:
        """Хронология голов"""
        return await self._request(f"gamecenter/{game_id}/landing")

    async def get_game_boxscore(self, game_id: int) -> Optional[dict]:
        """Статистика вратарей и бросков"""
        return await self._request(f"gamecenter/{game_id}/boxscore")

nhl_api = NHLApiService()