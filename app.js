// ========================================
// COUP GAME - MAIN APPLICATION (ES Module)
// ========================================


// Estado local
let currentScreen = 'lobby';
let roomData = null;
let myPlayerData = null;
let selectedAction = null;
let selectedTarget = null;
let pendingChoice = null; // Para escolha de carta a perder, troca, etc.

// Elementos DOM
const screens = {
    lobby: document.getElementById('screen-lobby'),
    game: document.getElementById('screen-game'),
    end: document.getElementById('screen-end')
};

// Inicialização
function init() {
    // Inicializar RoomManager com Firebase config (agora garante que existe)
    RoomManager.initFirebase(window.firebaseConfig);
    
    setupEventListeners();
    setupRoomListeners();
    showScreen('lobby');
}

// Event Listeners UI
function setupEventListeners() {
    // Tabs do lobby
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    
    // Formulários
    document.getElementById('form-create').addEventListener('submit', handleCreateRoom);
    document.getElementById('form-join').addEventListener('submit', handleJoinRoom);
    document.getElementById('copy-code').addEventListener('click', copyRoomCode);
    document.getElementById('start-game').addEventListener('click', handleStartGame);
    document.getElementById('btn-new-game').addEventListener('click', handleNewGame);
    document.getElementById('btn-back-lobby').addEventListener('click', handleBackToLobby);
    document.getElementById('clear-log').addEventListener('click', clearLog);
    
    // House Rules - Toggle All
    document.getElementById('btn-toggle-all-rules').addEventListener('click', toggleAllHouseRules);
    
    // Regras
    document.getElementById('btn-rules').addEventListener('click', toggleRules);
    document.getElementById('btn-close-rules').addEventListener('click', closeRules);
    
    // Modais (botões de contestação recebem onclick dinâmico)
    document.getElementById('btn-confirm-exchange').addEventListener('click', handleConfirmExchange);
    // Overlay não fecha modais: respostas são obrigatórias (o prazo resolve omissões)

    // Relógio: contagem regressiva e timeout (só o jogador da vez grava)
    setInterval(tickResponseTimer, 1000);
    
    // Ação cancelar
    document.getElementById('btn-challenge-action').addEventListener('click', respondChallenge);
    document.getElementById('btn-cancel-action').addEventListener('click', cancelAction);
}

// Room Manager Listeners
function setupRoomListeners() {
    RoomManager.on('room-update', handleRoomUpdate);
    RoomManager.on('room-deleted', handleRoomDeleted);
    RoomManager.on('left-room', handleLeftRoom);
}

// ========================================
// HANDLERS DE TELA
// ========================================

function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
    currentScreen = screenName;
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    
    document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(`tab-${tab}`).classList.remove('hidden');
}

// ========================================
// HANDLERS DE LOBBY
// ========================================

async function handleCreateRoom(e) {
    e.preventDefault();
    const name = document.getElementById('creator-name').value.trim();
    const maxPlayers = document.getElementById('player-count').value;
    
    if (!name) return alert('Digite seu nome');
    
    try {
        showLoading(true);
        const result = await RoomManager.createRoom(name, maxPlayers);
        // Ir direto para a tela de jogo (mesa) para aguardar jogadores
        showScreen('game');
    } catch (error) {
        alert('Erro ao criar sala: ' + error.message);
    } finally {
        showLoading(false);
    }
}

async function handleJoinRoom(e) {
    e.preventDefault();
    const name = document.getElementById('player-name').value.trim();
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();
    
    if (!name || !code) return;
    
    try {
        showLoading(true);
        await RoomManager.joinRoom(name, code);
        // Ir para a tela de jogo (mesa) após entrar
        showScreen('game');
    } catch (error) {
        showJoinError(error.message);
    } finally {
        showLoading(false);
    }
}

function showRoomCreated(code) {
    document.getElementById('form-create').classList.add('hidden');
    document.getElementById('room-created').classList.remove('hidden');
    document.getElementById('room-code-display').textContent = code;
}

function copyRoomCode() {
    const code = document.getElementById('room-code-display').textContent;
    navigator.clipboard.writeText(code).then(() => {
        const btn = document.getElementById('copy-code');
        btn.textContent = '✓';
        setTimeout(() => btn.textContent = '📋', 1500);
    });
}

function showJoinError(message) {
    const el = document.getElementById('join-error');
    el.textContent = message;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 5000);
}

async function handleStartGame() {
    try {
        // Coleta house rules selecionadas
        const houseRules = {};
        document.querySelectorAll('input[name="houseRule"]:checked').forEach(cb => {
            houseRules[cb.value] = true;
        });
        
        // Sempre ativar variante 2 jogadores se houver 2 jogadores
        // (Isso será determinado no RoomManager baseado no número de jogadores)
        
        await RoomManager.startGame(houseRules);
    } catch (error) {
        alert(error.message);
    }
}

