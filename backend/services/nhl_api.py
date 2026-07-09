# backend/services/nhl_api.py
import aiohttp
import logging
from typing import Optional

logger = logging.getLogger(__name__)

class NHLApiService:
    def __init__(self):
        self.base_url = "https://api-web.nhle.com/v1"
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

    async def get_all_teams_roster(self, season: str = "20242025") -> list[dict]:
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

nhl_api = NHLApiService()