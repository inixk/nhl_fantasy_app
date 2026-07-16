const tg = window.Telegram.WebApp;
tg.expand();

let allPlayers = [];
let currentTransferSlot = { pos: null, index: null };

let balance = 10000; 
let captainId = null; // 🌟 СОХРАНЯЕМ КАПИТАНА
let myRoster = { F: [null,null,null,null,null,null,null,null,null], D: [null,null,null,null,null,null], G: [null,null] };

const teamColors = {
    'ANA': '#F47A38', 'BOS': '#FFB81C', 'BUF': '#002654', 'CGY': '#C8102E', 'CAR': '#CC0000', 'CHI': '#CF0A2C', 'COL': '#6F263D', 'CBJ': '#002654',
    'DAL': '#006847', 'DET': '#CE1126', 'EDM': '#041E42', 'FLA': '#C8102E', 'LAK': '#111111', 'MIN': '#154734', 'MTL': '#AF1E2D', 'NSH': '#FFB81C',
    'NJD': '#CE1126', 'NYI': '#00539B', 'NYR': '#0038A8', 'OTT': '#E31837', 'PHI': '#F74902', 'PIT': '#FCB514', 'SJS': '#006D75', 'SEA': '#001628',
    'STL': '#002F87', 'TBL': '#002868', 'TOR': '#00205B', 'UTA': '#000000', 'VAN': '#00205B', 'VGK': '#B4975A', 'WSH': '#041E42', 'WPG': '#041E42'
};

function populateTeamFilters() {
    const teams = Object.keys(teamColors).sort();
    const marketSelect = document.getElementById('market-team-filter');
    const fantasySelect = document.getElementById('fantasy-team-filter');
    teams.forEach(t => {
        marketSelect.innerHTML += `<option value="${t}">${t}</option>`;
        fantasySelect.innerHTML += `<option value="${t}">${t}</option>`;
    });
}
populateTeamFilters();

// Приветствие
const user = tg.initDataUnsafe?.user;
if (user && document.getElementById('greeting')) {
    document.getElementById('greeting').innerText = `Welcome, ${user.first_name}! 🏒`;
}
const userId = user?.id || 123456789;

if (!localStorage.getItem('nhl_onboarding_done')) {
    document.getElementById('start-btn')?.addEventListener('click', () => {
        localStorage.setItem('nhl_onboarding_done', 'true');
        document.getElementById('welcome-modal').style.display = 'none';
        document.getElementById('app-container').style.display = 'block';
    });
} else {
    document.getElementById('welcome-modal').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
}

document.getElementById('info-btn').addEventListener('click', () => { document.getElementById('info-modal').style.display = 'flex'; });
document.getElementById('close-info-btn').addEventListener('click', () => { document.getElementById('info-modal').style.display = 'none'; });

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

async function initApp() {
    try {
        const response = await fetch('/api/players');
        allPlayers = await response.json();
        renderFantasyStats();
        await fetchMyTeam();
        
        // 🌟 ДОБАВЬ ЭТУ СТРОКУ:
        fetchStandings(); 

    } catch (error) { console.error("Error fetching players:", error); }
}

async function fetchMyTeam() {
    try {
        const response = await fetch(`/api/my_team?user_id=${userId}`);
        const data = await response.json();
        
        balance = data.balance;
        captainId = data.captain_id; // Загружаем Кэпа
        myRoster = { F: [null,null,null,null,null,null,null,null,null], D: [null,null,null,null,null,null], G: [null,null] };
        
        let fIndex = 0, dIndex = 0, gIndex = 0;
        data.roster.forEach(item => {
            const playerObj = allPlayers.find(p => p.id === item.id);
            if (playerObj) {
                if (item.pos === 'F' && fIndex < 9) myRoster.F[fIndex++] = playerObj;
                if (item.pos === 'D' && dIndex < 6) myRoster.D[dIndex++] = playerObj;
                if (item.pos === 'G' && gIndex < 2) myRoster.G[gIndex++] = playerObj;
            }
        });
        updateTeamUI();
    } catch (error) { console.error("Error fetching my team:", error); }
}