function handleNewGame() {
    RoomManager.leaveRoom();
    showScreen('lobby');
    switchTab('create');
    resetGameUI();
}

function handleBackToLobby() {
    RoomManager.leaveRoom();
    showScreen('lobby');
    resetGameUI();
}

// ========================================
// HANDLERS DE SALA/JOGO
// ========================================

// Fonte única de jogadores: durante o jogo usa gameState.players, na espera usa room.players
function getPlayers(room) {
    return (room && room.gameState && room.gameState.players) || (room && room.players) || {};
}

function handleRoomUpdate(room) {
    GameLogic.normalizeState(room.gameState);
    roomData = room;
    myPlayerData = getPlayers(room)[RoomManager.getCurrentPlayerId()];
    
    if (room.status === 'waiting') {
        // Se estiver na tela de lobby, ir para a tela de jogo (mesa)
        if (currentScreen === 'lobby') {
            showScreen('game');
        }
        updateGameWaiting(room);
    } else if (room.status === 'playing') {
        // Jogo terminou: gameState.phase vira 'finished' mas room.status continua 'playing'
        if (room.gameState?.phase === 'finished' && room.gameState?.winner) {
            showEndScreen(room);
            return;
        }
        showScreen('game');
        updateGameUI(room);
    } else if (room.status === 'finished') {
        showEndScreen(room);
    }
}

function updateLobbyWaiting(room) {
    const waitingList = document.getElementById('waiting-players');
    const startBtn = document.getElementById('start-game');
    const isCreator = RoomManager.isCreator(room);
    
    waitingList.innerHTML = '';
    
    const players = Object.values(getPlayers(room)).sort((a, b) => a.order - b.order);
    players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'waiting-player';
        div.innerHTML = `
            <div class="player-avatar">${p.name.charAt(0).toUpperCase()}</div>
            <span class="player-name-tag">${p.name}</span>
            ${p.id === RoomManager.getCurrentPlayerId() ? '<span class="player-you-badge">VOCÊ</span>' : ''}
            ${p.isCreator ? '<span class="player-you-badge" style="background:var(--accent-gold);color:var(--bg-dark)">CRIADOR</span>' : ''}
        `;
        waitingList.appendChild(div);
    });
    
    startBtn.classList.toggle('hidden', !isCreator);
    startBtn.disabled = players.length < 2;
}

function updateGameWaiting(room) {
    updateHeader(room);
    
    // Adicionar botão "Iniciar Jogo" no header se for criador
    const isCreator = RoomManager.isCreator(room);
    let startBtn = document.getElementById('start-game-btn');
    if (isCreator && !startBtn) {
        startBtn = document.createElement('button');
        startBtn.id = 'start-game-btn';
        startBtn.className = 'btn btn-primary';
        startBtn.textContent = 'Iniciar Jogo';
        startBtn.style.marginLeft = '1rem';
        startBtn.addEventListener('click', handleStartGame);
        document.querySelector('.room-info-top').appendChild(startBtn);
    }
    if (startBtn) {
        startBtn.classList.toggle('hidden', !isCreator);
        startBtn.disabled = (Object.values(getPlayers(room)).length < 2);
    }
    
    // Mostrar jogadores na área de oponentes
    const opponentsArea = document.getElementById('opponents-area');
    opponentsArea.innerHTML = '';
    
    const players = Object.values(getPlayers(room)).sort((a, b) => a.order - b.order);
    const currentPlayerId = RoomManager.getCurrentPlayerId();
    
    players.forEach(p => {
        const isCurrent = p.id === currentPlayerId;
        const div = document.createElement('div');
        div.className = `opponent-card ${isCurrent ? 'current-turn' : ''}`;
        div.innerHTML = `
            <div class="opponent-avatar">${p.name.charAt(0).toUpperCase()}</div>
            <div class="opponent-name">${p.name}${isCurrent ? ' (Você)' : ''}</div>
            <div class="opponent-stats">
                <span class="opponent-coins">💰 ${p.coins}</span>
                <div class="opponent-influences">
                    ${Array.from({length: 2}, () => '<div class="influence-card"></div>').join('')}
                </div>
            </div>
            ${isCurrent && p.isCreator ? '<div class="creator-badge">CRIADOR</div>' : ''}
        `;
        opponentsArea.appendChild(div);
    });
    
    // Esconder painel de ações e mão do jogador (jogo não começou)
    document.getElementById('actions-panel').classList.add('hidden');
    document.getElementById('player-hand').innerHTML = '<p style="color:var(--text-muted);text-align:center;width:100%">Aguardando jogadores...<br><small>O jogo inicia quando o criador clicar em \"Iniciar Jogo\"</small></p>';
    document.getElementById('coin-count').textContent = '2';
    
    // Log de espera
    // Histórico da espera: criação + cada jogador que entrou (ordem de chegada)
    const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
    document.getElementById('log-content').innerHTML =
        `<div class="log-entry turn-start">Sala <strong>${esc(room.code)}</strong> criada por <span class="log-player">${esc(room.creatorName)}</span>.</div>` +
        players.filter(p => !p.isCreator).map(p => `<div class="log-entry result"><span class="log-player">${esc(p.name)}</span> entrou na sala.</div>`).join('') +
        `<div class="log-entry">Aguardando jogadores... (${players.length}/${room.maxPlayers})</div>`;
}

