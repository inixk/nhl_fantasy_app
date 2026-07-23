// frontend/app.js
const tg = window.Telegram.WebApp;
tg.expand();

let allPlayers = [];
let currentTransferSlot = { pos: null, index: null };
let selectedActionSlot = { pos: null, index: null, player: null }; 
let balance = 10000; 
let captainId = null; 
let savedCaptainId = null;
let savedRosterString = "";
let myRoster = { F: [null,null,null,null,null,null,null,null,null], D: [null,null,null,null,null,null], G: [null,null] };

const teamColors = {
    'ANA': '#F47A38', 'BOS': '#FFB81C', 'BUF': '#002654', 'CGY': '#C8102E', 'CAR': '#CC0000', 'CHI': '#CF0A2C', 'COL': '#6F263D', 'CBJ': '#002654',
    'DAL': '#006847', 'DET': '#CE1126', 'EDM': '#041E42', 'FLA': '#C8102E', 'LAK': '#111111', 'MIN': '#154734', 'MTL': '#AF1E2D', 'NSH': '#FFB81C',
    'NJD': '#CE1126', 'NYI': '#00539B', 'NYR': '#0038A8', 'OTT': '#E31837', 'PHI': '#F74902', 'PIT': '#FCB514', 'SJS': '#006D75', 'SEA': '#001628',
    'STL': '#002F87', 'TBL': '#002868', 'TOR': '#00205B', 'UTA': '#000000', 'VAN': '#00205B', 'VGK': '#B4975A', 'WSH': '#041E42', 'WPG': '#041E42'
};

const user = tg.initDataUnsafe?.user;
const userId = user?.id || 123456789;
const userName = user?.first_name || user?.username || 'Manager';

if (document.getElementById('greeting')) document.getElementById('greeting').innerText = `Welcome, ${userName}! 🏒`;

function populateTeamFilters() {
    const teams = Object.keys(teamColors).sort();
    const marketSelect = document.getElementById('market-team-filter');
    const fantasySelect = document.getElementById('fantasy-team-filter');
    if(marketSelect && fantasySelect) {
        teams.forEach(t => {
            marketSelect.innerHTML += `<option value="${t}">${t}</option>`;
            fantasySelect.innerHTML += `<option value="${t}">${t}</option>`;
        });
    }
}
populateTeamFilters();

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}
const renderFantasyStatsDebounced = debounce(renderFantasyStats, 400);
const renderMarketDebounced = debounce(renderMarket, 400);

function openModal(id, displayType = 'flex') {
    document.getElementById(id).style.display = displayType;
    document.body.style.overflow = 'hidden'; 
}
function closeModal(id) {
    document.getElementById(id).style.display = 'none';
    document.body.style.overflow = 'auto'; 
}

const welcomeModal = document.getElementById('welcome-modal');
const appContainer = document.getElementById('app-container');

if (!localStorage.getItem('nhl_onboarding_done')) {
    openModal('welcome-modal');
    document.getElementById('start-btn')?.addEventListener('click', () => {
        localStorage.setItem('nhl_onboarding_done', 'true');
        closeModal('welcome-modal');
        appContainer.style.display = 'block';
        initApp();
    });
} else {
    appContainer.style.display = 'block';
    initApp();
}

document.getElementById('info-btn')?.addEventListener('click', () => openModal('info-modal'));
document.getElementById('close-info-btn')?.addEventListener('click', () => closeModal('info-modal'));

const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');
navItems.forEach(item => {
    item.addEventListener('click', () => {
        navItems.forEach(nav => nav.classList.remove('active'));
        tabContents.forEach(tab => tab.classList.remove('active'));
        item.classList.add('active');
        document.getElementById(item.getAttribute('data-target')).classList.add('active');
        if (item.getAttribute('data-target') === 'tab-leagues') {
            fetchGeneralLeaderboard();
            fetchMyLeagues();
        }
    });
});

document.querySelectorAll('.segment-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const group = tab.getAttribute('data-group');
        document.querySelectorAll(`.segment-tab[data-group="${group}"]`).forEach(t => t.classList.remove('active'));
        document.querySelectorAll(`.sub-section[data-group="${group}"]`).forEach(s => s.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.getAttribute('data-target')).classList.add('active');
        if (tab.getAttribute('data-target') === 'stats-leaders' && document.getElementById('leaders-table-container').innerHTML.includes('Выберите')) fetchLeaders();
        if (tab.getAttribute('data-target') === 'stats-scores' && document.getElementById('scores-list-container').innerHTML.includes('Загрузка')) fetchScores();
    });
});

async function initApp() {
    try {
        const response = await fetch('/api/players');
        allPlayers = await response.json();
        renderFantasyStats();
        await fetchMyTeam();
        fetchStandings(); 
    } catch (error) { console.error("Error fetching players:", error); }
}

async function fetchMyTeam() {
    try {
        const response = await fetch(`/api/my_team?user_id=${userId}`);
        const data = await response.json();
        balance = data.balance;
        captainId = data.captain_id;
        savedCaptainId = data.captain_id;
        const transfersLeft = 6 - (data.transfers_used || 0);
        document.getElementById('current-changes').innerText = transfersLeft;
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
        let currentIds = [];
        ['F', 'D', 'G'].forEach(pos => { myRoster[pos].forEach(p => { currentIds.push(p ? p.id : null); }); });
        savedRosterString = JSON.stringify(currentIds);
        updateTeamUI();
    } catch (error) { console.error("Error fetching my team:", error); }
}

