const tg = window.Telegram.WebApp;
tg.expand();

let allPlayers = [];
let currentTransferPosition = null;

const user = tg.initDataUnsafe?.user;
if (user && document.getElementById('greeting')) {
    document.getElementById('greeting').innerText = `Привет, ${user.first_name}! 🏒`;
}

// Управление окнами
document.getElementById('start-btn')?.addEventListener('click', () => {
    document.getElementById('welcome-modal').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
});

// Навигация
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

// Загрузка игроков
async function fetchPlayers() {
    try {
        const response = await fetch('/api/players');
        allPlayers = await response.json();
        renderFantasyStats();
    } catch (error) {
        console.error("Error fetching players:", error);
        document.getElementById('fantasy-players-list').innerHTML = "<div class='loading-text'>Ошибка сервера.</div>";
    }
}

// Генерация идеальной карточки
function createPlayerCardHTML(p, showBuyButton = false) {
    let rightSide = `
        <div class="player-right">
            <span class="pts-value">${Math.round(p.points)}</span>
            <span class="pts-label">FC PTS</span>
        </div>
    `;
    
    if (showBuyButton) {
        rightSide = `
            <div class="player-right">
                <button class="pick-btn" onclick="buyPlayer(${p.id})">Pick✅</button>
            </div>
        `;
    }

    return `
        <div class="player-card">
            <div class="player-left">
                <div class="jersey-icon">${p.team}</div>
                <div class="player-info">
                    <h4 class="player-name">${p.name}</h4>
                    <div class="player-tags">
                        <span class="badge pos-${p.position}">${p.position}</span>
                        <span class="price-tag">${p.price} FC</span>
                    </div>
                </div>
            </div>
            ${rightSide}
        </div>
    `;
}

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
    filtered.slice(0, 50).forEach(p => {
        list.innerHTML += createPlayerCardHTML(p, false);
    });
}

// Логика Рынка
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

    let filtered = allPlayers.filter(p => p.position === currentTransferPosition && p.name.toLowerCase().includes(search));

    if (sortBy === 'points') filtered.sort((a, b) => b.points - a.points);
    if (sortBy === 'price_desc') filtered.sort((a, b) => b.price - a.price);
    if (sortBy === 'price_asc') filtered.sort((a, b) => a.price - b.price);

    list.innerHTML = '';
    filtered.slice(0, 30).forEach(p => {
        list.innerHTML += createPlayerCardHTML(p, true);
    });
}

window.buyPlayer = function(id) {
    alert(`Игрок ID ${id} выбран! (Логика обновления баланса будет в следующем шаге)`);
    document.getElementById('market-modal').style.display = 'none';
};

document.getElementById('fantasy-search').addEventListener('input', renderFantasyStats);
document.getElementById('fantasy-pos-filter').addEventListener('change', renderFantasyStats);
document.getElementById('fantasy-sort').addEventListener('change', renderFantasyStats);

document.getElementById('market-search').addEventListener('input', renderMarket);
document.getElementById('market-sort').addEventListener('change', renderMarket);

fetchPlayers();