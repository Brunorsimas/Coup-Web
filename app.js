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
    document.getElementById('btn-new-game').addEventListener('click', handleNewGame);
    document.getElementById('btn-play-again').addEventListener('click', () => RoomManager.restartRoom().catch(e => alert(e.message)));
    document.getElementById('btn-back-lobby').addEventListener('click', handleBackToLobby);
    document.getElementById('clear-log').addEventListener('click', clearLog);
    // Ocultar/mostrar histórico (lembra a escolha no navegador)
    const logBox = document.getElementById('game-log'), logBtn = document.getElementById('toggle-log');
    const setLog = hidden => {
        logBox.classList.toggle('collapsed', hidden);
        logBtn.textContent = hidden ? 'Mostrar' : 'Ocultar';
        logBtn.setAttribute('aria-expanded', String(!hidden));
        localStorage.setItem('coupLogHidden', hidden ? '1' : '');
    };
    setLog(!!localStorage.getItem('coupLogHidden'));
    logBtn.addEventListener('click', () => setLog(!logBox.classList.contains('collapsed')));
    
    // Regras
    document.getElementById('btn-rules').addEventListener('click', toggleRules);
    document.getElementById('btn-close-rules').addEventListener('click', closeRules);
    
    // Modais (botões de contestação recebem onclick dinâmico)
    document.getElementById('btn-confirm-exchange').addEventListener('click', handleConfirmExchange);
    // Personagens no painel de regras também mostram o pop-up
    document.querySelectorAll('.characters-grid .character-card img').forEach(img => {
        const ch = img.getAttribute('src').match(/assets\/(\w+)\.svg/)[1];
        img.parentElement.addEventListener('click', e => showCharInfo(ch, e.currentTarget));
    });
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
    
    if (!name) return alert('Digite seu nome');
    
    try {
        showLoading(true);
        const result = await RoomManager.createRoom(name, 6) // dono ajusta na mesa de espera;
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
    Object.values(room.players || {}).forEach(p => p.name = GameLogic.cleanName(p.name));
    room.creatorName = GameLogic.cleanName(room.creatorName);
    if (handlePresence(room)) return;
    roomData = room;
    myPlayerData = getPlayers(room)[RoomManager.getCurrentPlayerId()];
    
    if (room.status === 'waiting') {
        // Se estiver na tela de lobby, ir para a tela de jogo (mesa)
        if (currentScreen !== 'game') {
            closeAllModals();
            showScreen('game');
        }
        updateGameWaiting(room);
    } else if (room.status === 'playing') {
        if (!room.gameState) return; // estado ainda chegando
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

// Saída/queda de jogador: quem some de room.players é eliminado da partida atual.
// Pode voltar pelo código quando a sala estiver em espera (próxima partida).
function handlePresence(room) {
    const me = RoomManager.getCurrentPlayerId();
    if (!room.players?.[me]) {
        if (currentScreen === 'lobby') return true; // já tratado (atualizações atrasadas)
        closeAllModals();
        handleBackToLobby();
        alert('Você saiu ou perdeu a conexão e foi removido da sala. Entre de novo pelo código quando a próxima partida for aberta.');
        return true;
    }
    // Dono caiu: o próximo da mesa assume
    const present = Object.values(room.players).sort((a, b) => a.order - b.order);
    if (!room.players[room.creator] && present[0].id === me) RoomManager.claimOwnership();
    const gs = room.gameState;
    if (room.status === 'playing' && gs && gs.phase !== 'finished') {
        const gone = Object.values(gs.players).filter(p => p.alive && !room.players[p.id]).map(p => p.id);
        if (gone.length) RoomManager.mutateGame(cur => gone.map(id => GameLogic.removePlayer(cur, id)).some(Boolean));
    }
    return false;
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

    // Dono ajusta o limite de jogadores sem recriar a sala
    let maxSel = document.getElementById('max-players-select');
    if (isCreator && !maxSel) {
        maxSel = document.createElement('select');
        maxSel.id = 'max-players-select';
        maxSel.title = 'Máximo de jogadores';
        maxSel.setAttribute('aria-label', 'Máximo de jogadores');
        maxSel.innerHTML = [2, 3, 4, 5, 6].map(n => `<option value="${n}">${n} jogadores</option>`).join('');
        maxSel.addEventListener('change', () => RoomManager.setMaxPlayers(+maxSel.value));
        document.querySelector('.room-info-top').appendChild(maxSel);
    }
    if (maxSel) {
        maxSel.classList.toggle('hidden', !isCreator);
        const count = Object.keys(getPlayers(room)).length;
        [...maxSel.options].forEach(o => o.disabled = +o.value < count);
        maxSel.value = room.maxPlayers;
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
    ['start-game-btn', 'max-players-select'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
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
                <span class="player-mini-name">${p.name}${p.id === RoomManager.getCurrentPlayerId() ? ' (Você)' : ''}${factionTag(p)}</span>
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

// Reforma: selo da facção ao lado do nome
function factionTag(p) {
    if (!p.faction) return '';
    return ` <span class="faction-tag ${p.faction}" title="${GameLogic.FACTION_LABELS[p.faction]}">${GameLogic.FACTION_ICONS[p.faction]} ${GameLogic.FACTION_LABELS[p.faction]}</span>`;
}

function updateOpponents(room) {
    const tb = document.getElementById('treasury-badge');
    tb.classList.toggle('hidden', !room.gameState?.houseRules?.reformation);
    document.getElementById('treasury-count').textContent = room.gameState?.treasury || 0;

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
            <div class="opponent-name">${p.name}${factionTag(p)}</div>
            <div class="opponent-stats">
                <span class="opponent-coins">💰 ${p.coins}</span>
                <div class="opponent-influences">
                    ${(p.influences || []).map(() => '<div class="influence-card"></div>').join('')}
                    ${(p.lost || []).map(c => lostCardMini(c)).join('')}
                </div>
            </div>
        `;
        
        // Clique para selecionar alvo (só vivos)
        if (p.alive && selectedAction && GameLogic.requiresTarget(selectedAction) && !isCurrentTurn &&
            GameLogic.getValidTargets(gameState, RoomManager.getCurrentPlayerId(), selectedAction).some(t => t.id === p.id)) {
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
    card.addEventListener('click', e => showCharInfo(character, e.currentTarget));
    return card;
}

// Pop-up pequeno: o que o personagem faz
const CHAR_INFO = {
    duke: 'Taxar: +3 moedas.<br>Bloqueia Ajuda Externa.',
    assassin: 'Assassinar: paga 3 moedas, alvo perde 1 carta.<br>Bloqueado pela Condessa.',
    captain: 'Roubar: pega até 2 moedas de um jogador.<br>Bloqueia Roubo.',
    ambassador: 'Trocar: compra 2 cartas do baralho e devolve 2.<br>Bloqueia Roubo.',
    countess: 'Sem ação própria.<br>Bloqueia Assassinato.',
    inquisitor: 'Trocar: compra 1 carta e devolve 1.<br>Investigar: vê 1 carta de um jogador e pode obrigá-lo a trocar.<br>Bloqueia Roubo.'
};
function showCharInfo(character, anchor) {
    let pop = document.getElementById('char-info-pop');
    if (!pop) {
        pop = document.createElement('div');
        pop.id = 'char-info-pop';
        pop.className = 'char-info-pop';
        pop.setAttribute('role', 'tooltip');
        document.body.appendChild(pop);
        document.addEventListener('click', e => { if (!e.target.closest('[data-character], .character-card')) pop.classList.add('hidden'); });
    }
    if (pop.dataset.for === character && !pop.classList.contains('hidden')) { pop.classList.add('hidden'); return; }
    pop.dataset.for = character;
    pop.innerHTML = `<strong>${GameLogic.CHARACTER_LABELS[character]}</strong><br>${CHAR_INFO[character]}`;
    pop.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const w = Math.min(240, window.innerWidth - 16);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)) + 'px';
    const top = r.top - pop.offsetHeight - 8;
    pop.style.top = (top > 8 ? top : r.bottom + 8) + 'px';
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
        div.innerHTML = String(log.message).replace(/<(?!\/?(span|strong|em)(\s+class="[\w -]*")?>)[^>]*>?/gi, '');
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
    const playerId = RoomManager.getCurrentPlayerId();
    closeAllModals(); // antes: Firebase notifica sincronamente e o modal seguinte (ex.: perder carta) seria fechado
    RoomManager.mutateGame(gs => {
        if (gs.phase !== 'action' || gs.currentTurn !== playerId) return false;
        runAction(gs, playerId, actionId, targetId);
        return true;
    });
}

function runAction(gameState, playerId, actionId, targetId) {
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
        case GameLogic.ACTIONS.CONVERT_SELF:
        case GameLogic.ACTIONS.CONVERT:
            GameLogic.processConvert(gameState, playerId, targetId);
            break;
        case GameLogic.ACTIONS.EMBEZZLE:
            GameLogic.processEmbezzle(gameState, playerId);
            break;
    }
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
    const me = RoomManager.getCurrentPlayerId();
    closeAllModals();
    RoomManager.mutateGame(gs => gs.phase === 'lose_influence' && gs.pendingLoss?.playerId === me &&
        gs.players[me].influences.includes(character) && (GameLogic.processLoseInfluence(gs, me, character), true));
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
        card.classList.add('selected'); // começa mantida; clicar = trocar (0, 1 ou 2 cartas)
        handDiv.appendChild(card);
    });
    
    drawn.forEach((char, index) => {
        const card = createExchangeCard(char, index, 'deck');
        deckDiv.appendChild(card);
    });
    
    modal.querySelector('h3').textContent = `Troca de Influência (${gameState.pendingAction?.type === 'inq_exchange' ? 'Inquisidor' : 'Embaixador'})`;
    showModal(modal);
    updateExchangeConfirm();
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
    const swaps = document.querySelectorAll('.exchange-card:not(.selected)').length;
    btn.textContent = swaps ? `Confirmar Troca (${swaps} carta${swaps > 1 ? 's' : ''})` : 'Manter Mão';
    // Guia passo a passo: quantas saem x quantas entram
    const ins = document.querySelectorAll('.deck-card.selected').length, st = document.getElementById('exchange-status');
    st.textContent = ins > swaps ? `Você escolheu ${ins} do baralho mas só liberou ${swaps} da mão: desmarque uma da sua mão primeiro.`
        : ins < swaps ? `Escolha mais ${swaps - ins} carta(s) do baralho para entrar no lugar.`
        : swaps ? `Pronto: ${swaps} sai(em), ${ins} entra(m).` : 'Nenhuma troca: você mantém sua mão. Clique numa carta sua para trocá-la.';
    st.classList.toggle('ok', ins === swaps);
}

function handleConfirmExchange() {
    const selected = document.querySelectorAll('.exchange-card.selected, .deck-card.selected');
    if (selected.length !== exchangeKeepCount()) return;
    
    const keptCards = Array.from(selected).map(c => c.dataset.character);
    const playerId = RoomManager.getCurrentPlayerId();
    closeAllModals(); // antes: Firebase notifica sincronamente e o modal seguinte (ex.: perder carta) seria fechado
    RoomManager.mutateGame(gs => gs.phase === 'exchange' && gs.currentTurn === playerId &&
        (GameLogic.processExchangeComplete(gs, playerId, keptCards), true));
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
    const send = fn => () => { closeAllModals(); RoomManager.mutateGame(gs => fn(gs)); };
    let title, html, buttons;
    if (phase === 'examine_show') {
        title = 'Investigação';
        html = `${gameState.players[action.playerId].name} (Inquisidor) quer ver uma carta sua. Escolha qual mostrar:`;
        buttons = [...new Set(target.influences)].map(ch => ({
            label: GameLogic.CHARACTER_LABELS[ch], cls: 'btn-secondary',
            fn: send(gs => GameLogic.processExamineShow(gs, target.id, ch))
        }));
    } else {
        title = 'Investigação';
        html = `${target.name} mostrou: <strong>${GameLogic.CHARACTER_LABELS[gameState.examinedCard]}</strong>`;
        buttons = [
            { label: 'Devolver', cls: 'btn-primary', fn: send(gs => GameLogic.processExamineDecide(gs, action.playerId, false)) },
            { label: 'Forçar troca', cls: 'btn-danger', fn: send(gs => GameLogic.processExamineDecide(gs, action.playerId, true)) }
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

// Contestar/Bloquear via transação: valida contra o estado atual do servidor
// (antes, dois cliques simultâneos ou um clique após o prazo sobrescreviam a jogada do outro)
function respondChallenge() {
    const me = RoomManager.getCurrentPlayerId();
    closeAllModals(); // antes: Firebase notifica sincronamente e o modal seguinte (ex.: perder carta) seria fechado
    // Contesta e resolve na mesma transação: não depende de outro cliente para revelar a carta
    RoomManager.mutateGame(gs => !gs.passes?.[me] && GameLogic.processChallenge(gs, me) && (GameLogic.resolveChallenge(gs), true))
        .then(ok => { if (!ok) addLocalLog('Contestação não aceita: a janela já fechou ou outro jogador respondeu antes.'); });
}

function respondBlock(character) {
    const me = RoomManager.getCurrentPlayerId();
    closeAllModals(); // antes: Firebase notifica sincronamente e o modal seguinte (ex.: perder carta) seria fechado
    RoomManager.mutateGame(gs => !gs.passes?.[me] && GameLogic.processBlock(gs, me, character))
        .then(ok => { if (!ok) addLocalLog('Bloqueio não aceito: a janela já fechou ou outro jogador respondeu antes.'); });
}

// Permitir: grava só o próprio voto (evita sobrescrever votos simultâneos)
// Vinculado ao prazo da janela: um "Permitir" atrasado não vale para a janela seguinte
function respondPass() {
    const me = RoomManager.getCurrentPlayerId(), deadline = roomData?.gameState?.deadline;
    closeAllModals(); // antes: Firebase notifica sincronamente e o modal seguinte (ex.: perder carta) seria fechado
    RoomManager.mutateGame(gs => {
        if (gs.deadline !== deadline || !GameLogic.getResponders(gs).includes(me)) return false;
        gs.passes = { ...gs.passes, [me]: true };
        return true;
    });
}

// A cada segundo: atualiza contagem; o jogador da vez resolve quando todos permitiram ou o prazo expira
let lossWatch = {};
function tickResponseTimer() {
    const gs = roomData?.gameState;
    // Rede de segurança: contestação pendente (versão antiga/evento perdido) é resolvida por qualquer cliente
    if (gs?.phase === 'resolve_challenge') {
        RoomManager.mutateGame(cur => cur.phase === 'resolve_challenge' && (GameLogic.resolveChallenge(cur), true));
        return;
    }
    // Rede de segurança: perda de carta parada (aparelho travado/desconectado) — após 30s qualquer cliente revela a 1ª carta
    if (gs?.phase === 'lose_influence' && gs.pendingLoss) {
        const key = gs.pendingLoss.playerId + '|' + Object.keys(gs.logs || {}).length;
        if (lossWatch.key !== key) lossWatch = { key, since: Date.now() };
        else if (Date.now() - lossWatch.since > 30000) {
            lossWatch.since = Date.now();
            RoomManager.mutateGame(cur => {
                const id = cur.pendingLoss?.playerId;
                if (cur.phase !== 'lose_influence' || id !== gs.pendingLoss.playerId || !cur.players[id].influences.length) return false;
                GameLogic.processLoseInfluence(cur, id, cur.players[id].influences[0]);
            });
        }
    }
    // Tempo da vez: contador para todos; esgotado, qualquer cliente faz a jogada automática
    const tt = document.getElementById('turn-timer');
    const turnLeft = gs?.phase === 'action' && gs.turnDeadline ? Math.ceil((gs.turnDeadline - GameLogic.nowMs()) / 1000) : null;
    tt.classList.toggle('hidden', turnLeft === null || currentScreen !== 'game');
    if (turnLeft !== null) {
        const mine = gs.currentTurn === RoomManager.getCurrentPlayerId();
        tt.textContent = `⏳ ${Math.max(0, turnLeft)}s ${mine ? 'para jogar' : 'para ' + (gs.players[gs.currentTurn]?.name || '')}`;
        tt.classList.toggle('urgent', turnLeft <= 10);
        if (turnLeft <= 0) {
            const td = gs.turnDeadline;
            RoomManager.mutateGame(cur => cur.turnDeadline === td && GameLogic.autoTurn(cur));
        }
    }
    const el = document.getElementById('response-countdown');
    if (!gs || !gs.deadline) return;
    if (el) el.textContent = Math.max(0, Math.ceil((gs.deadline - GameLogic.nowMs()) / 1000));

    // Jogador da vez resolve; se ele estiver offline/celular em segundo plano, qualquer um resolve após 3s
    const late = GameLogic.nowMs() >= gs.deadline + 3000;
    if (gs.currentTurn !== RoomManager.getCurrentPlayerId() && !late) return;
    if (!['challenge_block', 'challenge_block_response'].includes(gs.phase)) return;
    if (GameLogic.allPassed(gs) || GameLogic.nowMs() >= gs.deadline) {
        RoomManager.mutateGame(cur => {
            if (cur.deadline !== gs.deadline) return false; // estado mudou: outra resposta chegou
            if (GameLogic.allPassed(cur)) { GameLogic.resolveUncontested(cur); return true; }
            return GameLogic.checkTimeout(cur);
        });
    }
}

// ========================================
// TELA DE FIM DE JOGO
// ========================================

function showEndScreen(room) {
    if (currentScreen !== 'end') closeAllModals();
    showScreen('end');
    const owner = RoomManager.isCreator(room);
    document.getElementById('btn-play-again').classList.toggle('hidden', !owner);
    document.getElementById('wait-owner').classList.toggle('hidden', owner);
    
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
        withInquisitor: 'Inquisidor',
        reformation: 'Reforma',
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
        examine: '🔍',
        convert_self: '🔃',
        convert: '📜',
        embezzle: '🏛️'
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
    document.getElementById('max-players-select')?.remove();
    
    const copyBtn = document.getElementById('copy-room-code-btn');
    if (copyBtn) copyBtn.remove();
    
    const hrBadge = document.getElementById('house-rules-badge');
    if (hrBadge) hrBadge.remove();
    
    document.getElementById('creator-name').value = '';
    document.getElementById('player-name').value = '';
    document.getElementById('room-code-input').value = '';
    document.getElementById('join-error').classList.add('hidden');
    
    // Reset house rules checkboxes
    document.querySelectorAll('input[name="houseRule"]').forEach(cb => cb.checked = false);
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