function createPlayerCardHTML(p, showBuyButton = false, isDraftMode = false) {
    let ptsClass = p.points > 0 ? 'pts-positive' : (p.points < 0 ? 'pts-negative' : 'pts-neutral');
    let ptsPrefix = p.points > 0 ? '+' : '';
    let rightSide = `<div class="player-right"><span class="pts-value ${ptsClass}">${ptsPrefix}${Math.round(p.points)}</span><span class="pts-label">PTS</span></div>`;
    
    if (showBuyButton) rightSide = `<div class="player-right"><button class="pick-btn" onclick="buyPlayer(${p.id}, event)">Pick✅</button></div>`;
    
    // 🌟 ДЛЯ ДРАФТА МЕНЯЕМ КНОПКУ И ЦЕНУ
    let priceLabel = `${p.price} FC`;
    if (isDraftMode) {
        priceLabel = `Прогноз: ${Math.round(p.price / 10)} PTS`;
        rightSide = `<div class="player-right"><button class="pick-btn" style="background: var(--accent-blue); color: white; border: none;" onclick="makeDraftPick(${p.id}, event)">DRAFT</button></div>`;
    }
    
    const bgColor = teamColors[p.team] || '#1e293b';
    const textColor = ['BOS', 'NSH', 'PIT', 'VGK'].includes(p.team) ? '#000000' : '#ffffff';
    const logoUrl = `https://assets.nhle.com/logos/nhl/svg/${p.team}_light.svg`;
    const jerseyInner = `<img src="${logoUrl}" class="jersey-logo" onload="this.nextElementSibling.style.display='none'" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="jersey-team-text">${p.team}</span>`;
    const onClickAttr = (!showBuyButton && !isDraftMode) ? `onclick="openPlayerProfile(${p.id})"` : '';
    const cursorStyle = (!showBuyButton && !isDraftMode) ? 'cursor:pointer;' : '';

    return `
        <div class="player-card" ${onClickAttr} style="${cursorStyle}">
            <div class="player-left">
                <div class="jersey-icon" style="background-color: ${bgColor}; color: ${textColor}; border-color: ${bgColor};">${jerseyInner}</div>
                <div class="player-info">
                    <h4 class="player-name">${p.name}</h4>
                    <div class="player-tags"><span class="badge pos-${p.position}">${p.position}</span><span class="player-price-white">${priceLabel}</span></div>
                </div>
            </div>
            ${rightSide}
        </div>`;
}

function filterAndSort(searchId, posId, teamId, sortId, minPriceId, maxPriceId, positionForce = null) {
    const search = document.getElementById(searchId)?.value.toLowerCase() || "";
    const posFilter = positionForce || (document.getElementById(posId) ? document.getElementById(posId).value : 'ALL');
    const teamFilter = document.getElementById(teamId)?.value || "ALL";
    const sortBy = document.getElementById(sortId)?.value || "price_desc";
    const minPrice = parseInt(document.getElementById(minPriceId)?.value) || 0;
    const maxPrice = parseInt(document.getElementById(maxPriceId)?.value) || 99999;
    let filtered = allPlayers.filter(p => p.name.toLowerCase().includes(search) && p.price >= minPrice && p.price <= maxPrice);
    if (posFilter !== 'ALL') filtered = filtered.filter(p => p.position === posFilter);
    if (teamFilter !== 'ALL') filtered = filtered.filter(p => p.team === teamFilter);
    if (sortBy === 'points_desc') filtered.sort((a, b) => b.points - a.points);
    if (sortBy === 'points_asc') filtered.sort((a, b) => a.points - b.points);
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

['fantasy-search', 'fantasy-min-price', 'fantasy-max-price'].forEach(id => { document.getElementById(id)?.addEventListener('input', renderFantasyStatsDebounced); });
['fantasy-pos-filter', 'fantasy-team-filter', 'fantasy-sort'].forEach(id => { document.getElementById(id)?.addEventListener('change', renderFantasyStats); });
['market-search', 'market-min-price', 'market-max-price'].forEach(id => { document.getElementById(id)?.addEventListener('input', renderMarketDebounced); });
['market-team-filter', 'market-sort'].forEach(id => { document.getElementById(id)?.addEventListener('change', renderMarket); });

document.querySelectorAll('.player-slot').forEach(slot => {
    slot.addEventListener('click', function() {
        const pos = this.getAttribute('data-pos');
        const index = parseInt(this.getAttribute('data-index'));

        if (myRoster[pos][index] !== null) {
            const p = myRoster[pos][index];
            selectedActionSlot = { pos, index, player: p };
            document.getElementById('action-player-name').innerText = p.name;
            document.getElementById('action-player-price').innerText = `${p.price} FC`;
            document.getElementById('action-btn-sell').innerText = `🗑 Sell (+${p.price} FC)`;
            openModal('action-sheet-modal', 'flex');
            return;
        }

        currentTransferSlot = { pos, index };
        document.getElementById('market-pos-badge').innerText = pos;
        openModal('market-modal', 'flex');
        renderMarket();
    });
});

document.getElementById('action-btn-logs')?.addEventListener('click', () => { closeModal('action-sheet-modal'); if(selectedActionSlot.player) openPlayerProfile(selectedActionSlot.player.id); });
document.getElementById('action-btn-captain')?.addEventListener('click', () => {
    if(selectedActionSlot.player) { captainId = selectedActionSlot.player.id; updateTeamUI(); tg.HapticFeedback.notificationOccurred('success'); }
    closeModal('action-sheet-modal');
});
document.getElementById('action-btn-sell')?.addEventListener('click', () => {
    if(selectedActionSlot.player) { balance += selectedActionSlot.player.price; myRoster[selectedActionSlot.pos][selectedActionSlot.index] = null; if (captainId === selectedActionSlot.player.id) captainId = null; updateTeamUI(); }
    closeModal('action-sheet-modal');
});
document.getElementById('action-btn-cancel')?.addEventListener('click', () => { closeModal('action-sheet-modal'); });

document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) { if(e.target === this) { closeModal(this.id); } });
});
document.getElementById('close-market-btn')?.addEventListener('click', () => { closeModal('market-modal'); });

window.buyPlayer = function(playerId, event) {
    if(event) event.stopPropagation();
    const player = allPlayers.find(p => p.id === playerId);
    if (['F', 'D', 'G'].some(pos => myRoster[pos].some(p => p && p.id === playerId))) { tg.showAlert('Player already in your roster!'); return; }
    let teamCount = 0;
    ['F', 'D', 'G'].forEach(pos => { myRoster[pos].forEach(p => { if (p && p.team === player.team) teamCount++; }); });
    if (teamCount >= 4) { tg.showAlert(`Limit reached! Max 4 players from ${player.team}.`); return; }
    if (balance < player.price) { tg.showAlert(`Not enough FC! You need ${player.price} FC.`); return; }

    balance -= player.price;
    myRoster[currentTransferSlot.pos][currentTransferSlot.index] = player;
    closeModal('market-modal');
    updateTeamUI();
};