function createPlayerCardHTML(p, showBuyButton = false) {
    let ptsClass = p.points > 0 ? 'pts-positive' : (p.points < 0 ? 'pts-negative' : 'pts-neutral');
    let ptsPrefix = p.points > 0 ? '+' : '';
    
    let rightSide = `
        <div class="player-right">
            <span class="pts-value ${ptsClass}">${ptsPrefix}${Math.round(p.points)}</span>
            <span class="pts-label">FC</span>
        </div>
    `;
    if (showBuyButton) {
        rightSide = `<div class="player-right"><button class="pick-btn" onclick="buyPlayer(${p.id})">Pick✅</button></div>`;
    }
    
    const bgColor = teamColors[p.team] || '#1e293b';
    const textColor = ['BOS', 'NSH', 'PIT', 'VGK'].includes(p.team) ? '#000000' : '#ffffff';

    return `
        <div class="player-card">
            <div class="player-left">
                <div class="jersey-icon" style="background-color: ${bgColor}; color: ${textColor}; border-color: ${bgColor};">${p.team}</div>
                <div class="player-info">
                    <h4 class="player-name">${p.name}</h4>
                    <div class="player-tags">
                        <span class="badge pos-${p.position}">${p.position}</span>
                        <span class="player-price-white">${p.price} FC</span>
                    </div>
                </div>
            </div>
            ${rightSide}
        </div>
    `;
}

function filterAndSort(searchId, posId, teamId, sortId, minPriceId, maxPriceId, positionForce = null) {
    const search = document.getElementById(searchId).value.toLowerCase();
    const posFilter = positionForce || (document.getElementById(posId) ? document.getElementById(posId).value : 'ALL');
    const teamFilter = document.getElementById(teamId).value;
    const sortBy = document.getElementById(sortId).value;
    
    // Новые фильтры цены
    const minPrice = parseInt(document.getElementById(minPriceId)?.value) || 0;
    const maxPrice = parseInt(document.getElementById(maxPriceId)?.value) || 99999;

    let filtered = allPlayers.filter(p => {
        return p.name.toLowerCase().includes(search) && p.price >= minPrice && p.price <= maxPrice;
    });
    if (posFilter !== 'ALL') filtered = filtered.filter(p => p.position === posFilter);
    if (teamFilter !== 'ALL') filtered = filtered.filter(p => p.team === teamFilter);

    // Новая двухсторонняя сортировка по очкам/FC
    if (sortBy === 'points_desc') filtered.sort((a, b) => b.points - a.points); // Рост
    if (sortBy === 'points_asc') filtered.sort((a, b) => a.points - b.points);  // Падение
    if (sortBy === 'price_desc') filtered.sort((a, b) => b.price - a.price);
    if (sortBy === 'price_asc') filtered.sort((a, b) => a.price - b.price);

    return filtered;
}

function renderFantasyStats() {
    const list = document.getElementById('fantasy-players-list');
    const filtered = filterAndSort('fantasy-search', 'fantasy-pos-filter', 'fantasy-team-filter', 'fantasy-sort', 'fantasy-min-price', 'fantasy-max-price');
    list.innerHTML = '';
    filtered.slice(0, 150).forEach(p => { list.innerHTML += createPlayerCardHTML(p, false); });
}

function renderMarket() {
    const list = document.getElementById('market-players-list');
    const filtered = filterAndSort('market-search', null, 'market-team-filter', 'market-sort', 'market-min-price', 'market-max-price', currentTransferSlot.pos);
    list.innerHTML = '';
    filtered.slice(0, 50).forEach(p => { list.innerHTML += createPlayerCardHTML(p, true); });
}

