const tg = window.Telegram.WebApp;
tg.expand();

let allPlayers = [];
let currentTransferSlot = { pos: null, index: null };

// 🌟 ДАЕМ 20 000 FC ДЛЯ ТЕСТА СБОРКИ ПОЛНОГО СОСТАВА
let balance = 20000; 
let myRoster = {
    F: [null, null, null, null, null, null, null, null, null],
    D: [null, null, null, null, null, null],
    G: [null, null]
};

// 🎨 ФИРМЕННЫЕ ЦВЕТА ВСЕХ КОМАНД НХЛ ДЛЯ ДЖЕРСИ
const teamColors = {
    'ANA': '#F47A38', 'BOS': '#FFB81C', 'BUF': '#002654', 'CGY': '#C8102E',
    'CAR': '#CC0000', 'CHI': '#CF0A2C', 'COL': '#6F263D', 'CBJ': '#002654',
    'DAL': '#006847', 'DET': '#CE1126', 'EDM': '#041E42', 'FLA': '#C8102E',
    'LAK': '#111111', 'MIN': '#154734', 'MTL': '#AF1E2D', 'NSH': '#FFB81C',
    'NJD': '#CE1126', 'NYI': '#00539B', 'NYR': '#0038A8', 'OTT': '#E31837',
    'PHI': '#F74902', 'PIT': '#FCB514', 'SJS': '#006D75', 'SEA': '#001628',
    'STL': '#002F87', 'TBL': '#002868', 'TOR': '#00205B', 'UTA': '#000000',
    'VAN': '#00205B', 'VGK': '#B4975A', 'WSH': '#041E42', 'WPG': '#041E42'
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
    
    // Подставляем цвет команды в иконку рынка
    const bgColor = teamColors[p.team] || '#1e293b';
    const textColor = ['BOS', 'NSH', 'PIT', 'VGK'].includes(p.team) ? '#000000' : '#ffffff'; // Черный текст для желтых/золотых команд

    return `
        <div class="player-card">
            <div class="player-left">
                <div class="jersey-icon" style="background-color: ${bgColor}; color: ${textColor}; border-color: ${bgColor};">${p.team}</div>
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

// Открытие рынка с площадки
document.querySelectorAll('.player-slot').forEach(slot => {
    slot.addEventListener('click', function() {
        const pos = this.getAttribute('data-pos');
        const index = parseInt(this.getAttribute('data-index'));

        // Продажа
        if (myRoster[pos][index] !== null) {
            const playerToSell = myRoster[pos][index];
            tg.showConfirm(`Sell ${playerToSell.name} for ${playerToSell.price} FC?`, (confirmed) => {
                if (confirmed) {
                    balance += playerToSell.price;
                    myRoster[pos][index] = null;
                    updateTeamUI();
                }
            });
            return;
        }

        // Покупка
        currentTransferSlot = { pos, index };
        document.getElementById('market-pos-badge').innerText = pos;
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

    let filtered = allPlayers.filter(p => p.position === currentTransferSlot.pos && p.name.toLowerCase().includes(search));

    if (sortBy === 'points') filtered.sort((a, b) => b.points - a.points);
    if (sortBy === 'price_desc') filtered.sort((a, b) => b.price - a.price);
    if (sortBy === 'price_asc') filtered.sort((a, b) => a.price - b.price);

    list.innerHTML = '';
    filtered.slice(0, 30).forEach(p => { list.innerHTML += createPlayerCardHTML(p, true); });
}

window.buyPlayer = function(playerId) {
    const player = allPlayers.find(p => p.id === playerId);
    
    const isAlreadyBought = ['F', 'D', 'G'].some(pos => myRoster[pos].some(p => p && p.id === playerId));
    if (isAlreadyBought) {
        tg.showAlert('Player already in your roster!');
        return;
    }

    if (balance < player.price) {
        tg.showAlert(`Not enough FC! You need ${player.price} FC.`);
        return;
    }

    balance -= player.price;
    myRoster[currentTransferSlot.pos][currentTransferSlot.index] = player;
    
    document.getElementById('market-modal').style.display = 'none';
    updateTeamUI();
};

function updateTeamUI() {
    document.getElementById('current-balance').innerText = balance;
    let isFull = true;

    ['F', 'D', 'G'].forEach(pos => {
        const domSlots = document.querySelectorAll(`.player-slot[data-pos="${pos}"]`);
        
        myRoster[pos].forEach((player, i) => {
            const domSlot = domSlots[i];
            if (player) {
                const lastName = player.name.split(' ').pop();
                // 🎨 МАГИЯ ЦВЕТА
                const bgColor = teamColors[player.team] || '#1e293b';
                const textColor = ['BOS', 'NSH', 'PIT', 'VGK'].includes(player.team) ? '#000000' : '#ffffff';

                domSlot.innerHTML = `
                    <div class="jersey" style="background-color: ${bgColor}; color: ${textColor}; border: 2px solid ${bgColor};">
                        ${player.team}
                    </div>
                    <div class="slot-name" style="color: #1e293b;">${lastName}</div>
                    <div class="rink-price">${player.price}</div>
                `;
            } else {
                domSlot.innerHTML = `<div class="jersey empty">+</div><div class="slot-name">Empty</div>`;
                isFull = false;
            }
        });
    });

    const saveBtn = document.getElementById('save-team-btn');
    if (isFull && balance >= 0) {
        saveBtn.removeAttribute('disabled');
        saveBtn.style.background = "linear-gradient(135deg, #00E676, #00C853)";
    } else {
        saveBtn.setAttribute('disabled', 'true');
        saveBtn.style.background = "var(--glass-border)";
    }
}

// 🌟 КНОПКА СОХРАНЕНИЯ СОСТАВА
document.getElementById('save-team-btn').addEventListener('click', () => {
    tg.showConfirm("Submit this roster? Your changes will be saved.", (confirmed) => {
        if (confirmed) {
            tg.showAlert("✅ Roster saved successfully!");
            // Позже здесь будет отправка данных на наш FastAPI сервер
            tg.HapticFeedback.notificationOccurred('success');
        }
    });
});

document.getElementById('fantasy-search').addEventListener('input', renderFantasyStats);
document.getElementById('fantasy-pos-filter').addEventListener('change', renderFantasyStats);
document.getElementById('fantasy-sort').addEventListener('change', renderFantasyStats);
document.getElementById('market-search').addEventListener('input', renderMarket);
document.getElementById('market-sort').addEventListener('change', renderMarket);

fetchPlayers();