function sortMyRoster() {
    ['F', 'D', 'G'].forEach(pos => {
        let players = myRoster[pos].filter(p => p !== null);
        players.sort((a, b) => b.price - a.price);
        for (let i = 0; i < myRoster[pos].length; i++) { myRoster[pos][i] = players[i] || null; }
    });
}

function updateTeamUI() {
    sortMyRoster(); 
    document.getElementById('current-balance').innerText = balance;
    let isFull = true;
    let currentIds = [];

    ['F', 'D', 'G'].forEach(pos => {
        const domSlots = document.querySelectorAll(`.player-slot[data-pos="${pos}"]`);
        myRoster[pos].forEach((player, i) => {
            currentIds.push(player ? player.id : null);
            const domSlot = domSlots[i];
            if (player) {
                const lastName = player.name.split(' ').pop();
                const bgColor = teamColors[player.team] || '#1e293b';
                const textColor = ['BOS', 'NSH', 'PIT', 'VGK'].includes(player.team) ? '#000000' : '#ffffff';
                const captainBadge = player.id === captainId ? `<div class="captain-badge">C</div>` : '';
                const logoUrl = `https://assets.nhle.com/logos/nhl/svg/${player.team}_light.svg`;
                const jerseyInner = `<img src="${logoUrl}" class="jersey-logo" onload="this.nextElementSibling.style.display='none'" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="jersey-team-text">${player.team}</span>`;
                let ptsClass = player.points > 0 ? 'pts-positive' : (player.points < 0 ? 'pts-negative' : 'pts-neutral');
                let ptsPrefix = player.points > 0 ? '+' : '';
                const growthHTML = `<div class="rink-price-diff ${ptsClass}">${ptsPrefix}${Math.round(player.points)} FC</div>`;

                domSlot.innerHTML = `${captainBadge}<div class="jersey" style="background-color: ${bgColor}; color: ${textColor}; border: 2px solid ${bgColor};">${jerseyInner}</div><div class="slot-name" style="color: #cbd5e1;">${lastName}</div><div class="rink-price">${player.price}</div>${growthHTML}`;
            } else {
                domSlot.innerHTML = `<div class="jersey empty">+</div><div class="slot-name">Empty</div>`;
                isFull = false;
            }
        });
    });

    const saveBtn = document.getElementById('save-team-btn');
    const hasChanges = JSON.stringify(currentIds) !== savedRosterString || captainId !== savedCaptainId;
    if (hasChanges) {
        saveBtn.style.display = 'block';
        if (isFull && balance >= 0) { saveBtn.removeAttribute('disabled'); saveBtn.style.background = "linear-gradient(135deg, #00E676, #00C853)"; } 
        else { saveBtn.setAttribute('disabled', 'true'); saveBtn.style.background = "var(--glass-border)"; }
    } else { saveBtn.style.display = 'none'; }
}

