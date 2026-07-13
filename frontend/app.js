const tg = window.Telegram.WebApp;
tg.expand();

// Глобальное хранилище данных
let allPlayers = [];
let currentTransferPosition = null;

// Приветствие
const user = tg.initDataUnsafe?.user;
if (user && document.getElementById('greeting')) {
    document.getElementById('greeting').innerText = `Привет, ${user.first_name}! 🏒`;
}

// 1. Управление Окнами и Вкладками
document.getElementById('start-btn')?.addEventListener('click', () => {
    document.getElementById('welcome-modal').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
});

const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');
navItems.forEach(item => {
    item.addEventListener('click', () => {
        navItems.forEach(nav => nav.classList.remove('active'));
        tabContents.forEach(tab => tab.classList.remove('active'));
        item.classList.add('active');
        document.getElementById(item.getAttribute('data-target')).classList.add('active');
    });
});

// 2. Загрузка игроков с Бэкенда
async function fetchPlayers() {
    try {
        const response = await fetch('/api/players');
        allPlayers = await response.json();
        renderFantasyStats(); // Отрисовываем вкладку 3 по умолчанию
    } catch (error) {
        console.error("Error fetching players:", error);
        document.getElementById('fantasy-players-list').innerText = "Ошибка соединения с сервером.";
    }
}

// 3. Рендер вкладки "FANTASY STATS"
function renderFantasyStats() {
    const list = document.getElementById('fantasy-players-list');
    const search = document.getElementById('fantasy-search').value.toLowerCase();
    const posFilter = document.getElementById('fantasy-pos-filter').value;
    const sortBy = document.getElementById('fantasy-sort').value;

    let filtered = allPlayers.filter(p => p.name.toLowerCase().includes(search));
    if (posFilter !== 'ALL') {
        filtered = filtered.filter(p => p.position === posFilter);
    }

    if (sortBy === 'points') filtered.sort((a, b) => b.points - a.points);
    if (sortBy === 'price_desc') filtered.sort((a, b) => b.price - a.price);
    if (sortBy === 'price_asc') filtered.sort((a, b) => a.price - b.price);

    list.innerHTML = '';
    filtered.slice(0, 50).forEach(p => { // Выводим топ-50 по фильтру, чтобы не лагало
        list.innerHTML += `
            <div class="player-card">
                <div class="player-jersey-icon">${p.team}</div>
                <div class="player-info">
                    <h4>${p.name}</h4>
                    <div class="player-stats">Позиция: <b>${p.position}</b> | <span class="price-tag">${p.price} FC</span></div>
                </div>
                <div style="font-weight: bold; color: white;">${Math.round(p.points)} pt</div>
            </div>
        `;
    });
}

// 4. Логика Трансферного Рынка (Открытие при клике на слот площадки)
document.querySelectorAll('.player-slot').forEach(slot => {
    slot.addEventListener('click', function() {
        currentTransferPosition = this.getAttribute('data-pos');
        document.getElementById('market-pos-badge').innerText = currentTransferPosition;
        document.getElementById('market-modal').style.display = 'flex';
        renderMarket();
    });
});

document.getElementById('close-market-btn').addEventListener('click', () => {
    document.getElementById('market-modal').style.display = 'none';
});

function renderMarket() {
    const list = document.getElementById('market-players-list');
    const search = document.getElementById('market-search').value.toLowerCase();
    const sortBy = document.getElementById('market-sort').value;

    // В маркете всегда фильтруем по позиции слота, на который кликнули!
    let filtered = allPlayers.filter(p => p.position === currentTransferPosition && p.name.toLowerCase().includes(search));

    if (sortBy === 'points') filtered.sort((a, b) => b.points - a.points);
    if (sortBy === 'price_desc') filtered.sort((a, b) => b.price - a.price);
    if (sortBy === 'price_asc') filtered.sort((a, b) => a.price - b.price);

    list.innerHTML = '';
    filtered.slice(0, 30).forEach(p => {
        list.innerHTML += `
            <div class="player-card">
                <div class="player-jersey-icon">${p.team}</div>
                <div class="player-info">
                    <h4>${p.name}</h4>
                    <div class="player-stats">${Math.round(p.points)} очков | <span class="price-tag">${p.price} FC</span></div>
                </div>
                <button class="buy-btn" onclick="buyPlayer(${p.id})">Взять</button>
            </div>
        `;
    });
}

// Заглушка для покупки
window.buyPlayer = function(id) {
    alert(`Игрок ID ${id} выбран! (Логика обновления баланса и слота будет в следующем шаге)`);
    document.getElementById('market-modal').style.display = 'none';
};

// Слушатели фильтров
document.getElementById('fantasy-search').addEventListener('input', renderFantasyStats);
document.getElementById('fantasy-pos-filter').addEventListener('change', renderFantasyStats);
document.getElementById('fantasy-sort').addEventListener('change', renderFantasyStats);

document.getElementById('market-search').addEventListener('input', renderMarket);
document.getElementById('market-sort').addEventListener('change', renderMarket);

// Старт
fetchPlayers();