function updateGameUI(room) {
    updateHeader(room);
    updateOpponents(room);
    updatePlayerHand(room);
    updateActionsPanel(room);
    updateGameLog(room);
    checkForChallenges(room);
}

function updateHeader(room) {
    const codeEl = document.getElementById('current-room-code');
    codeEl.textContent = room.code;
    
    // Botão copiar código da sala (se não existir)
    let copyBtn = document.getElementById('copy-room-code-btn');
    if (!copyBtn) {
        copyBtn = document.createElement('button');
        copyBtn.id = 'copy-room-code-btn';
        copyBtn.className = 'btn btn-secondary btn-small';
        copyBtn.title = 'Copiar código da sala';
        copyBtn.innerHTML = '📋';
        copyBtn.style.marginLeft = '0.5rem';
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(room.code).then(() => {
                copyBtn.textContent = '✓';
                setTimeout(() => copyBtn.textContent = '📋', 1500);
            });
        });
        codeEl.parentNode.insertBefore(copyBtn, codeEl.nextSibling);
    }
    
    // House Rules indicator
    const hr = room.gameState?.houseRules;
    if (hr && Object.keys(hr).some(k => hr[k])) {
        const activeRules = Object.entries(hr).filter(([k, v]) => v).map(([k]) => k);
        let hrEl = document.getElementById('house-rules-badge');
        if (!hrEl) {
            hrEl = document.createElement('span');
            hrEl.id = 'house-rules-badge';
            hrEl.className = 'house-rules-badge';
            document.querySelector('.room-info-top').appendChild(hrEl);
        }
        hrEl.innerHTML = `⚙️ ${activeRules.map(formatHouseRuleName).join(', ')}`;
        hrEl.classList.remove('hidden');
    } else {
        const hrEl = document.getElementById('house-rules-badge');
        if (hrEl) hrEl.classList.add('hidden');
    }
    
    const turnBadge = document.getElementById('turn-indicator');
    const isMyTurn = RoomManager.isMyTurn(room);
    turnBadge.classList.toggle('hidden', !isMyTurn);
    
    // Players bar
    const playersBar = document.getElementById('players-bar');
    playersBar.innerHTML = '';
    
    const players = Object.values(getPlayers(room)).sort((a, b) => a.order - b.order);
    players.forEach(p => {
        const alive = p.alive && room.gameState?.phase !== 'finished';
        const isCurrentTurn = room.gameState?.currentTurn === p.id;
        
        const div = document.createElement('div');
        div.className = `player-mini ${isCurrentTurn ? 'current-turn' : ''} ${!alive ? 'eliminated' : ''}`;
        div.innerHTML = `
            <div class="player-mini-avatar">${p.name.charAt(0).toUpperCase()}</div>
            <div class="player-mini-info">
                <span class="player-mini-name">${p.name}${p.id === RoomManager.getCurrentPlayerId() ? ' (Você)' : ''}</span>
                <div class="player-mini-stats">
                    <span class="coin-mini">💰 ${p.coins}</span>
                    <div class="influence-count">
                        ${(p.influences || []).map(() => '<div class="influence-dot"></div>').join('')}
                        ${(p.lost || []).map(() => '<div class="influence-dot lost"></div>').join('')}
                    </div>
                </div>
            </div>
        `;
        playersBar.appendChild(div);
    });
}

function updateOpponents(room) {
    const area = document.getElementById('opponents-area');
    area.innerHTML = '';
    
    const players = Object.values(getPlayers(room)).filter(p => p.id !== RoomManager.getCurrentPlayerId());
    const gameState = room.gameState;
    const currentTurn = gameState?.currentTurn;
    const pendingAction = gameState?.pendingAction;
    
    players.forEach(p => {
        const isTarget = pendingAction && pendingAction.targetId === p.id;
        const isCurrentTurn = currentTurn === p.id;
        
        const div = document.createElement('div');
        div.className = `opponent-card ${isTarget ? 'current-target' : ''} ${isCurrentTurn ? 'current-turn' : ''} ${p.alive ? '' : 'eliminated'}`;
        // Cartas vivas: verso. Perdidas: viradas, com imagem do personagem.
        div.innerHTML = `
            <div class="opponent-avatar">${p.name.charAt(0).toUpperCase()}</div>
            <div class="opponent-name">${p.name}</div>
            <div class="opponent-stats">
                <span class="opponent-coins">💰 ${p.coins}</span>
                <div class="opponent-influences">
                    ${(p.influences || []).map(() => '<div class="influence-card"></div>').join('')}
                    ${(p.lost || []).map(c => lostCardMini(c)).join('')}
                </div>
            </div>
        `;
        
        // Clique para selecionar alvo (só vivos)
        if (p.alive && selectedAction && GameLogic.requiresTarget(selectedAction) && !isCurrentTurn) {
            div.style.cursor = 'pointer';
            div.addEventListener('click', () => selectTarget(p.id));
        }
        
        area.appendChild(div);
    });
}