document.getElementById('save-team-btn')?.addEventListener('click', async () => {
    if (!captainId) { tg.showAlert("⚠️ Please select a Captain (C) before saving!"); return; }
    tg.showConfirm("Submit this roster? Your changes will be saved.", async (confirmed) => {
        if (confirmed) {
            const saveBtn = document.getElementById('save-team-btn');
            saveBtn.innerText = "Saving..."; saveBtn.disabled = true;
            let rosterIds = [];
            ['F', 'D', 'G'].forEach(pos => { myRoster[pos].forEach(player => { rosterIds.push(player ? player.id : null); }); });
            try {
                const response = await fetch('/api/save_team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, user_name: userName, roster_ids: rosterIds, balance: balance, captain_id: captainId }) });
                const responseData = await response.json();
                if (response.ok) { tg.showAlert("✅ Roster saved successfully!"); tg.HapticFeedback.notificationOccurred('success'); } 
                else { throw new Error(responseData.detail || "Server Error"); }
            } catch (err) { console.error("SAVE ERROR:", err); tg.showAlert("❌ Error saving team: " + err.message); } 
            finally { saveBtn.innerText = "Save changes"; saveBtn.style.background = "var(--glass-border)"; fetchMyTeam(); }
        }
    });
});

// ==========================================
// 5. NHL STATS
// ==========================================
let currentStandings = [];
async function fetchStandings() {
    try { const res = await fetch('/api/nhl/standings'); currentStandings = await res.json(); renderStandings(); } 
    catch (e) { document.getElementById('standings-table-container').innerHTML = "<div class='loading-text'>Ошибка загрузки таблиц.</div>"; }
}
function renderStandings() {
    const type = document.getElementById('standings-type').value;
    const container = document.getElementById('standings-table-container');
    container.innerHTML = '';
    if (type === 'league') container.innerHTML = generateStandingsTable('NHL', currentStandings);
    else if (type === 'conference') {
        container.innerHTML = generateStandingsTable('Eastern Conference', currentStandings.filter(t => t.conferenceName === 'Eastern')) + generateStandingsTable('Western Conference', currentStandings.filter(t => t.conferenceName === 'Western'));
    } else if (type === 'division') {
        [...new Set(currentStandings.map(t => t.divisionName))].forEach(div => { container.innerHTML += generateStandingsTable(div + ' Division', currentStandings.filter(t => t.divisionName === div)); });
    }
}
function generateStandingsTable(title, teams) {
    teams.sort((a, b) => b.points - a.points || b.pointPctg - a.pointPctg);
    let html = `<div class="section-header">${title}</div><table class="standings-table"><tr><th>#</th><th>Team</th><th>GP</th><th>W</th><th>L</th><th>OT</th><th>PTS</th></tr>`;
    teams.forEach((t, index) => {
        const isPlayoff = (t.divisionSequence <= 3) || (t.wildcardSequence <= 2);
        html += `<tr class="${isPlayoff ? 'playoff-spot' : ''}"><td>${index + 1}</td><td><div class="team-cell"><img src="${t.teamLogo}" class="team-logo">${t.teamAbbrev.default}</div></td><td>${t.gamesPlayed}</td><td>${t.wins}</td><td>${t.losses}</td><td>${t.otLosses}</td><td style="font-weight: bold; color: white;">${t.points}</td></tr>`;
    });
    return html + `</table>`;
}
document.getElementById('standings-type')?.addEventListener('change', renderStandings);

async function fetchLeaders() {
    const category = document.getElementById('leaders-type').value;
    const container = document.getElementById('leaders-table-container');
    container.innerHTML = "<div class='loading-text'>Загрузка статистики...</div>";
    try {
        const res = await fetch(`/api/nhl/leaders?category=${category}`);
        const data = await res.json();
        if (!data || data.length === 0) { container.innerHTML = "<div class='loading-text'>Данные не найдены</div>"; return; }
        const isGoalie = category === 'sv_pct' || category === 'gaa';
        let html = `<table class="standings-table">`;
        if (isGoalie) html += `<tr><th>#</th><th>Goalie</th><th>GP</th><th>SV%</th><th>GAA</th></tr>`;
        else html += `<tr><th>#</th><th>Player</th><th>GP</th><th>G</th><th>A</th><th>PTS</th></tr>`;
        
        data.forEach((p, index) => {
            const lastName = p.lastName ? p.lastName : (p.skaterFullName || p.goalieFullName).split(' ').pop();
            const team = p.teamAbbrevs || p.teamAbbrev || '---';
            html += `<tr><td>${index + 1}</td><td><div style="font-weight: 600; color: white;">${lastName}</div><div style="font-size: 10px; color: var(--text-muted);">${team}</div></td><td>${p.gamesPlayed}</td>`;
            if (isGoalie) html += `<td style="color: ${category === 'sv_pct' ? 'var(--accent-green)' : 'inherit'}; font-weight: ${category === 'sv_pct' ? 'bold' : 'normal'}">${parseFloat(p.savePct).toFixed(3)}</td><td style="color: ${category === 'gaa' ? 'var(--accent-green)' : 'inherit'}; font-weight: ${category === 'gaa' ? 'bold' : 'normal'}">${parseFloat(p.goalsAgainstAverage).toFixed(2)}</td>`;
            else html += `<td style="color: ${category === 'goals' ? 'var(--accent-green)' : 'inherit'}">${p.goals}</td><td style="color: ${category === 'assists' ? 'var(--accent-green)' : 'inherit'}">${p.assists}</td><td style="font-weight: bold; color: ${category === 'points' || category === 'russians' ? 'var(--accent-green)' : 'white'};">${p.points}</td>`;
            html += `</tr>`;
        });
        container.innerHTML = html + `</table>`;
    } catch (e) { container.innerHTML = "<div class='loading-text'>Ошибка загрузки.</div>"; }
}
document.getElementById('leaders-type')?.addEventListener('change', fetchLeaders);

const datePicker = document.getElementById('scores-date-picker');
if(datePicker) {
    const today = new Date();
    datePicker.value = (new Date(today.getTime() - (today.getTimezoneOffset() * 60000))).toISOString().split('T')[0];
    datePicker.addEventListener('change', fetchScores);
}

async function fetchScores() {
    const container = document.getElementById('scores-list-container');
    container.innerHTML = "<div class='loading-text'>Загрузка матчей...</div>";
    try {
        const res = await fetch(`/api/nhl/scores?date=${datePicker.value}`);
        const games = await res.json();
        if (!games || games.length === 0) { container.innerHTML = "<div class='loading-text'>Нет матчей в этот день.</div>"; return; }
        let html = '';
        games.forEach(g => {
            const scoreText = g.status === 'Scheduled' ? 'vs' : `${g.away_score} - ${g.home_score}`;
            let detailsHtml = '';
            if (g.goals.length > 0 || g.goalies.length > 0 || (g.three_stars && g.three_stars.length > 0)) {
                detailsHtml += `<div class="match-details">`;
                if (g.goals.length > 0) { detailsHtml += `<div class="match-details-title">🚨 Голы:</div>`; g.goals.forEach(goal => detailsHtml += `<div>${goal}</div>`); }
                if (g.goalies.length > 0) { detailsHtml += `<div class="match-details-title">🥅 Вратари:</div>`; g.goalies.forEach(goalie => detailsHtml += `<div>${goalie}</div>`); }
                if (g.three_stars && g.three_stars.length > 0) { detailsHtml += `<div class="match-details-title" style="margin-top: 10px; color: #fbbf24;">🌟 Три звезды матча:</div>`; g.three_stars.forEach(star => detailsHtml += `<div>${star}</div>`); }
                detailsHtml += `</div>`;
            }
            html += `<div class="match-card"><div class="match-header">${g.status}</div><div class="match-teams"><div class="match-team away">${g.away}</div><div class="match-score">${scoreText}</div><div class="match-team home">${g.home}</div></div>${detailsHtml}</div>`;
        });
        container.innerHTML = html;
    } catch (e) { container.innerHTML = "<div class='loading-text'>Ошибка загрузки.</div>"; }
}

// ==========================================
// 6. LEAGUES (Лиги)
// ==========================================
async function fetchGeneralLeaderboard() {
    try {
        const res = await fetch(`/api/leagues/general?user_id=${userId}`);
        const data = await res.json();
        renderLeaderboard('general-leaderboard-list', data.leaderboard);
        const myRankDiv = document.getElementById('general-my-rank');
        if (data.user_rank) {
            myRankDiv.style.display = 'block';
            myRankDiv.innerHTML = createLeaderboardItemHTML(data.user_rank, true);
        } else { myRankDiv.style.display = 'none'; }
    } catch (e) { document.getElementById('general-leaderboard-list').innerHTML = "<div class='loading-text'>Ошибка загрузки рейтинга.</div>"; }
}

async function fetchMyLeagues() {
    try {
        const res = await fetch(`/api/leagues/my?user_id=${userId}`);
        const leagues = await res.json();
        const list = document.getElementById('my-leagues-list');
        if (leagues.length === 0) { list.innerHTML = "<div class='loading-text' style='padding-top:30px;'>Вы еще не состоите в частных лигах. Создайте свою или вступите по коду!</div>"; return; }
        let html = '';
        leagues.forEach(l => { 
            const typeIcon = l.league_type === "snake_draft" ? "🐍" : "📈";
            html += `<div class="league-card" onclick="viewPrivateLeague(${l.id}, '${l.name}', '${l.invite_code}', '${l.league_type}', '${l.draft_status}')"><div><div class="league-card-title">${typeIcon} ${l.name}</div><div class="league-card-code">${l.top_manager || 'No members'}</div></div><div style="color: var(--accent-blue); font-size: 20px;">➔</div></div>`; 
        });
        list.innerHTML = html;
    } catch (e) { console.error(e); }
}

window.viewPrivateLeague = async function(leagueId, name, code, leagueType, draftStatus) {
    document.getElementById('private-league-title').innerText = name;
    
    const codeEl = document.getElementById('private-league-code');
    codeEl.innerText = code;
    codeEl.className = 'spoiler'; 
    const newCodeEl = codeEl.cloneNode(true);
    codeEl.parentNode.replaceChild(newCodeEl, codeEl);
    newCodeEl.addEventListener('click', function(e) {
        e.stopPropagation();
        this.classList.add('revealed');
        navigator.clipboard.writeText(this.innerText).then(() => { tg.showAlert("✅ Invite Code скопирован в буфер обмена!"); });
    });

    if (leagueType === 'snake_draft') {
        if (draftStatus === 'pre_draft') {
            openDraftLobby(leagueId);
        } else {
            openDraftRoom(leagueId, name);
        }
    } else {
        openModal('private-league-modal', 'flex');
        document.getElementById('private-leaderboard-list').innerHTML = "<div class='loading-text'>Загрузка...</div>";
        try {
            const res = await fetch(`/api/leagues/${leagueId}/leaderboard?user_id=${userId}`);
            const data = await res.json();
            renderLeaderboard('private-leaderboard-list', data.leaderboard);
        } catch (e) { console.error(e); }
    }
};

document.getElementById('close-private-league-btn')?.addEventListener('click', () => { closeModal('private-league-modal'); });

function createLeaderboardItemHTML(user, hideBottomMargin = false) {
    let rankClass = user.rank === 1 ? 'rank-1' : (user.rank === 2 ? 'rank-2' : (user.rank === 3 ? 'rank-3' : ''));
    let safeName = user.name.replace(/"/g, '&quot;');
    return `<div class="leaderboard-item ${user.is_me ? 'is-me' : ''}" style="${hideBottomMargin ? 'margin-bottom: 0;' : ''} cursor: pointer;" onclick="viewOtherTeam(${user.user_id}, this.getAttribute('data-name'))" data-name="${safeName}">
        <div class="rank-badge ${rankClass}">${user.rank}</div>
        <div class="lb-user-info"><div class="lb-team-name">${user.name}</div><div class="lb-manager-name">👤 ${user.manager}</div></div>
        <div class="lb-points">${Math.round(user.points)} FC</div>
    </div>`;
}

function renderLeaderboard(containerId, leaderboardData) {
    const list = document.getElementById(containerId);
    if (!leaderboardData || leaderboardData.length === 0) { list.innerHTML = "<div class='loading-text'>Рейтинг пуст.</div>"; return; }
    let html = '';
    leaderboardData.forEach(u => html += createLeaderboardItemHTML(u));
    list.innerHTML = html;
}

document.getElementById('btn-show-create-league')?.addEventListener('click', () => { 
    document.getElementById('create-league-name').value = ''; 
    document.getElementById('create-team-name').value = ''; 
    openModal('create-league-modal', 'flex'); 
});
document.getElementById('cancel-create-league')?.addEventListener('click', () => { closeModal('create-league-modal'); });

document.getElementById('confirm-create-league')?.addEventListener('click', async () => {
    const name = document.getElementById('create-league-name').value.trim();
    const teamName = document.getElementById('create-team-name').value.trim();
    const lType = document.getElementById('create-league-type').value; 
    
    if (name.length < 3) { tg.showAlert("Название лиги от 3 символов!"); return; }
    if (teamName.length < 3) { tg.showAlert("Название команды от 3 символов!"); return; }
    
    const btn = document.getElementById('confirm-create-league');
    btn.disabled = true; btn.innerText = "...";
    try {
        const res = await fetch('/api/leagues/create', { 
            method: 'POST', headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ user_id: userId, user_name: userName, name: name, team_name: teamName, league_type: lType }) 
        });
        const data = await res.json();
        if (res.ok) { tg.showAlert(`✅ Лига создана!\nInvite Code: ${data.invite_code}`); closeModal('create-league-modal'); fetchMyLeagues(); } 
        else { tg.showAlert("❌ Ошибка: " + (data.detail || "Не удалось создать")); }
    } catch (e) { tg.showAlert("❌ Ошибка сети"); } finally { btn.disabled = false; btn.innerText = "Создать"; }
});