// 🌟 НАЖАТИЕ НА СЛОТ КОМАНДЫ (МЕНЮ ВЫБОРА КАПИТАНА)
document.querySelectorAll('.player-slot').forEach(slot => {
    slot.addEventListener('click', function() {
        const pos = this.getAttribute('data-pos');
        const index = parseInt(this.getAttribute('data-index'));

        if (myRoster[pos][index] !== null) {
            const p = myRoster[pos][index];
            
            // Нативное всплывающее меню Telegram!
            tg.showPopup({
                title: p.name,
                message: `Cost: ${p.price} FC\nWhat do you want to do?`,
                buttons: [
                    { id: "captain", type: "default", text: "Make Captain (C)" },
                    { id: "sell", type: "destructive", text: `Sell (+${p.price} FC)` },
                    { type: "cancel" }
                ]
            }, (buttonId) => {
                if (buttonId === "sell") {
                    balance += p.price;
                    myRoster[pos][index] = null;
                    if (captainId === p.id) captainId = null; // Убираем кэпа при продаже
                    updateTeamUI();
                } else if (buttonId === "captain") {
                    captainId = p.id;
                    updateTeamUI();
                    tg.HapticFeedback.notificationOccurred('success');
                }
            });
            return;
        }

        currentTransferSlot = { pos, index };
        document.getElementById('market-pos-badge').innerText = pos;
        document.getElementById('market-modal').style.display = 'flex';
        renderMarket();
    });
});

document.getElementById('close-market-btn').addEventListener('click', () => {
    document.getElementById('market-modal').style.display = 'none';
});