function updatePlayerHand(room) {
    const hand = document.getElementById('player-hand');
    hand.innerHTML = '';
    
    if (!myPlayerData) return;

    myPlayerData.influences.forEach((char, index) => hand.appendChild(createCardElement(char, index, false)));
    // Cartas perdidas ficam viradas na mão
    (myPlayerData.lost || []).forEach((char, index) => hand.appendChild(createCardElement(char, index, true)));

    if (!myPlayerData.alive) {
        hand.insertAdjacentHTML('beforeend', '<p style="color:var(--text-muted);text-align:center;width:100%">Você foi eliminado. Aguarde o fim da partida.</p>');
    }
    
    // Moedas
    document.getElementById('coin-count').textContent = myPlayerData.coins;
}

function lostCardMini(character) {
    const label = GameLogic.CHARACTER_LABELS[character];
    return `<div class="influence-card revealed" title="${label} (perdida)"><img src="${getCharacterImage(character)}" alt="${label}"></div>`;
}

function createCardElement(character, index, revealed) {
    const card = document.createElement('div');
    card.className = `hand-card ${revealed ? 'revealed' : ''}`;
    card.dataset.index = index;
    card.dataset.character = character;
    
    const imgSrc = getCharacterImage(character);
    
    card.innerHTML = `
        <img src="${imgSrc}" alt="${GameLogic.CHARACTER_LABELS[character]}" class="card-image">
        <div class="card-back">${GameLogic.CHARACTER_ICONS[character]}</div>
        <span class="card-label">${GameLogic.CHARACTER_LABELS[character]}</span>
    `;
    if (revealed) card.title = 'Influência perdida';
    return card;
}

function updateActionsPanel(room) {
    // Botão Contestar: aparece para quem pode contestar a ação em andamento
    const gs = room.gameState, me = RoomManager.getCurrentPlayerId();
    document.getElementById('btn-challenge-action').classList.toggle('hidden',
        !(gs?.phase === 'challenge_block' && !gs.passes?.[me] && GameLogic.canChallengeAction(gs, me) && myPlayerData?.alive));

    const panel = document.getElementById('actions-panel');
    const grid = document.getElementById('actions-grid');
    
    if (!myPlayerData || !myPlayerData.alive) {
        panel.classList.add('hidden');
        return;
    }
    
    const isMyTurn = RoomManager.isMyTurn(room);
    const phase = room.gameState?.phase;
    
    if (!isMyTurn || phase !== 'action') {
        panel.classList.add('hidden');
        return;
    }
    
    panel.classList.remove('hidden');
    grid.innerHTML = '';
    
    const actions = GameLogic.getAvailableActions(myPlayerData, room.gameState);
    
    actions.forEach(action => {
        const btn = document.createElement('button');
        btn.className = `action-btn ${action.primary ? 'primary-action' : ''} ${action.bluff ? 'bluff' : ''} ${action.blockable ? 'blockable' : ''} ${action.disabled ? '' : ''}`;
        btn.disabled = action.disabled || false;
        
        const icon = getActionIcon(action.id);
        
        btn.innerHTML = `
            <span class="action-icon">${icon}</span>
            <span>${action.label}</span>
            ${action.cost > 0 ? `<span class="action-cost">${action.cost} moedas</span>` : ''}
            ${action.bluff ? '<span class="action-cost" style="color:var(--accent-gold)">BLEFE</span>' : ''}
            ${action.forced ? '<span class="action-cost" style="color:var(--accent-red)">OBRIGATÓRIO</span>' : ''}
        `;
        
        if (!action.disabled) {
            btn.addEventListener('click', () => selectAction(action.id));
        }
        
        grid.appendChild(btn);
    });
}

function updateGameLog(room) {
    const content = document.getElementById('log-content');
    content.innerHTML = '';
    
    const logs = room.gameState?.logs || {};
    const sortedLogs = Object.entries(logs).sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    sortedLogs.forEach(([id, log]) => {
        const div = document.createElement('div');
        div.className = `log-entry ${log.type}`;
        div.innerHTML = log.message;
        content.appendChild(div);
    });
    
    content.scrollTop = content.scrollHeight;
}