document.getElementById('btn-show-join-league')?.addEventListener('click', () => { 
    document.getElementById('join-league-code').value = ''; 
    document.getElementById('join-team-name').value = ''; 
    openModal('join-league-modal', 'flex'); 
});
document.getElementById('cancel-join-league')?.addEventListener('click', () => { closeModal('join-league-modal'); });

document.getElementById('confirm-join-league')?.addEventListener('click', async () => {
    const code = document.getElementById('join-league-code').value.trim().toUpperCase();
    const teamName = document.getElementById('join-team-name').value.trim();
    if (code.length < 4) { tg.showAlert("Некорректный код!"); return; }
    if (teamName.length < 3) { tg.showAlert("Название команды от 3 символов!"); return; }
    const btn = document.getElementById('confirm-join-league');
    btn.disabled = true; btn.innerText = "...";
    try {
        const res = await fetch('/api/leagues/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, user_name: userName, invite_code: code, team_name: teamName }) });
        const data = await res.json();
        if (res.ok) { tg.showAlert(`🎉 Вы успешно вступили в лигу:\n${data.league_name}`); closeModal('join-league-modal'); fetchMyLeagues(); } 
        else { tg.showAlert("❌ Ошибка: " + (data.detail || "Не удалось вступить")); }
    } catch (e) { tg.showAlert("❌ Ошибка сети"); } finally { btn.disabled = false; btn.innerText = "Вступить"; }
});

// ==========================================
// 8. СНЕЙК ДРАФТ (ЛОББИ И ДРАФТ-КОМНАТА)
// ==========================================
let currentDraftLeagueId = null;
let draftedPlayerIds = [];
let isMyDraftTurn = false;
let draftPollInterval = null;

async function openDraftLobby(leagueId) {
    currentDraftLeagueId = leagueId;
    openModal('draft-lobby-modal', 'flex');
    document.getElementById('lobby-members-list').innerHTML = "<div class='loading-text'>Загрузка лобби...</div>";
    
    try {
        const res = await fetch(`/api/leagues/${leagueId}/lobby?user_id=${userId}`);
        const data = await res.json();
        
        document.getElementById('lobby-league-title').innerText = data.name;
        
        const codeEl = document.getElementById('lobby-league-code');
        codeEl.innerText = data.invite_code;
        codeEl.className = 'spoiler';
        const newCodeEl = codeEl.cloneNode(true);
        codeEl.parentNode.replaceChild(newCodeEl, codeEl);
        newCodeEl.addEventListener('click', function(e) {
            e.stopPropagation();
            this.classList.add('revealed');
            navigator.clipboard.writeText(this.innerText).then(() => { tg.showAlert("✅ Invite Code скопирован!"); });
        });

        document.getElementById('lobby-members-count').innerText = `${data.members.length}/${data.max_members}`;
        
        let html = '';
        data.members.forEach(m => {
            html += `<div class="leaderboard-item ${m.is_me ? 'is-me' : ''}">
                <div class="lb-user-info"><div class="lb-team-name">${m.name}</div><div class="lb-manager-name">👤 ${m.manager}</div></div>
            </div>`;
        });
        document.getElementById('lobby-members-list').innerHTML = html;
        
        const startBtn = document.getElementById('start-draft-btn');
        const waitMsg = document.getElementById('lobby-wait-msg');
        
        if (data.is_commissioner) {
            startBtn.style.display = 'block';
            waitMsg.style.display = 'none';
            startBtn.onclick = () => startDraft(leagueId);
        } else {
            startBtn.style.display = 'none';
            waitMsg.style.display = 'block';
        }

    } catch (e) {
        document.getElementById('lobby-members-list').innerHTML = "<div class='loading-text'>Ошибка загрузки лобби.</div>";
    }
}
document.getElementById('close-lobby-btn')?.addEventListener('click', () => { closeModal('draft-lobby-modal'); });

async function startDraft(leagueId) {
    const btn = document.getElementById('start-draft-btn');
    btn.disabled = true; btn.innerText = "...";
    try {
        const res = await fetch(`/api/leagues/${leagueId}/start_draft?user_id=${userId}`, { method: 'POST' });
        if (res.ok) {
            tg.showAlert("✅ Драфт успешно запущен!");
            closeModal('draft-lobby-modal');
            openDraftRoom(leagueId, document.getElementById('lobby-league-title').innerText);
        } else {
            const data = await res.json();
            tg.showAlert("❌ Ошибка: " + (data.detail || "Не удалось запустить"));
        }
    } catch (e) {
        tg.showAlert("❌ Ошибка сети");
    } finally {
        btn.disabled = false; btn.innerText = "🚀 Начать Драфт";
    }
}

async function openDraftRoom(leagueId, leagueName) {
    currentDraftLeagueId = leagueId;
    document.getElementById('draft-room-title').innerText = leagueName;
    openModal('draft-room-modal', 'flex');
    
    await fetchDraftBoard(leagueId);

    // 🌟 АВТООБНОВЛЕНИЕ ДРАФТ КОМНАТЫ (ПОЛЛИНГ) 🌟
    if (draftPollInterval) clearInterval(draftPollInterval);
    draftPollInterval = setInterval(() => {
        if (document.getElementById('draft-room-modal').style.display === 'flex') {
            fetchDraftBoard(leagueId);
        } else {
            clearInterval(draftPollInterval);
        }
    }, 5000); // Каждые 5 секунд спрашиваем сервер, не забрал ли кто-то игрока
}
document.getElementById('close-draft-room-btn')?.addEventListener('click', () => { 
    closeModal('draft-room-modal'); 
    if (draftPollInterval) clearInterval(draftPollInterval);
});

// Запрашивать статус доски драфта с бэкенда
async function fetchDraftBoard(leagueId) {
    const banner = document.getElementById('draft-status-banner');
    if (!banner.innerText.includes('ТВОЙ ХОД')) {
        banner.innerText = "Обновление статуса...";
    }
    
    try {
        // ДОБАВИЛИ user_id в запрос!
        const res = await fetch(`/api/leagues/${leagueId}/draft_board?user_id=${userId}`);
        const data = await res.json();
        
        draftedPlayerIds = data.drafted_ids || [];
        
        // 🌟 Отрисовка моего состава (Трекер)
        window.myDraftCounts = { F: 0, D: 0, G: 0 };
        let miniHtml = '';
        if (data.my_roster && data.my_roster.length > 0) {
            data.my_roster.forEach(p => {
                window.myDraftCounts[p.pos]++;
                const posColor = p.pos === 'F' ? '#f87171' : (p.pos === 'D' ? '#60a5fa' : '#fbbf24');
                const shortName = p.name.split(' ').pop();
                miniHtml += `<div class="draft-mini-player"><span style="color:${posColor}; font-weight:bold;">${p.pos}</span> ${shortName}</div>`;
            });
        } else {
            miniHtml = '<div style="color: var(--text-muted); font-size: 11px;">Вы пока никого не выбрали</div>';
        }
        document.getElementById('draft-f-count').innerText = window.myDraftCounts.F;
        document.getElementById('draft-d-count').innerText = window.myDraftCounts.D;
        document.getElementById('draft-g-count').innerText = window.myDraftCounts.G;
        document.getElementById('draft-my-players-mini').innerHTML = miniHtml;

        // 🌟 Обновление баннера
        if (data.status === "drafting" && data.current_pick) {
            const cp = data.current_pick;
            isMyDraftTurn = cp.user_id === userId;
            
            if (isMyDraftTurn) {
                banner.innerText = `🟢 ТВОЙ ХОД! (Раунд ${cp.round}, Пик ${cp.pick})`;
                banner.classList.add('draft-turn-me');
                if (!banner.hasAttribute('data-turn-notified')) {
                    tg.HapticFeedback.notificationOccurred('warning');
                    banner.setAttribute('data-turn-notified', 'true');
                }
            } else {
                banner.innerText = `⏳ На часах: ${cp.manager} (Раунд ${cp.round}, Пик ${cp.pick})`;
                banner.style.background = "var(--glass-bg)";
                banner.style.color = "var(--text-muted)";
                banner.classList.remove('draft-turn-me');
                banner.removeAttribute('data-turn-notified');
            }
        } else if (data.status === "post_draft") {
            banner.innerText = "✅ Драфт завершен!";
            banner.style.background = "var(--accent-green)";
            isMyDraftTurn = false;
        }
        
        renderDraftPlayers();
    } catch (e) { console.error(e); }
}

function renderDraftPlayers() {
    const list = document.getElementById('draft-players-list');
    const search = document.getElementById('draft-search')?.value.toLowerCase() || "";
    const posFilter = document.getElementById('draft-pos-filter')?.value || 'ALL';
    const sortBy = document.getElementById('draft-sort')?.value || 'points_desc';

    // 🌟 ФИЛЬТРУЕМ УЖЕ ЗАБРАННЫХ ИГРОКОВ (ОНИ ИСЧЕЗАЮТ С РЫНКА)
    let available = allPlayers.filter(p => !draftedPlayerIds.includes(p.id));
    
    available = available.filter(p => p.name.toLowerCase().includes(search));
    if (posFilter !== 'ALL') available = available.filter(p => p.position === posFilter);

    if (sortBy === 'points_desc') available.sort((a, b) => b.points - a.points);
    if (sortBy === 'price_desc') available.sort((a, b) => b.price - a.price);

    list.innerHTML = '';
    available.slice(0, 50).forEach(p => {
        list.innerHTML += createPlayerCardHTML(p, false, true); // true = isDraftMode
    });
}

document.getElementById('draft-search')?.addEventListener('input', debounce(renderDraftPlayers, 400));
document.getElementById('draft-pos-filter')?.addEventListener('change', renderDraftPlayers);
document.getElementById('draft-sort')?.addEventListener('change', renderDraftPlayers);

// 🌟 СДЕЛАТЬ ПИК НА ДРАФТЕ С ПРОВЕРКОЙ ЛИМИТОВ
window.makeDraftPick = function(playerId, event) {
    if(event) event.stopPropagation();
    const p = allPlayers.find(pl => pl.id === playerId);
    
    // 🌟 Локальная защита от лишнего пика
    const limits = { F: 9, D: 6, G: 2 };
    if (window.myDraftCounts && window.myDraftCounts[p.position] >= limits[p.position]) {
        tg.showAlert(`Лимит на позицию ${p.position} исчерпан! Максимум: ${limits[p.position]}`);
        return;
    }
    
    tg.showConfirm(`Забрать в команду: ${p.name}?`, async (confirmed) => {
        if (confirmed) {
            try {
                const response = await fetch(`/api/leagues/${currentDraftLeagueId}/draft_pick`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId, player_id: playerId })
                });
                const data = await response.json();
                if (response.ok) {
                    tg.HapticFeedback.notificationOccurred('success');
                    fetchDraftBoard(currentDraftLeagueId); // Мгновенно обновляем доску!
                } else {
                    tg.showAlert("❌ Ошибка: " + (data.detail || "Не удалось сделать пик"));
                }
            } catch (e) {
                tg.showAlert("❌ Ошибка сети");
            }
        }
    });
};

