const tg = window.Telegram.WebApp;
tg.expand();

let allPlayers = [];
let currentTransferSlot = { pos: null, index: null };

// 🌟 НАШ СОСТАВ И БАЛАНС
let balance = 10000;
let myRoster = {
    F: [null, null, null, null, null, null, null, null, null], // 9 слотов
    D: [null, null, null, null, null, null],                   // 6 слотов
    G: [null, null]                                            // 2 слота
};

// Приветствие
const user = tg.initDataUnsafe?.user;
if (user && document.getElementById('greeting')) {
    document.getElementById('greeting').innerText = `Welcome, ${user.first_name}! 🏒`;
}

document.getElementById('start-btn')?.addEventListener('click', () => {
    document.getElementById('welcome-modal').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
});

// Навигация Tabs
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

async function fetchPlayers() {
    try {
        const response = await fetch('/api/players');
        allPlayers = await response.json();
        renderFantasyStats();
    } catch (error) {
        console.error("Error fetching players:", error);
    }
}

function createPlayerCardHTML(p, showBuyButton = false) {
    let rightSide = `<div class="player-right"><span class="pts-value">${Math.round(p.points)}</span><span class="pts-label">FC PTS</span></div>`;
    if (showBuyButton) {
        rightSide = `<div class="player-right"><button class="pick-btn" onclick="buyPlayer(${p.id})">Pick✅</button></div>`;
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
    if (posFilter !== 'ALL') filtered = filtered.filter(p => p.position === posFilter);

    if (sortBy === 'points') filtered.sort((a, b) => b.points - a.points);
    if (sortBy === 'price_desc') filtered.sort((a, b) => b.price - a.price);
    if (sortBy === 'price_asc') filtered.sort((a, b) => a.price - b.price);

    list.innerHTML = '';
    filtered.slice(0, 50).forEach(p => { list.innerHTML += createPlayerCardHTML(p, false); });
}

// 🌟 КЛИК ПО ИГРОКУ НА ПЛОЩАДКЕ (Купить или Продать)
document.querySelectorAll('.player-slot').forEach(slot => {
    slot.addEventListener('click', function() {
        const pos = this.getAttribute('data-pos');
        const index = parseInt(this.getAttribute('data-index'));

        // 1. Если слот ЗАНЯТ -> Продаем игрока
        if (myRoster[pos][index] !== null) {
            const playerToSell = myRoster[pos][index];
            
            // Нативный попап Telegram
            tg.showConfirm(`Продать ${playerToSell.name} за ${playerToSell.price} FC?`, (confirmed) => {
                if (confirmed) {
                    balance += playerToSell.price;
                    myRoster[pos][index] = null; // Очищаем слот
                    updateTeamUI();
                }
            });
            return;
        }

        // 2. Если слот ПУСТ -> Открываем рынок
        currentTransferSlot = { pos, index };
        document.getElementById('market-pos-badge').innerText = pos;
        document.getElementById('market-modal').style.display = 'block';
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

    let filtered = allPlayers.filter(p => p.position === currentTransferSlot.pos && p.name.toLowerCase().includes(search));

    if (sortBy === 'points') filtered.sort((a, b) => b.points - a.points);
    if (sortBy === 'price_desc') filtered.sort((a, b) => b.price - a.price);
    if (sortBy === 'price_asc') filtered.sort((a, b) => a.price - b.price);

    list.innerHTML = '';
    filtered.slice(0, 30).forEach(p => { list.innerHTML += createPlayerCardHTML(p, true); });
}

// 🌟 ПОКУПКА ИГРОКА
window.buyPlayer = function(playerId) {
    const player = allPlayers.find(p => p.id === playerId);
    
    // Проверка 1: Не куплен ли он уже в другой слот?
    const isAlreadyBought = ['F', 'D', 'G'].some(pos => myRoster[pos].some(p => p && p.id === playerId));
    if (isAlreadyBought) {
        tg.showAlert('Этот игрок уже есть в твоем составе!');
        return;
    }

    // Проверка 2: Хватает ли денег?
    if (balance < player.price) {
        tg.showAlert(`Недостаточно средств! Нужно ${player.price} FC.`);
        return;
    }

    // Покупаем!
    balance -= player.price;
    myRoster[currentTransferSlot.pos][currentTransferSlot.index] = player;
    
    document.getElementById('market-modal').style.display = 'none';
    updateTeamUI();
};

// 🌟 ОБНОВЛЕНИЕ ИНТЕРФЕЙСА ПЛОЩАДКИ
function updateTeamUI() {
    document.getElementById('current-balance').innerText = balance;
    let isFull = true;

    ['F', 'D', 'G'].forEach(pos => {
        const domSlots = document.querySelectorAll(`.player-slot[data-pos="${pos}"]`);
        
        myRoster[pos].forEach((player, i) => {
            const domSlot = domSlots[i];
            if (player) {
                // Игрок есть - рисуем его Джерси
                const lastName = player.name.split(' ').pop();
                domSlot.innerHTML = `
                    <div class="jersey" style="background-color: var(--bg-dark); border-color: var(--accent-blue); color: white;">
                        ${player.team}
                    </div>
                    <div class="slot-name">${lastName}</div>
                    <div class="price-tag" style="font-size:10px;">${player.price}</div>
                `;
            } else {
                // Пустой слот
                domSlot.innerHTML = `<div class="jersey empty">+</div><div class="slot-name">Empty</div>`;
                isFull = false;
            }
        });
    });

    // Разблокируем кнопку "Сохранить", если состав полон
    const saveBtn = document.getElementById('save-team-btn');
    if (isFull && balance >= 0) {
        saveBtn.removeAttribute('disabled');
        saveBtn.style.background = "linear-gradient(135deg, #00E676, #00C853)";
    } else {
        saveBtn.setAttribute('disabled', 'true');
        saveBtn.style.background = "var(--glass-border)";
    }
}

// Слушатели поиска
document.getElementById('fantasy-search').addEventListener('input', renderFantasyStats);
document.getElementById('fantasy-pos-filter').addEventListener('change', renderFantasyStats);
document.getElementById('fantasy-sort').addEventListener('change', renderFantasyStats);
document.getElementById('market-search').addEventListener('input', renderMarket);
document.getElementById('market-sort').addEventListener('change', renderMarket);

fetchPlayers();