function clearLog() {
    document.getElementById('log-content').innerHTML = '';
}

// ========================================
// SELEÇÃO DE AÇÕES E ALVOS
// ========================================

function selectAction(actionId) {
    selectedAction = actionId;
    selectedTarget = null;
    
    const requiresTarget = GameLogic.requiresTarget(actionId);
    
    if (requiresTarget) {
        addLocalLog(`Selecione um alvo para <strong>${GameLogic.ACTION_LABELS[actionId]}</strong>`);
        highlightValidTargets(true);
    } else {
        executeAction(actionId, null);
    }
    
    updateOpponents(roomData);
    updateActionsPanel(roomData);
}

function selectTarget(playerId) {
    if (!selectedAction) return;
    
    selectedTarget = playerId;
    executeAction(selectedAction, playerId);
    
    selectedAction = null;
    highlightValidTargets(false);
    updateOpponents(roomData);
}

// Desiste da ação escolhida (antes de escolher o alvo)
function cancelAction() {
    selectedAction = null;
    selectedTarget = null;
    highlightValidTargets(false);
    updateOpponents(roomData);
    updateActionsPanel(roomData);
}

function highlightValidTargets(highlight) {
    document.querySelectorAll('.opponent-card').forEach(card => {
        card.style.pointerEvents = highlight ? 'auto' : 'none';
    });
}

function executeAction(actionId, targetId) {
    const gameState = roomData.gameState;
    const playerId = RoomManager.getCurrentPlayerId();
    
    switch (actionId) {
        case GameLogic.ACTIONS.INCOME:
            GameLogic.processIncome(gameState, playerId);
            break;
        case GameLogic.ACTIONS.FOREIGN_AID:
            GameLogic.processForeignAid(gameState, playerId);
            break;
        case GameLogic.ACTIONS.TAX:
            GameLogic.processTax(gameState, playerId);
            break;
        case GameLogic.ACTIONS.COUP:
            GameLogic.processCoup(gameState, playerId, targetId);
            break;
        case GameLogic.ACTIONS.ASSASSINATE:
            GameLogic.processAssassinate(gameState, playerId, targetId);
            break;
        case GameLogic.ACTIONS.STEAL:
            GameLogic.processSteal(gameState, playerId, targetId);
            break;
        case GameLogic.ACTIONS.EXCHANGE:
            GameLogic.processExchange(gameState, playerId);
            break;
        case GameLogic.ACTIONS.INQ_EXCHANGE:
            GameLogic.processInqExchange(gameState, playerId);
            break;
        case GameLogic.ACTIONS.EXAMINE:
            GameLogic.processExamine(gameState, playerId, targetId);
            break;
    }
    
    RoomManager.updateGameState(gameState);
}

// ========================================
// HANDLERS DE MODAIS
// ========================================

function showLoseInfluenceModal() {
    const modal = document.getElementById('modal-lose-influence');
    if (!modal.classList.contains('hidden')) return; // já aberto
    if (!myPlayerData || !myPlayerData.influences?.length) return;

    // Só uma carta: perde automaticamente
    if (myPlayerData.influences.length === 1) {
        loseCard(myPlayerData.influences[0]);
        return;
    }

    closeAllModals();
    const choiceDiv = document.getElementById('card-choice');
    choiceDiv.innerHTML = '';
    
    myPlayerData.influences.forEach((char, index) => {
        const card = document.createElement('div');
        card.className = 'choice-card';
        card.dataset.index = index;
        card.dataset.character = char;
        
        const imgSrc = getCharacterImage(char);
        card.innerHTML = `
            <img src="${imgSrc}" alt="${GameLogic.CHARACTER_LABELS[char]}" class="choice-card-img">
            <div class="choice-card-back">${GameLogic.CHARACTER_ICONS[char]}</div>
        `;
        
        // Clique revela a carta (sem botão de confirmar no modal)
        card.addEventListener('click', () => loseCard(char));
        
        choiceDiv.appendChild(card);
    });
    
    showModal(modal);
}

function loseCard(character) {
    const gameState = roomData.gameState;
    GameLogic.processLoseInfluence(gameState, RoomManager.getCurrentPlayerId(), character);
    RoomManager.updateGameState(gameState);
    closeAllModals();
}

function handleExchangePhase(gameState) {
    const modal = document.getElementById('modal-exchange');
    if (!modal.classList.contains('hidden')) return; // já aberto
    closeAllModals();

    const playerId = RoomManager.getCurrentPlayerId();
    const player = gameState.players[playerId];
    const drawn = gameState.exchangeOffer || []; // sorteadas em applyPendingAction
    
    const handDiv = document.getElementById('exchange-hand');
    const deckDiv = document.getElementById('deck-cards');
    
    handDiv.innerHTML = '';
    deckDiv.innerHTML = '';
    
    player.influences.forEach((char, index) => {
        const card = createExchangeCard(char, index, 'hand');
        handDiv.appendChild(card);
    });
    
    drawn.forEach((char, index) => {
        const card = createExchangeCard(char, index, 'deck');
        deckDiv.appendChild(card);
    });
    
    showModal(modal);
}

