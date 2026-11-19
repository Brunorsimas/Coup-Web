// ========================================
// ROOM MANAGER - Firebase Multiplayer (ES Module)
// ========================================


// Estado do módulo
let currentRoomId = null;
let currentPlayerId = null;
let currentPlayerName = null;
let roomUnsubscribe = null;
let listeners = {};

// Firebase functions (serão injetados via init)
let firebaseDb = null;
let firebaseRefs = {};

function initFirebase(config) {
    firebaseDb = config.database;
    firebaseRefs = {
        ref: config.ref,
        onValue: config.onValue,
        set: config.set,
        push: config.push,
        remove: config.remove,
        update: config.update,
        off: config.off
    };
}

// Leitura única. O callback pode vir síncrono (dado em cache), então não usar unsubscribe dentro dele.
function readOnce(path) {
    return new Promise(resolve => firebaseRefs.onValue(firebaseRefs.ref(firebaseDb, path), resolve, { onlyOnce: true }));
}

// Event emitter simples
function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
}

function emit(event, data) {
    if (listeners[event]) {
        listeners[event].forEach(cb => cb(data));
    }
}

function offEvent(event, callback) {
    if (listeners[event]) {
        listeners[event] = listeners[event].filter(cb => cb !== callback);
    }
}

// Gera código de sala aleatório (6 caracteres alfanuméricos)
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Sem I, O, 1, 0
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Gera ID único para jogador
function generatePlayerId() {
    return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Cria nova sala
async function createRoom(creatorName, maxPlayers) {
    if (!firebaseDb) {
        throw new Error('Firebase não configurado: ' + (window.firebaseInitError || 'verifique firebaseConfigData no index.html'));
    }
    
    const roomCode = generateRoomCode();
    const roomId = 'room_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const creatorId = generatePlayerId();
    
    currentRoomId = roomId;
    currentPlayerId = creatorId;
    currentPlayerName = creatorName;
    
    const roomData = {
        code: roomCode,
        creator: creatorId,
        creatorName: creatorName,
        maxPlayers: parseInt(maxPlayers),
        status: 'waiting',
        createdAt: Date.now(),
        players: {
            [creatorId]: {
                id: creatorId,
                name: creatorName,
                coins: 2,
                influences: [],
                alive: true,
                order: 0,
                ready: false,
                isCreator: true
            }
        },
        gameState: null,
        logs: {}
    };
    
    const roomRef = firebaseRefs.ref(firebaseDb, `rooms/${roomId}`);
    await firebaseRefs.set(roomRef, roomData);
    
    subscribeToRoom(roomId);
    
    return { roomId, roomCode, playerId: creatorId };
}

// Entra na sala existente
async function joinRoom(playerName, roomCode) {
    if (!firebaseDb) {
        throw new Error('Firebase não configurado: ' + (window.firebaseInitError || 'verifique firebaseConfigData no index.html'));
    }
    
    const snapshot = await readOnce('rooms');
    
    const rooms = snapshot.val() || {};
    let foundRoomId = null;
    let foundRoom = null;
    
    for (const [id, room] of Object.entries(rooms)) {
        if (room.code === roomCode.toUpperCase()) {
            foundRoomId = id;
            foundRoom = room;
            break;
        }
    }
    
    if (!foundRoom) {
        throw new Error('Sala não encontrada. Verifique o código.');
    }
    
    if (foundRoom.status !== 'waiting') {
        throw new Error('Esta sala já começou ou terminou.');
    }
    
    const currentPlayers = Object.keys(foundRoom.players || {}).length;
    if (currentPlayers >= foundRoom.maxPlayers) {
        throw new Error('Sala cheia.');
    }
    
    const existingNames = Object.values(foundRoom.players).map(p => p.name.toLowerCase());
    if (existingNames.includes(playerName.toLowerCase())) {
        throw new Error('Nome já está em uso nesta sala.');
    }
    
    const playerId = generatePlayerId();
    const order = currentPlayers;
    
    currentRoomId = foundRoomId;
    currentPlayerId = playerId;
    currentPlayerName = playerName;
    
    const playerRef = firebaseRefs.ref(firebaseDb, `rooms/${foundRoomId}/players/${playerId}`);
    await firebaseRefs.set(playerRef, {
        id: playerId,
        name: playerName,
        coins: 2,
        influences: [],
        alive: true,
        order,
        ready: false,
        isCreator: false
    });
    
    subscribeToRoom(foundRoomId);
    
    return { roomId: foundRoomId, roomCode: foundRoom.code, playerId };
}

// Inscreve nas atualizações da sala
function subscribeToRoom(roomId) {
    if (roomUnsubscribe) {
        roomUnsubscribe();
    }
    
    const roomRef = firebaseRefs.ref(firebaseDb, `rooms/${roomId}`);
    roomUnsubscribe = firebaseRefs.onValue(roomRef, (snapshot) => {
        const room = snapshot.val();
        if (room) {
            emit('room-update', room);
        } else {
            emit('room-deleted');
        }
    });
}

// Inicia o jogo (apenas criador)
async function startGame(houseRules = {}) {
    if (!currentRoomId || !currentPlayerId) return;
    
    const roomRef = firebaseRefs.ref(firebaseDb, `rooms/${currentRoomId}`);
    const snapshot = await readOnce(`rooms/${currentRoomId}`);
    
    const room = snapshot.val();
    if (!room || room.creator !== currentPlayerId) {
        throw new Error('Apenas o criador pode iniciar o jogo.');
    }
    
    const players = Object.values(room.players);
    if (players.length < 2) {
        throw new Error('Mínimo 2 jogadores para iniciar.');
    }
    
    const playerCount = players.length;
    const cardsPerPlayer = GameLogic.getInitialCardsPerPlayer(playerCount, houseRules);
    
    let deck = GameLogic.createDeck(houseRules);
    const gamePlayers = {};
    
    players.forEach((p, index) => {
        const { drawn, remaining } = GameLogic.drawCards(deck, cardsPerPlayer);
        deck = remaining;
        gamePlayers[p.id] = {
            ...p,
            influences: drawn,
            coins: 2,
            alive: true,
            order: index
        };
    });
    
    const gameState = {
        currentTurn: players[0].id,
        players: gamePlayers,
        deck: deck,
        discardPile: [],
        pendingAction: null,
        pendingBlock: null,
        pendingChallenge: null,
        pendingLoss: null,
        phase: 'action',
        winner: null,
        logs: {},
        houseRules: houseRules,
        round: 1
    };
    
    const variantText = cardsPerPlayer === 3 ? ' (Variante 2 jogadores: 3 cartas cada)' : '';
    gameState.logs['log_start'] = {
        type: 'turn-start',
        message: `Jogo iniciado! Vez de <span class="log-player">${players[0].name}</span>${variantText}`,
        timestamp: Date.now()
    };
    
    if (Object.keys(houseRules).some(k => houseRules[k])) {
        const activeRules = Object.entries(houseRules)
            .filter(([k, v]) => v)
            .map(([k]) => k)
            .join(', ');
        gameState.logs['log_houserules'] = {
            type: 'result',
            message: `Regras da casa ativas: ${activeRules}`,
            timestamp: Date.now() + 1
        };
    }
    
    const updates = {
        status: 'playing',
        gameState: gameState,
        players: gamePlayers
    };
    
    await firebaseRefs.update(roomRef, updates);
}

// Atualiza estado do jogo (set completo: update() ignora campos null e deixa estado inconsistente)
async function updateGameState(gameState) {
    if (!currentRoomId) return;
    
    const roomRef = firebaseRefs.ref(firebaseDb, `rooms/${currentRoomId}/gameState`);
    await firebaseRefs.set(roomRef, gameState);
}

// Registra "Permitir" sem sobrescrever o estado de outros clientes
async function setPass(playerId) {
    if (!currentRoomId) return;
    const passRef = firebaseRefs.ref(firebaseDb, `rooms/${currentRoomId}/gameState/passes/${playerId}`);
    await firebaseRefs.set(passRef, true);
}

// Atualiza jogador específico
async function updatePlayer(playerUpdates) {
    if (!currentRoomId || !currentPlayerId) return;
    
    const playerRef = firebaseRefs.ref(firebaseDb, `rooms/${currentRoomId}/players/${currentPlayerId}`);
    await firebaseRefs.update(playerRef, playerUpdates);
}

// Adiciona log
async function pushLog(logEntry) {
    if (!currentRoomId) return;
    
    const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const logRef = firebaseRefs.ref(firebaseDb, `rooms/${currentRoomId}/gameState/logs/${logId}`);
    await firebaseRefs.set(logRef, logEntry);
}

// Sai da sala
async function leaveRoom() {
    if (roomUnsubscribe) {
        roomUnsubscribe();
        roomUnsubscribe = null;
    }
    
    if (currentRoomId && currentPlayerId) {
        try {
            const playerRef = firebaseRefs.ref(firebaseDb, `rooms/${currentRoomId}/players/${currentPlayerId}`);
            await firebaseRefs.remove(playerRef);
        } catch (e) {
            console.warn('Erro ao sair da sala:', e);
        }
    }
    
    currentRoomId = null;
    currentPlayerId = null;
    currentPlayerName = null;
    emit('left-room');
}

// Cleanup ao fechar página
window.addEventListener('beforeunload', () => {
    if (currentRoomId && currentPlayerId) {
        leaveRoom();
    }
});

// Getters
function getCurrentRoomId() { return currentRoomId; }
function getCurrentPlayerId() { return currentPlayerId; }
function getCurrentPlayerName() { return currentPlayerName; }
function isCreator(room) { return room && room.creator === currentPlayerId; }
function isMyTurn(room) { return room && room.gameState && room.gameState.currentTurn === currentPlayerId; }

// Exporta
const RoomManager = {
    initFirebase,
    on,
    off: offEvent,
    createRoom,
    joinRoom,
    startGame,
    updateGameState,
    setPass,
    updatePlayer,
    addLog: pushLog,
    leaveRoom,
    getCurrentRoomId,
    getCurrentPlayerId,
    getCurrentPlayerName,
    isCreator,
    isMyTurn
};

// Compatibilidade global
window.RoomManager = RoomManager;