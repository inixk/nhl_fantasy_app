# backend/database/engine.py
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from backend.database.models import Base

# Файл базы данных будет лежать в папке backend
DB_URL = "sqlite+aiosqlite:///backend/nhl_tma.db"

# Создаем асинхронный движок
engine = create_async_engine(DB_URL, echo=False)

# Включаем поддержку Foreign Keys в SQLite
@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

# Фабрика сессий
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def init_db():
    """Создает все таблицы в базе данных"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)