function createExchangeCard(character, index, source) {
    const card = document.createElement('div');
    card.className = `${source === 'hand' ? 'exchange-card' : 'deck-card'}`;
    card.dataset.index = index;
    card.dataset.character = character;
    card.dataset.source = source;
    
    const imgSrc = getCharacterImage(character);
    card.innerHTML = `<img src="${imgSrc}" alt="${GameLogic.CHARACTER_LABELS[character]}" class="${source === 'hand' ? 'exchange-card-img' : 'deck-card-img'}">`;
    
    card.addEventListener('click', () => {
        card.classList.toggle('selected');
        updateExchangeConfirm();
    });
    
    return card;
}

// Mantém tantas cartas quanto tinha antes da troca
function exchangeKeepCount() {
    return myPlayerData?.influences?.length || 2;
}

function updateExchangeConfirm() {
    const selected = document.querySelectorAll('.exchange-card.selected, .deck-card.selected');
    const btn = document.getElementById('btn-confirm-exchange');
    btn.classList.toggle('hidden', selected.length !== exchangeKeepCount());
}

function handleConfirmExchange() {
    const selected = document.querySelectorAll('.exchange-card.selected, .deck-card.selected');
    if (selected.length !== exchangeKeepCount()) return;
    
    const keptCards = Array.from(selected).map(c => c.dataset.character);
    const gameState = roomData.gameState;
    const playerId = RoomManager.getCurrentPlayerId();
    
    GameLogic.processExchangeComplete(gameState, playerId, keptCards);
    RoomManager.updateGameState(gameState);
    
    closeAllModals();
}

// ========================================
// MODAL HELPERS
// ========================================

function showModal(modal) {
    document.getElementById('modal-overlay').classList.remove('hidden');
    modal.classList.remove('hidden');
}

function closeAllModals() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

// ========================================
// DESAFIOS E BLOQUEIOS (Outros jogadores)
// ========================================

function checkForChallenges(room) {
    const gameState = room.gameState;
    if (!gameState) return;

    const playerId = RoomManager.getCurrentPlayerId();
    const isMyTurn = gameState.currentTurn === playerId;
    const phase = gameState.phase;

    const responding = GameLogic.getResponders(gameState).includes(playerId) && !gameState.passes?.[playerId];
    const modalKey = `${phase}|${gameState.deadline}`;

    // Fecha modais quando nada é exigido deste jogador
    const needsMe = responding
        || (phase === 'lose_influence' && gameState.pendingLoss?.playerId === playerId)
        || (phase === 'exchange' && isMyTurn)
        || (phase === 'examine_show' && gameState.pendingAction?.targetId === playerId)
        || (phase === 'examine_decide' && isMyTurn);
    if (!needsMe) { closeAllModals(); shownModalKey = null; }

    // Investigar: alvo escolhe carta a mostrar; Inquisidor decide
    if ((phase === 'examine_show' || phase === 'examine_decide') && needsMe) {
        if (shownModalKey !== modalKey) showExamineModal(gameState, phase);
        shownModalKey = modalKey;
        return;
    }

    // Fase de contestação/bloqueio (todos vivos exceto o autor)
    if (phase === 'challenge_block' && responding) {
        if (shownModalKey !== modalKey) showChallengeModal(gameState.pendingAction);
        shownModalKey = modalKey;
        return;
    }

    // Fase de resposta a bloqueio (autor da ação decide contestar o bloqueio)
    if (phase === 'challenge_block_response' && responding) {
        if (shownModalKey !== modalKey) showBlockResponseModal(gameState.pendingBlock);
        shownModalKey = modalKey;
        return;
    }

    // Resolve contestação: apenas o jogador da vez executa para evitar escritas duplicadas
    if (phase === 'resolve_challenge' && isMyTurn) {
        GameLogic.resolveChallenge(gameState);
        RoomManager.updateGameState(gameState);
        return;
    }

    // Perda de influência: quem perde escolhe a carta
    if (phase === 'lose_influence' && gameState.pendingLoss?.playerId === playerId) {
        showLoseInfluenceModal();
        return;
    }

    // Troca (Embaixadora): apenas quem fez a ação
    if (phase === 'exchange' && isMyTurn) {
        handleExchangePhase(gameState);
        return;
    }
}

let shownModalKey = null;

