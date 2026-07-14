# backend/services/scoring.py
from backend.database.models import PlayerPosition

class ScoringService:
    """Математика фэнтази-экономики (Bull Market)"""

    @classmethod
    def calculate_match_points(cls, position: PlayerPosition, game_data: dict) -> float:
        """Рассчитывает фэнтази-баллы за конкретный матч (по словарю из API)"""
        points = 0.0

        if position == PlayerPosition.G:
            saves = game_data.get("saves", 0)
            goals_against = game_data.get("goalsAgainst", 0)
            shutout = game_data.get("shutouts", 0)
            pim = game_data.get("pim", 0)
            goals = game_data.get("goals", 0)
            assists = game_data.get("assists", 0)
            win = game_data.get("win", False)

            # 🌟 БАФФ ВРАТАРЕЙ ДЛЯ БАЛАНСА ЭКОНОМИКИ
            points += saves * 0.4
            points -= goals_against * 1.5
            if shutout > 0: points += 10.0
            if win: points += 6.0
            points -= pim * 0.2
            points += goals * 20.0
            points += assists * 10.0
            saves = game_data.get("saves", 0)
            goals_against = game_data.get("goalsAgainst", 0)
            shutout = game_data.get("shutouts", 0)
            pim = game_data.get("pim", 0)
            goals = game_data.get("goals", 0)
            assists = game_data.get("assists", 0)
            win = game_data.get("win", False)

            points += saves * 0.2
            points -= goals_against * 2.0
            if shutout > 0: points += 10.0
            if win: points += 5.0
            points -= pim * 0.2
            points += goals * 20.0
            points += assists * 10.0
        else:
            goals = game_data.get("goals", 0)
            assists = game_data.get("assists", 0)
            plus_minus = game_data.get("plusMinus", 0)
            pp_goals = game_data.get("powerPlayGoals", 0)
            sh_goals = game_data.get("shorthandedGoals", 0)
            gw_goals = game_data.get("gameWinningGoals", 0)
            ot_goals = game_data.get("otGoals", 0)
            hits = game_data.get("hits", 0)
            blocks = game_data.get("blockedShots", 0)
            pim = game_data.get("pim", 0)
            team_won = game_data.get("teamWon", False)

            points += goals * 8.0
            points += assists * 4.0
            points += plus_minus * 1.0
            points += pp_goals * 2.0
            points += sh_goals * 4.0
            points += gw_goals * 2.0
            points += ot_goals * 2.0
            points += hits * 0.2
            points -= pim * 0.2
            
            if position == PlayerPosition.D:
                points += blocks * 0.2

            if team_won: points += 2.0

        return points

    @classmethod
    def calculate_price_change(cls, current_price: float, match_points: float) -> float:
        """
        Изменение цены (Спортивная биржа).
        Новая Цена = Старая Цена + (Набранные баллы - Ожидаемые баллы)
        Ожидание = текущая цена / 82 матча
        """
        expected_points = current_price / 82.0 
        return match_points - expected_points