window.buyPlayer = function(playerId) {
    const player = allPlayers.find(p => p.id === playerId);
    
    const isAlreadyBought = ['F', 'D', 'G'].some(pos => myRoster[pos].some(p => p && p.id === playerId));
    if (isAlreadyBought) {
        tg.showAlert('Player already in your roster!');
        return;
    }

    let teamCount = 0;
    ['F', 'D', 'G'].forEach(pos => {
        myRoster[pos].forEach(p => { if (p && p.team === player.team) teamCount++; });
    });
    if (teamCount >= 4) {
        tg.showAlert(`Limit reached! Max 4 players from ${player.team}.`);
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
                const bgColor = teamColors[player.team] || '#1e293b';
                const textColor = ['BOS', 'NSH', 'PIT', 'VGK'].includes(player.team) ? '#000000' : '#ffffff';

                // 🌟 ДОБАВЛЯЕМ ЗНАЧОК (С) ЕСЛИ ЭТО КАПИТАН
                const captainBadge = player.id === captainId ? `<div class="captain-badge">C</div>` : '';

                domSlot.innerHTML = `
                    ${captainBadge}
                    <div class="jersey" style="background-color: ${bgColor}; color: ${textColor}; border: 2px solid ${bgColor};">
                        ${player.team}
                    </div>
                    <div class="slot-name" style="color: #cbd5e1;">${lastName}</div>
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

document.getElementById('save-team-btn').addEventListener('click', async () => {
    if (!captainId) {
        tg.showAlert("⚠️ Please select a Captain (C) before saving!");
        return; // Не даем сохранить без капитана
    }

    tg.showConfirm("Submit this roster? Your changes will be saved.", async (confirmed) => {
        if (confirmed) {
            const saveBtn = document.getElementById('save-team-btn');
            saveBtn.innerText = "Saving...";
            saveBtn.disabled = true;

            let rosterIds = [];
            ['F', 'D', 'G'].forEach(pos => {
                myRoster[pos].forEach(player => { rosterIds.push(player ? player.id : null); });
            });

            try {
                const response = await fetch('/api/save_team', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // Отправляем Captain ID на бэкенд
                    body: JSON.stringify({ user_id: userId, roster_ids: rosterIds, balance: balance, captain_id: captainId })
                });

                if (response.ok) {
                    tg.showAlert("✅ Roster saved successfully!");
                    tg.HapticFeedback.notificationOccurred('success');
                } else {
                    throw new Error("Server Error");
                }
            } catch (err) {
                console.error(err);
                tg.showAlert("❌ Error saving team");
            } finally {
                saveBtn.innerText = "Save changes";
                saveBtn.style.background = "var(--glass-border)";
                fetchMyTeam(); // Обновляем данные с сервера
            }
        }
    });
});

['fantasy-search', 'fantasy-pos-filter', 'fantasy-team-filter', 'fantasy-sort', 'fantasy-min-price', 'fantasy-max-price'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('change', renderFantasyStats); el.addEventListener('input', renderFantasyStats); }
});
['market-search', 'market-team-filter', 'market-sort', 'market-min-price', 'market-max-price'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('change', renderMarket); el.addEventListener('input', renderMarket); }
});

// ==========================================
// 📊 ЛОГИКА NHL STATS
// ==========================================

let currentStandings = [];

// Переключение внутренних вкладок в NHL STATS
const statsTabs = document.querySelectorAll('.stats-tab');
const statsSections = document.querySelectorAll('.stats-section');
statsTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        statsTabs.forEach(t => t.classList.remove('active'));
        statsSections.forEach(s => s.style.display = 'none');
        tab.classList.add('active');
        document.getElementById(tab.getAttribute('data-target')).style.display = 'block';
    });
});

// Загрузка таблиц
async function fetchStandings() {
    try {
        const res = await fetch('/api/nhl/standings');
        currentStandings = await res.json();
        renderStandings();
    } catch (e) {
        document.getElementById('standings-table-container').innerHTML = "<div class='loading-text'>Ошибка загрузки.</div>";
    }
}

// Отрисовка таблиц
function renderStandings() {
    const type = document.getElementById('standings-type').value;
    const container = document.getElementById('standings-table-container');
    container.innerHTML = '';

    if (type === 'league') {
        container.innerHTML = generateStandingsTable('NHL', currentStandings);
    } else if (type === 'conference') {
        const eastern = currentStandings.filter(t => t.conferenceName === 'Eastern');
        const western = currentStandings.filter(t => t.conferenceName === 'Western');
        container.innerHTML = generateStandingsTable('Eastern Conference', eastern) + 
                              generateStandingsTable('Western Conference', western);
    } else if (type === 'division') {
        const divisions = [...new Set(currentStandings.map(t => t.divisionName))];
        divisions.forEach(div => {
            const divTeams = currentStandings.filter(t => t.divisionName === div);
            container.innerHTML += generateStandingsTable(div + ' Division', divTeams);
        });
    }
}

// Генератор HTML для таблицы
function generateStandingsTable(title, teams) {
    // Сортируем по очкам, при равенстве - по проценту очков
    teams.sort((a, b) => b.points - a.points || b.pointPctg - a.pointPctg);

    let html = `<div class="section-header">${title}</div>`;
    html += `<table class="standings-table">
                <tr><th>#</th><th>Team</th><th>GP</th><th>W</th><th>L</th><th>OT</th><th>PTS</th></tr>`;

    teams.forEach((t, index) => {
        // Логика зоны плей-офф (Топ-3 в дивизионе или Wildcard)
        const isPlayoff = (t.divisionSequence <= 3) || (t.wildcardSequence <= 2);
        const rowClass = isPlayoff ? 'playoff-spot' : '';

        html += `<tr class="${rowClass}">
            <td>${index + 1}</td>
            <td>
                <div class="team-cell">
                    <img src="${t.teamLogo}" class="team-logo">
                    ${t.teamAbbrev.default}
                </div>
            </td>
            <td>${t.gamesPlayed}</td>
            <td>${t.wins}</td>
            <td>${t.losses}</td>
            <td>${t.otLosses}</td>
            <td style="font-weight: bold; color: white;">${t.points}</td>
        </tr>`;
    });

    html += `</table>`;
    return html;
}

document.getElementById('standings-type').addEventListener('change', renderStandings);

// ==========================================
// 🏆 ЛОГИКА ТОП-20 ЛИДЕРОВ (Спринт 4.2)
// ==========================================

async function fetchLeaders() {
    const category = document.getElementById('leaders-type').value;
    const container = document.getElementById('leaders-table-container');
    container.innerHTML = "<div class='loading-text'>Загрузка статистики...</div>";
    
    try {
        const res = await fetch(`/api/nhl/leaders?category=${category}`);
        const data = await res.json();
        
        if (!data || data.length === 0) {
            container.innerHTML = "<div class='loading-text'>Данные не найдены</div>";
            return;
        }

        const isGoalie = category === 'sv_pct' || category === 'gaa';
        
        let html = `<table class="standings-table">`;
        
        if (isGoalie) {
            // Шапка для вратарей
            html += `<tr><th>#</th><th>Goalie</th><th>GP</th><th>SV%</th><th>GAA</th></tr>`;
        } else {
            // Шапка для полевых
            html += `<tr><th>#</th><th>Player</th><th>GP</th><th>G</th><th>A</th><th>PTS</th></tr>`;
        }

        data.forEach((p, index) => {
            const lastName = p.lastName ? p.lastName : (p.skaterFullName || p.goalieFullName).split(' ').pop();
            const team = p.teamAbbrevs || p.teamAbbrev || '---';
            
            html += `<tr>
                <td>${index + 1}</td>
                <td>
                    <div style="font-weight: 600; color: white;">${lastName}</div>
                    <div style="font-size: 10px; color: var(--text-muted);">${team}</div>
                </td>
                <td>${p.gamesPlayed}</td>`;
                
            if (isGoalie) {
                // Колонки вратарей
                const sv = parseFloat(p.savePct).toFixed(3);
                const gaa = parseFloat(p.goalsAgainstAverage).toFixed(2);
                html += `
                    <td style="color: ${category === 'sv_pct' ? 'var(--accent-green)' : 'inherit'}; font-weight: ${category === 'sv_pct' ? 'bold' : 'normal'}">${sv}</td>
                    <td style="color: ${category === 'gaa' ? 'var(--accent-green)' : 'inherit'}; font-weight: ${category === 'gaa' ? 'bold' : 'normal'}">${gaa}</td>
                `;
            } else {
                // Колонки полевых
                html += `
                    <td style="color: ${category === 'goals' ? 'var(--accent-green)' : 'inherit'}">${p.goals}</td>
                    <td style="color: ${category === 'assists' ? 'var(--accent-green)' : 'inherit'}">${p.assists}</td>
                    <td style="font-weight: bold; color: ${category === 'points' || category === 'russians' ? 'var(--accent-green)' : 'white'};">${p.points}</td>
                `;
            }
            html += `</tr>`;
        });
        
        html += `</table>`;
        container.innerHTML = html;

    } catch (e) {
        console.error(e);
        container.innerHTML = "<div class='loading-text'>Ошибка загрузки.</div>";
    }
}

// Загружаем при изменении фильтра
document.getElementById('leaders-type').addEventListener('change', fetchLeaders);

// Загружаем первый раз, когда юзер переключается на вкладку "Топ-20"
document.querySelector('.stats-tab[data-target="stats-leaders"]').addEventListener('click', () => {
    if (document.getElementById('leaders-table-container').innerHTML.includes('Выберите категорию')) {
        fetchLeaders();
    }
});

// ==========================================
// 📅 ЛОГИКА МАТЧЕЙ И КАЛЕНДАРЯ (Спринт 4.3)
// ==========================================

const datePicker = document.getElementById('scores-date-picker');

// Устанавливаем сегодняшнюю дату по умолчанию
const today = new Date();
// Учитываем часовой пояс при форматировании в YYYY-MM-DD
const localISOTime = (new Date(today.getTime() - (today.getTimezoneOffset() * 60000))).toISOString().split('T')[0];
datePicker.value = localISOTime;

async function fetchScores() {
    const container = document.getElementById('scores-list-container');
    container.innerHTML = "<div class='loading-text'>Загрузка матчей...</div>";
    
    const selectedDate = datePicker.value; // YYYY-MM-DD
    
    try {
        const res = await fetch(`/api/nhl/scores?date=${selectedDate}`);
        const games = await res.json();
        
        if (!games || games.length === 0) {
            container.innerHTML = "<div class='loading-text'>Нет матчей в этот день.</div>";
            return;
        }

        let html = '';
        games.forEach(g => {
            const scoreText = g.status === 'Scheduled' ? 'vs' : `${g.away_score} - ${g.home_score}`;
            
            let detailsHtml = '';
            // Если есть голы, вратари или звезды - рисуем блок деталей
            if (g.goals.length > 0 || g.goalies.length > 0 || g.three_stars.length > 0) {
                detailsHtml += `<div class="match-details">`;
                
                if (g.goals.length > 0) {
                    detailsHtml += `<div class="match-details-title">🚨 Голы:</div>`;
                    g.goals.forEach(goal => detailsHtml += `<div>${goal}</div>`);
                }
                
                if (g.goalies.length > 0) {
                    detailsHtml += `<div class="match-details-title">🥅 Вратари:</div>`;
                    g.goalies.forEach(goalie => detailsHtml += `<div>${goalie}</div>`);
                }
                
                // 🌟 ДОБАВЛЕН БЛОК "ТРИ ЗВЕЗДЫ"
                if (g.three_stars.length > 0) {
                    detailsHtml += `<div class="match-details-title" style="margin-top: 10px; color: #fbbf24;">🌟 Три звезды матча:</div>`;
                    g.three_stars.forEach(star => detailsHtml += `<div>${star}</div>`);
                }
                
                detailsHtml += `</div>`;
            }

            html += `
            <div class="match-card">
                <div class="match-header">${g.status}</div>
                <div class="match-teams">
                    <div class="match-team away">${g.away}</div>
                    <div class="match-score">${scoreText}</div>
                    <div class="match-team home">${g.home}</div>
                </div>
                ${detailsHtml}
            </div>`;
        });
        
        container.innerHTML = html;

    } catch (e) {
        console.error(e);
        container.innerHTML = "<div class='loading-text'>Ошибка загрузки.</div>";
    }
}

// Загружаем при изменении даты в календаре
datePicker.addEventListener('change', fetchScores);

// Загружаем первый раз, когда юзер переключается на вкладку "Матчи"
document.querySelector('.stats-tab[data-target="stats-scores"]').addEventListener('click', () => {
    if (document.getElementById('scores-list-container').innerHTML.includes('Загрузка матчей')) {
        fetchScores();
    }
});

// ==========================================
// 🏆 ЛОГИКА LEAGUES (Лиги и Общий зачет)
// ==========================================

// Переключение внутренних вкладок
const leagueTabs = document.querySelectorAll('.league-tab');
const leagueSections = document.querySelectorAll('.league-section');
leagueTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        leagueTabs.forEach(t => t.classList.remove('active'));
        leagueSections.forEach(s => s.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.getAttribute('data-target')).classList.add('active');
    });
});