// Monta modal de resposta com botões dinâmicos [{label, cls, fn}]
function showResponseModal(titleText, html, buttons) {
    const modal = document.getElementById('modal-challenge');
    document.getElementById('challenge-title').textContent = titleText;
    document.getElementById('challenge-text').innerHTML =
        html + (roomData?.gameState?.deadline ? `<div class="response-timer">⏳ <span id="response-countdown"></span>s</div>` : '');
    const box = modal.querySelector('.modal-actions');
    box.innerHTML = '';
    buttons.forEach(b => {
        const btn = document.createElement('button');
        btn.className = `btn ${b.cls}`;
        btn.textContent = b.label;
        btn.onclick = b.fn;
        box.appendChild(btn);
    });
    tickResponseTimer();
    showModal(modal);
}

// Investigar (Inquisidor): reaproveita modal de resposta, sem timer
function showExamineModal(gameState, phase) {
    const action = gameState.pendingAction;
    const target = gameState.players[action.targetId];
    const send = fn => () => { fn(); RoomManager.updateGameState(gameState); closeAllModals(); };
    let title, html, buttons;
    if (phase === 'examine_show') {
        title = 'Investigação';
        html = `${gameState.players[action.playerId].name} (Inquisidor) quer ver uma carta sua. Escolha qual mostrar:`;
        buttons = [...new Set(target.influences)].map(ch => ({
            label: GameLogic.CHARACTER_LABELS[ch], cls: 'btn-secondary',
            fn: send(() => GameLogic.processExamineShow(gameState, target.id, ch))
        }));
    } else {
        title = 'Investigação';
        html = `${target.name} mostrou: <strong>${GameLogic.CHARACTER_LABELS[gameState.examinedCard]}</strong>`;
        buttons = [
            { label: 'Devolver', cls: 'btn-primary', fn: send(() => GameLogic.processExamineDecide(gameState, action.playerId, false)) },
            { label: 'Forçar troca', cls: 'btn-danger', fn: send(() => GameLogic.processExamineDecide(gameState, action.playerId, true)) }
        ];
    }
    showResponseModal(title, html, buttons);
}

function showChallengeModal(action) {
    const gameState = roomData.gameState;
    const me = RoomManager.getCurrentPlayerId();
    const actor = getPlayers(roomData)[action.playerId];
    const target = action.targetId ? getPlayers(roomData)[action.targetId] : null;
    const label = GameLogic.ACTION_LABELS[action.type];

    const buttons = [];
    if (GameLogic.canChallengeAction(gameState, me)) buttons.push({ label: 'Contestar', cls: 'btn-danger', fn: respondChallenge });
    {
        // Bloqueio é declaração: blefe permitido exceto na 1ª rodada (house rule)
        GameLogic.blockOptions(gameState, me).forEach(ch => buttons.push({
            label: `Bloquear (${GameLogic.CHARACTER_LABELS[ch]})`, cls: 'btn-secondary', fn: () => respondBlock(ch)
        }));
    }
    buttons.push({ label: 'Permitir', cls: 'btn-primary', fn: respondPass });

    showResponseModal('Responder Ação',
        `${actor.name} usou <strong>${label}</strong>${target ? ` em <strong>${target.name}</strong>` : ''}.`,
        buttons);
}

function showBlockResponseModal(block) {
    const blocker = getPlayers(roomData)[block.blockerId];
    showResponseModal('Contestar Bloqueio?',
        `${blocker.name} bloqueou com <strong>${GameLogic.CHARACTER_LABELS[block.claimedCharacter]}</strong>.`,
        [
            { label: 'Contestar', cls: 'btn-danger', fn: respondChallenge },
            { label: 'Aceitar bloqueio', cls: 'btn-primary', fn: respondPass }
        ]);
}

function respondChallenge() {
    const gameState = roomData.gameState;
    GameLogic.processChallenge(gameState, RoomManager.getCurrentPlayerId());
    RoomManager.updateGameState(gameState);
    closeAllModals();
}

function respondBlock(character) {
    const gameState = roomData.gameState;
    GameLogic.processBlock(gameState, RoomManager.getCurrentPlayerId(), character);
    RoomManager.updateGameState(gameState);
    closeAllModals();
}

// Permitir: grava só o próprio voto (evita sobrescrever votos simultâneos)
function respondPass() {
    RoomManager.setPass(RoomManager.getCurrentPlayerId());
    closeAllModals();
}

// A cada segundo: atualiza contagem; o jogador da vez resolve quando todos permitiram ou o prazo expira
function tickResponseTimer() {
    const gs = roomData?.gameState;
    const el = document.getElementById('response-countdown');
    if (!gs || !gs.deadline) return;
    if (el) el.textContent = Math.max(0, Math.ceil((gs.deadline - GameLogic.nowMs()) / 1000));

    if (gs.currentTurn !== RoomManager.getCurrentPlayerId()) return;
    if (!['challenge_block', 'challenge_block_response'].includes(gs.phase)) return;
    if (GameLogic.allPassed(gs)) {
        GameLogic.resolveUncontested(gs);
        RoomManager.updateGameState(gs);
    } else if (GameLogic.checkTimeout(gs)) {
        RoomManager.updateGameState(gs);
    }
}