// ==========================================
// 9. ПРОСМОТР ЧУЖИХ КОМАНД И ЛОГИ ИГРОКА
// ==========================================
window.viewOtherTeam = async function(otherUserId, teamName) {
    openModal('other-team-modal', 'flex'); 
    document.getElementById('other-team-title').innerText = teamName;
    const container = document.getElementById('other-team-rink-container');
    container.innerHTML = "<div class='loading-text'>Загрузка состава...</div>";

    try {
        const res = await fetch(`/api/my_team?user_id=${otherUserId}`);
        const data = await res.json();
        
        let html = `<div class="ice-rink" style="margin: 0 10px;">`;
        const positions = [{ key: 'F', title: 'Forwards', count: 9, rowSize: 3 }, { key: 'D', title: 'Defenders', count: 6, rowSize: 2 }, { key: 'G', title: 'Goalies', count: 2, rowSize: 2 }];

        positions.forEach(posGrp => {
            if (posGrp.key === 'D') html += `<div class="red-line"></div>`;
            if (posGrp.key === 'G') html += `<div class="blue-line"></div>`;
            html += `<div class="rink-section-title">${posGrp.title}</div>`;
            
            let playersOfPos = data.roster.filter(r => r.pos === posGrp.key);
            let slotsRendered = 0;
            
            while (slotsRendered < posGrp.count) {
                html += `<div class="rink-row ${posGrp.title.toLowerCase()}">`;
                for (let i = 0; i < posGrp.rowSize && slotsRendered < posGrp.count; i++) {
                    const pId = playersOfPos[slotsRendered] ? playersOfPos[slotsRendered].id : null;
                    let slotHtml = `<div class="player-slot"><div class="jersey empty">+</div><div class="slot-name">Empty</div></div>`;
                    
                    if (pId) {
                        const p = allPlayers.find(pl => pl.id === pId);
                        if (p) {
                            const bgColor = teamColors[p.team] || '#1e293b';
                            const textColor = ['BOS', 'NSH', 'PIT', 'VGK'].includes(p.team) ? '#000000' : '#ffffff';
                            const lastName = p.name.split(' ').pop();
                            const captainBadge = data.captain_id === p.id ? `<div class="captain-badge">C</div>` : '';
                            const logoUrl = `https://assets.nhle.com/logos/nhl/svg/${p.team}_light.svg`;
                            const jerseyInner = `<img src="${logoUrl}" class="jersey-logo" onload="this.nextElementSibling.style.display='none'" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span class="jersey-team-text">${p.team}</span>`;
                            
                            slotHtml = `
                                <div class="player-slot" onclick="openPlayerProfile(${p.id})" style="cursor:pointer;">
                                    ${captainBadge}
                                    <div class="jersey" style="background-color: ${bgColor}; color: ${textColor}; border: 2px solid ${bgColor};">${jerseyInner}</div>
                                    <div class="slot-name" style="color: #cbd5e1;">${lastName}</div>
                                </div>`;
                        }
                    }
                    html += slotHtml;
                    slotsRendered++;
                }
                html += `</div>`;
            }
        });
        html += `</div>`;
        container.innerHTML = html;
    } catch (e) { container.innerHTML = "<div class='loading-text'>Ошибка загрузки.</div>"; }
};
document.getElementById('close-other-team-btn')?.addEventListener('click', () => { closeModal('other-team-modal'); });