// Загрузка при открытии 4-й вкладки
document.querySelector('.nav-item[data-target="tab-leagues"]').addEventListener('click', () => {
    fetchGeneralLeaderboard();
    fetchMyLeagues();
});

// 🌍 1. ОБЩИЙ ЗАЧЕТ
async function fetchGeneralLeaderboard() {
    try {
        const res = await fetch(`/api/leagues/general?user_id=${userId}`);
        const data = await res.json();
        renderLeaderboard('general-leaderboard-list', data.leaderboard);
        
        // Личная плашка
        const myRankDiv = document.getElementById('general-my-rank');
        if (data.user_rank) {
            myRankDiv.style.display = 'block';
            myRankDiv.innerHTML = createLeaderboardItemHTML(data.user_rank, true);
        } else {
            myRankDiv.style.display = 'none';
        }
    } catch (e) {
        console.error(e);
        document.getElementById('general-leaderboard-list').innerHTML = "<div class='loading-text'>Ошибка загрузки рейтинга.</div>";
    }
}

// 🤝 2. МОИ ЛИГИ
async function fetchMyLeagues() {
    try {
        const res = await fetch(`/api/leagues/my?user_id=${userId}`);
        const leagues = await res.json();
        
        const list = document.getElementById('my-leagues-list');
        if (leagues.length === 0) {
            list.innerHTML = "<div class='loading-text' style='padding-top:30px;'>Вы еще не состоите в частных лигах. Создайте свою или вступите по коду!</div>";
            return;
        }
        
        let html = '';
        leagues.forEach(l => {
            html += `
            <div class="league-card" onclick="openPrivateLeague(${l.id}, '${l.name}', '${l.invite_code}')">
                <div>
                    <div class="league-card-title">${l.name}</div>
                    <div class="league-card-code">Code: ${l.invite_code}</div>
                </div>
                <div style="color: var(--accent-blue); font-size: 20px;">➔</div>
            </div>`;
        });
        list.innerHTML = html;
    } catch (e) {
        console.error(e);
    }
}