// ========================================
// TELA DE FIM DE JOGO
// ========================================

function showEndScreen(room) {
    showScreen('end');
    
    const gameState = room.gameState;
    const winner = getPlayers(room)[gameState.winner];
    
    document.getElementById('winner-display').innerHTML = `
        <div class="winner-avatar">${winner.name.charAt(0).toUpperCase()}</div>
        <div class="winner-name">${winner.name}</div>
        <div class="winner-title">Venceu a partida! 🏆</div>
    `;
    
    const ranking = document.getElementById('final-ranking');
    ranking.innerHTML = '';
    
    const players = Object.values(getPlayers(room)).sort((a, b) => {
        if (a.id === gameState.winner) return -1;
        if (b.id === gameState.winner) return 1;
        return a.order - b.order;
    });
    
    players.forEach((p, index) => {
        const isWinner = p.id === gameState.winner;
        const div = document.createElement('div');
        div.className = 'ranking-item';
        div.innerHTML = `
            <div class="rank-number">${index + 1}</div>
            <div class="ranking-avatar">${p.name.charAt(0).toUpperCase()}</div>
            <div class="ranking-info">
                <div class="ranking-name">${p.name}${p.id === RoomManager.getCurrentPlayerId() ? ' (Você)' : ''}</div>
                <div class="ranking-status ${isWinner ? 'winner' : 'eliminated'}">${isWinner ? 'Vencedor' : 'Eliminado'}</div>
            </div>
        `;
        ranking.appendChild(div);
    });
}

// ========================================
// REGRAS
// ========================================

function toggleRules() {
    const panel = document.getElementById('rules-panel');
    panel.classList.toggle('open');
}

function closeRules() {
    document.getElementById('rules-panel').classList.remove('open');
}

// ========================================
// UTILITÁRIOS
// ========================================

function formatHouseRuleName(key) {
    const names = {
        mustCoupAt10: 'Coup@10',
        noBluffFirstRound: 'SemBlefe1ª',
        revealAllOnDeath: 'RevelaMorte',
        assassinCosts2: 'Assassino2💰',
        withInquisitor: 'Inquisidor',
        twoPlayerVariant: '2Jog=3Cartas'
    };
    return names[key] || key;
}

function getCharacterImage(character) {
    return `assets/${character}.svg`;
}

function getActionIcon(actionId) {
    const icons = {
        income: '💰',
        foreign_aid: '🤝',
        tax: '👑',
        coup: '⚔️',
        assassinate: '🗡️',
        steal: '💸',
        exchange: '🔄',
        inq_exchange: '🔁',
        examine: '🔍'
    };
    return icons[actionId] || '❓';
}

function addLocalLog(message) {
    const content = document.getElementById('log-content');
    const div = document.createElement('div');
    div.className = 'log-entry action';
    div.innerHTML = message;
    content.appendChild(div);
    content.scrollTop = content.scrollHeight;
}

function showLoading(show) {
    // Implementar loading visual se necessário
}

function resetGameUI() {
    roomData = null;
    myPlayerData = null;
    selectedAction = null;
    selectedTarget = null;
    pendingChoice = null;
    
    // Remover elementos criados dinamicamente
    const startBtn = document.getElementById('start-game-btn');
    if (startBtn) startBtn.remove();
    
    const copyBtn = document.getElementById('copy-room-code-btn');
    if (copyBtn) copyBtn.remove();
    
    const hrBadge = document.getElementById('house-rules-badge');
    if (hrBadge) hrBadge.remove();
    
    document.getElementById('form-create').classList.remove('hidden');
    document.getElementById('room-created').classList.add('hidden');
    document.getElementById('creator-name').value = '';
    document.getElementById('player-name').value = '';
    document.getElementById('room-code-input').value = '';
    document.getElementById('join-error').classList.add('hidden');
    
    // Reset house rules checkboxes
    document.querySelectorAll('input[name="houseRule"]').forEach(cb => cb.checked = false);
    document.getElementById('btn-toggle-all-rules').textContent = 'Selecionar Todas';
}

function toggleAllHouseRules() {
    const checkboxes = document.querySelectorAll('input[name="houseRule"]');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
    
    const btn = document.getElementById('btn-toggle-all-rules');
    btn.textContent = allChecked ? 'Selecionar Todas' : 'Desmarcar Todas';
}

function handleRoomDeleted() {
    alert('A sala foi encerrada.');
    handleBackToLobby();
}

function handleLeftRoom() {
    resetGameUI();
}

// Inicializa quando DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Expõe para debug
window.App = {
    getRoomData: () => roomData,
    getMyPlayerData: () => myPlayerData
};