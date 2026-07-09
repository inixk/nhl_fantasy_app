# backend/database/models.py
import enum
from datetime import datetime
from typing import Optional, List

from sqlalchemy import (
    String, Integer, BigInteger, Float, Boolean, DateTime,
    ForeignKey, Enum, UniqueConstraint
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass

class PlayerPosition(enum.Enum):
    F = "F"  # Нападающие (Forwards)
    D = "D"  # Защитники (Defenders)
    G = "G"  # Вратари (Goalies)

# ─── 1. Пользователи и Лиги ─────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True) # Telegram ID
    username: Mapped[Optional[str]] = mapped_column(String(64))
    display_name: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    memberships: Mapped[List["LeagueMember"]] = relationship(back_populates="user")

class League(Base):
    """Таблица лиг. По умолчанию создадим одну is_global=True для общего зачета."""
    __tablename__ = "leagues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128))
    invite_code: Mapped[str] = mapped_column(String(16), unique=True)
    is_global: Mapped[bool] = mapped_column(Boolean, default=False)
    
    members: Mapped[List["LeagueMember"]] = relationship(back_populates="league")

class LeagueMember(Base):
    """Профиль пользователя внутри конкретной лиги (его команда, баланс, очки)."""
    __tablename__ = "league_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    league_id: Mapped[int] = mapped_column(Integer, ForeignKey("leagues.id"))
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    team_name: Mapped[str] = mapped_column(String(128), default="My Team")
    
    # 🌟 ЭКОНОМИКА И ОЧКИ
    total_points: Mapped[float] = mapped_column(Float, default=0.0)
    budget: Mapped[float] = mapped_column(Float, default=10000.0) # Стартовый капитал
    transfers_used: Mapped[int] = mapped_column(Integer, default=0) # Лимит 6 в неделю
    
    # 🌟 КАПИТАН (ID игрока из nhl_players)
    captain_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("nhl_players.id"), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    # Связи
    league: Mapped["League"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="memberships")
    roster: Mapped[List["RosterPlayer"]] = relationship(back_populates="member", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("league_id", "user_id", name="uq_league_user"),)

# ─── 2. Игроки и Составы ────────────────────────────────────────────

class NHLPlayer(Base):
    """Карточка хоккеиста. Данные обновляются из API НХЛ."""
    __tablename__ = "nhl_players"

    id: Mapped[int] = mapped_column(Integer, primary_key=True) # ID из API НХЛ
    full_name: Mapped[str] = mapped_column(String(128))
    team_abbr: Mapped[str] = mapped_column(String(4))
    position: Mapped[PlayerPosition] = mapped_column(Enum(PlayerPosition))
    headshot_url: Mapped[Optional[str]] = mapped_column(String(512)) # Для красивых фото в WebApp
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # 🌟 БИРЖА: Текущая цена и очки за сезон
    price: Mapped[float] = mapped_column(Float, default=1000.0)
    fantasy_points: Mapped[float] = mapped_column(Float, default=0.0) 
    games_played: Mapped[int] = mapped_column(Integer, default=0)
    
    last_updated: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class RosterPlayer(Base):
    """Связующая таблица: какие игроки находятся в составе конкретного пользователя."""
    __tablename__ = "roster_players"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    member_id: Mapped[int] = mapped_column(Integer, ForeignKey("league_members.id"))
    player_id: Mapped[int] = mapped_column(Integer, ForeignKey("nhl_players.id"))
    
    # Запоминаем, за сколько купили, чтобы при продаже вернуть актуальную цену
    acquired_price: Mapped[float] = mapped_column(Float, default=0.0)
    acquired_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    member: Mapped["LeagueMember"] = relationship(back_populates="roster")
    player: Mapped["NHLPlayer"] = relationship()
    
    # Один и тот же игрок не может быть куплен дважды в одну команду
    __table_args__ = (UniqueConstraint("member_id", "player_id", name="uq_member_player"),)