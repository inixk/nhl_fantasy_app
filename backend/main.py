# backend/main.py
import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn

from aiogram import Bot, Dispatcher
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from aiogram.filters import CommandStart
from aiogram.client.default import DefaultBotProperties 
from dotenv import load_dotenv

from backend.api.routes import router as api_router
from backend.database.engine import init_db

# Загружаем переменные окружения
load_dotenv()
BOT_TOKEN = os.getenv("BOT_TOKEN")

logging.basicConfig(level=logging.INFO)

# --- НАСТРОЙКА БОТА ---
bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode="HTML"))
dp = Dispatcher()

@dp.message(CommandStart())
async def cmd_start(message: Message):
    """Отправляет приветствие и кнопку для открытия Mini App"""
    web_app_url = "https://alike-likewise-perhaps-roads.trycloudflare.com" 
    
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🏒 Играть в Фэнтази", web_app=WebAppInfo(url=web_app_url))]
    ])
    
    await message.answer(
        "<b>Добро пожаловать в NHL Fantasy!</b> 🏆\n\n"
        "Собери свою команду из реальных звезд НХЛ, укладывайся в бюджет и соревнуйся с друзьями.\n\n"
        "Нажми кнопку ниже, чтобы начать 👇", 
        reply_markup=kb
    )

# --- НАСТРОЙКА FASTAPI ---

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Этот код выполняется при старте сервера FastAPI"""
    # Запускаем бота в фоновом режиме
    asyncio.create_task(dp.start_polling(bot))
    logging.info("Telegram Bot started.")
    yield
    # Этот код выполнится при выключении сервера
    await bot.session.close()

app = FastAPI(title="NHL Fantasy API", lifespan=lifespan)

# Разрешаем сайту обращаться к нашему API (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Подключаем наши маршруты
app.include_router(api_router, prefix="/api")
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

if __name__ == "__main__":
    # Запуск сервера на локальном порту 8000
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)