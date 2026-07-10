// Инициализируем Telegram Web App
const tg = window.Telegram.WebApp;
tg.expand(); // Разворачиваем на весь экран

// Получаем имя пользователя из Telegram
const user = tg.initDataUnsafe?.user;
const greeting = document.getElementById('greeting');
if (user) {
    greeting.innerText = `Привет, ${user.first_name}! 🏒`;
} else {
    greeting.innerText = `Привет, Менеджер! 🏒`;
}

// Запрашиваем игроков с нашего FastAPI
async function loadPlayers() {
    try {
        // Запрос к нашему API (сервер сам поймет, что это http://127.0.0.1:8000/api/players)
        const response = await fetch('/api/players');
        const players = await response.json();
        
        const list = document.getElementById('players-list');
        list.innerHTML = ''; // Очищаем статус "Загрузка"
        
        // Для теста выведем только Топ-20 самых дорогих
        players.slice(0, 20).forEach(p => {
            const card = document.createElement('div');
            card.className = 'player-card';
            
            // Если фото нет, ставим заглушку
            const photoUrl = p.photo ? p.photo : 'https://ui-avatars.com/api/?name='+p.name;
            
            card.innerHTML = `
                <img src="${photoUrl}" alt="photo" class="player-photo">
                <div class="player-info">
                    <h3>${p.name} (${p.team})</h3>
                    <div class="player-stats">
                        Позиция: <b>${p.position}</b> | Очки: <b>${Math.round(p.points)}</b><br>
                        Стоимость: <span class="price-tag">${p.price} FC</span>
                    </div>
                </div>
            `;
            list.appendChild(card);
        });
        
    } catch (error) {
        console.error("Ошибка загрузки:", error);
        document.getElementById('players-list').innerText = "Ошибка загрузки игроков 😔";
    }
}

// Запускаем функцию при открытии сайта
loadPlayers();