let currentPlayerLogs = [];
let showingAllLogs = false;
let currentPlayerLogPos = 'F';

window.openPlayerProfile = async function(playerId) {
    openModal('player-profile-modal', 'block'); 
    document.getElementById('player-logs-list').innerHTML = "<div class='loading-text'>Загрузка истории...</div>";
    document.getElementById('profile-name').innerText = "Загрузка...";
    document.getElementById('profile-season-stats').innerHTML = ""; 
    showingAllLogs = false;
    document.getElementById('toggle-logs-btn').innerText = "Показать весь сезон";

    try {
        const res = await fetch(`/api/player/${playerId}/logs`);
        const data = await res.json();
        
        document.getElementById('profile-name').innerText = data.player_name;
        currentPlayerLogs = data.logs;
        currentPlayerLogPos = data.position;
        
        const stats = data.season_stats;
        let statsHtml = '';
        if (stats) {
            if (data.position === 'G') {
                statsHtml = `
                    <div class="profile-stat-item"><span class="profile-stat-val">${stats.gamesPlayed || 0}</span><span class="profile-stat-lbl">GP</span></div>
                    <div class="profile-stat-item"><span class="profile-stat-val">${stats.savePctg ? stats.savePctg.toFixed(3) : '.000'}</span><span class="profile-stat-lbl">SV%</span></div>
                    <div class="profile-stat-item"><span class="profile-stat-val">${stats.goalsAgainstAvg ? stats.goalsAgainstAvg.toFixed(2) : '0.00'}</span><span class="profile-stat-lbl">GAA</span></div>
                    <div class="profile-stat-item"><span class="profile-stat-val">${stats.shutouts || 0}</span><span class="profile-stat-lbl">SO</span></div>
                `;
            } else {
                const ppg = stats.gamesPlayed > 0 ? (stats.points / stats.gamesPlayed).toFixed(2) : '0.00';
                statsHtml = `
                    <div class="profile-stat-item"><span class="profile-stat-val">${stats.gamesPlayed || 0}</span><span class="profile-stat-lbl">GP</span></div>
                    <div class="profile-stat-item"><span class="profile-stat-val">${stats.goals || 0}</span><span class="profile-stat-lbl">G</span></div>
                    <div class="profile-stat-item"><span class="profile-stat-val">${stats.assists || 0}</span><span class="profile-stat-lbl">A</span></div>
                    <div class="profile-stat-item"><span class="profile-stat-val">${ppg}</span><span class="profile-stat-lbl">PTS/G</span></div>
                `;
            }
            document.getElementById('profile-season-stats').innerHTML = `<div class="profile-season-box">${statsHtml}</div>`;
        }
        renderPlayerLogs();
    } catch (e) { document.getElementById('player-logs-list').innerHTML = "<div class='loading-text'>Ошибка загрузки</div>"; }
};