// 🏆 3. ЛИДЕРБОРД ЧАСТНОЙ ЛИГИ
async function openPrivateLeague(leagueId, name, code) {
    document.getElementById('private-league-title').innerText = name;
    document.getElementById('private-league-code').innerText = code;
    document.getElementById('private-league-modal').style.display = 'flex';
    document.getElementById('private-leaderboard-list').innerHTML = "<div class='loading-text'>Загрузка...</div>";
    
    try {
        const res = await fetch(`/api/leagues/${leagueId}/leaderboard?user_id=${userId}`);
        const data = await res.json();
        renderLeaderboard('private-leaderboard-list', data.leaderboard);
    } catch (e) {
        console.error(e);
    }
}
document.getElementById('close-private-league-btn').addEventListener('click', () => {
    document.getElementById('private-league-modal').style.display = 'none';
});

// Генератор HTML для строчки лидерборда
function createLeaderboardItemHTML(user, hideBottomMargin = false) {
    let rankClass = '';
    if (user.rank === 1) rankClass = 'rank-1';
    else if (user.rank === 2) rankClass = 'rank-2';
    else if (user.rank === 3) rankClass = 'rank-3';
    
    const meClass = user.is_me ? 'is-me' : '';
    const margin = hideBottomMargin ? 'margin-bottom: 0;' : '';

    return `
    <div class="leaderboard-item ${meClass}" style="${margin}">
        <div class="rank-badge ${rankClass}">${user.rank}</div>
        <div class="lb-user-info">${user.name}</div>
        <div class="lb-points">${Math.round(user.points)} FC</div>
    </div>`;
}

