# backend/database/models.py
import enum
from datetime import datetime
from typing import Optional, List

from sqlalchemy import (
    String, Integer, BigInteger, Float, Boolean, DateTime,
    ForeignKey, Enum, UniqueConstraint, JSON
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass

class PlayerPosition(enum.Enum):
    F = "F"
    D = "D"
    G = "G"

# 🌟 НОВЫЕ СТАТУСЫ ДЛЯ SNAKE DRAFT
class LeagueType(enum.Enum):
    BULL_MARKET = "bull_market"
    SNAKE_DRAFT = "snake_draft"

class DraftStatus(enum.Enum):
    PRE_DRAFT = "pre_draft"     # Ждем участников
    DRAFTING = "drafting"       # Идет драфт
    POST_DRAFT = "post_draft"   # Драфт завершен, идет сезон

# ─── 1. Пользователи и Лиги ─────────────────────────────────────────

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True) 
    username: Mapped[Optional[str]] = mapped_column(String(64))
    display_name: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    memberships: Mapped[List["LeagueMember"]] = relationship(back_populates="user")

class League(Base):
    __tablename__ = "leagues"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128))
    invite_code: Mapped[str] = mapped_column(String(16), unique=True)
    is_global: Mapped[bool] = mapped_column(Boolean, default=False)
    
    # 🌟 ТИП ЛИГИ
    league_type: Mapped[LeagueType] = mapped_column(Enum(LeagueType), default=LeagueType.BULL_MARKET)
    
    # 🌟 ПОЛЯ ДЛЯ SNAKE DRAFT
    draft_status: Mapped[DraftStatus] = mapped_column(Enum(DraftStatus), default=DraftStatus.PRE_DRAFT)
    draft_order: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True) # {"order": [user_id_1, user_id_2, ...]}
    current_pick_index: Mapped[int] = mapped_column(Integer, default=0) # Какой по счету пик сейчас идет
    pick_deadline: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True) # Таймер 2 часа
    
    members: Mapped[List["LeagueMember"]] = relationship(back_populates="league")

class LeagueMember(Base):
    __tablename__ = "league_members"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    league_id: Mapped[int] = mapped_column(Integer, ForeignKey("leagues.id"))
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    team_name: Mapped[str] = mapped_column(String(128), default="My Team")
    
    total_points: Mapped[float] = mapped_column(Float, default=0.0)
    budget: Mapped[float] = mapped_column(Float, default=10000.0)
    transfers_used: Mapped[int] = mapped_column(Integer, default=0) 
    captain_changes_used: Mapped[int] = mapped_column(Integer, default=0)
    
    # 🌟 ДЛЯ SNAKE DRAFT
    is_commissioner: Mapped[bool] = mapped_column(Boolean, default=False) # Кто создал лигу
    
    captain_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("nhl_players.id"), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    league: Mapped["League"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="memberships")
    roster: Mapped[List["RosterPlayer"]] = relationship(back_populates="member", cascade="all, delete-orphan")
    __table_args__ = (UniqueConstraint("league_id", "user_id", name="uq_league_user"),)

# ─── 2. Игроки, Составы и Драфт ──────────────────────────────────────

class NHLPlayer(Base):
    __tablename__ = "nhl_players"
    id: Mapped[int] = mapped_column(Integer, primary_key=True) 
    full_name: Mapped[str] = mapped_column(String(128))
    team_abbr: Mapped[str] = mapped_column(String(4))
    position: Mapped[PlayerPosition] = mapped_column(Enum(PlayerPosition))
    headshot_url: Mapped[Optional[str]] = mapped_column(String(512))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    price: Mapped[float] = mapped_column(Float, default=1000.0)
    fantasy_points: Mapped[float] = mapped_column(Float, default=0.0) 
    games_played: Mapped[int] = mapped_column(Integer, default=0)
    last_updated: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class RosterPlayer(Base):
    __tablename__ = "roster_players"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    member_id: Mapped[int] = mapped_column(Integer, ForeignKey("league_members.id"))
    player_id: Mapped[int] = mapped_column(Integer, ForeignKey("nhl_players.id"))
    
    acquired_price: Mapped[float] = mapped_column(Float, default=0.0)
    
    # 🌟 НОВОЕ ПОЛЕ: Скамейка запасных (Только для Snake Draft)
    is_benched: Mapped[bool] = mapped_column(Boolean, default=False)
    
    acquired_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    member: Mapped["LeagueMember"] = relationship(back_populates="roster")
    player: Mapped["NHLPlayer"] = relationship()
    __table_args__ = (UniqueConstraint("member_id", "player_id", name="uq_member_player"),)

# 🌟 ТАБЛИЦА: История пиков драфта
class DraftPick(Base):
    __tablename__ = "draft_picks"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    league_id: Mapped[int] = mapped_column(Integer, ForeignKey("leagues.id"))
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    player_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("nhl_players.id"), nullable=True)
    
    # 🌟 ДОБАВЛЕНЫ НЕДОСТАЮЩИЕ ПОЛЯ
    round_number: Mapped[int] = mapped_column(Integer) # Номер раунда
    pick_number: Mapped[int] = mapped_column(Integer)  # Номер пика внутри раунда
    overall_pick: Mapped[int] = mapped_column(Integer) # Общий номер пика (1, 2, 3...)
    
    is_autopick: Mapped[bool] = mapped_column(Boolean, default=False)
    picked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)