function renderPlayerLogs() {
    const list = document.getElementById('player-logs-list');
    if (currentPlayerLogs.length === 0) { list.innerHTML = "<div class='loading-text'>Нет сыгранных матчей</div>"; return; }

    const logsToShow = showingAllLogs ? currentPlayerLogs : currentPlayerLogs.slice(0, 5);
    
    let html = '';
    logsToShow.forEach(log => {
        let ptsClass = log.points > 0 ? 'pts-positive' : (log.points < 0 ? 'pts-negative' : 'pts-neutral');
        let ptsPrefix = log.points > 0 ? '+' : '';
        
        let statsGrid = '';
        if (currentPlayerLogPos === 'G') {
            statsGrid = `<div class="stat-box"><span>${log.raw.sv}</span><label>SV</label></div><div class="stat-box"><span>${log.raw.ga}</span><label>GA</label></div><div class="stat-box"><span>${log.raw.sv_pct}</span><label>SV%</label></div><div class="stat-box"><span>${log.raw.toi}</span><label>TOI</label></div>`;
        } else {
            const pmStr = log.raw.pm > 0 ? `+${log.raw.pm}` : log.raw.pm;
            statsGrid = `<div class="stat-box"><span>${log.raw.g}</span><label>G</label></div><div class="stat-box"><span>${log.raw.a}</span><label>A</label></div><div class="stat-box"><span style="color: ${log.raw.pm > 0 ? '#00E676' : (log.raw.pm < 0 ? '#ef4444' : 'white')}">${pmStr}</span><label>+/-</label></div><div class="stat-box"><span>${log.raw.toi}</span><label>TOI</label></div>`;
        }

        html += `<div class="log-card"><div class="log-header"><div class="log-date">📅 ${log.date}</div><div class="log-opp">vs ${log.opponent}</div><div class="log-pts ${ptsClass}">${ptsPrefix}${log.points} FC</div></div><div class="log-grid">${statsGrid}</div></div>`;
    });
    list.innerHTML = html;
}

document.getElementById('close-profile-btn')?.addEventListener('click', () => { closeModal('player-profile-modal'); });
document.getElementById('toggle-logs-btn')?.addEventListener('click', () => { showingAllLogs = !showingAllLogs; document.getElementById('toggle-logs-btn').innerText = showingAllLogs ? "Показать только 5" : "Показать весь сезон"; renderPlayerLogs(); });

// START
initApp();