function renderLeaderboard(containerId, leaderboardData) {
    const list = document.getElementById(containerId);
    if (!leaderboardData || leaderboardData.length === 0) {
        list.innerHTML = "<div class='loading-text'>Рейтинг пуст.</div>";
        return;
    }
    let html = '';
    leaderboardData.forEach(u => html += createLeaderboardItemHTML(u));
    list.innerHTML = html;
}

// 🛠 4. СОЗДАНИЕ И ВСТУПЛЕНИЕ В ЛИГИ (Модалки)
document.getElementById('btn-show-create-league').addEventListener('click', () => {
    document.getElementById('create-league-name').value = '';
    document.getElementById('create-league-modal').style.display = 'flex';
});
document.getElementById('cancel-create-league').addEventListener('click', () => {
    document.getElementById('create-league-modal').style.display = 'none';
});

document.getElementById('confirm-create-league').addEventListener('click', async () => {
    const name = document.getElementById('create-league-name').value.trim();
    if (name.length < 3) { tg.showAlert("Название должно быть от 3 символов!"); return; }
    
    const btn = document.getElementById('confirm-create-league');
    btn.disabled = true; btn.innerText = "...";
    
    try {
        const res = await fetch('/api/leagues/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, name: name })
        });
        const data = await res.json();
        if (res.ok) {
            tg.showAlert(`✅ Лига создана!\nInvite Code: ${data.invite_code}`);
            document.getElementById('create-league-modal').style.display = 'none';
            fetchMyLeagues(); // Обновляем список
        } else {
            tg.showAlert("❌ Ошибка: " + (data.detail || "Не удалось создать"));
        }
    } catch (e) {
        console.error(e); tg.showAlert("❌ Ошибка сети");
    } finally {
        btn.disabled = false; btn.innerText = "Создать";
    }
});

document.getElementById('btn-show-join-league').addEventListener('click', () => {
    document.getElementById('join-league-code').value = '';
    document.getElementById('join-league-modal').style.display = 'flex';
});
document.getElementById('cancel-join-league').addEventListener('click', () => {
    document.getElementById('join-league-modal').style.display = 'none';
});

document.getElementById('confirm-join-league').addEventListener('click', async () => {
    const code = document.getElementById('join-league-code').value.trim().toUpperCase();
    if (code.length < 4) { tg.showAlert("Некорректный код!"); return; }
    
    const btn = document.getElementById('confirm-join-league');
    btn.disabled = true; btn.innerText = "...";
    
    try {
        const res = await fetch('/api/leagues/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, invite_code: code })
        });
        const data = await res.json();
        if (res.ok) {
            tg.showAlert(`🎉 Вы успешно вступили в лигу:\n${data.league_name}`);
            document.getElementById('join-league-modal').style.display = 'none';
            fetchMyLeagues(); // Обновляем список
        } else {
            tg.showAlert("❌ Ошибка: " + (data.detail || "Не удалось вступить"));
        }
    } catch (e) {
        console.error(e); tg.showAlert("❌ Ошибка сети");
    } finally {
        btn.disabled = false; btn.innerText = "Вступить";
    }
});

initApp();

