// ========================================
// COUP GAME LOGIC
// ========================================

const CHARACTERS = {
    DUKE: 'duke',
    ASSASSIN: 'assassin',
    CAPTAIN: 'captain',
    AMBASSADOR: 'ambassador',
    COUNTESS: 'countess'
};

// House Rules Configuration
const HOUSE_RULES_DEFAULTS = {
    mustCoupAt10: false,        // Obrigatório dar Golpe com 10+ moedas
    noBluffFirstRound: false,   // Primeira rodada sem blefe
    revealAllOnDeath: false,    // Eliminado revela todas as cartas
    assassinCosts2: false,      // Assassino custa 2 moedas
    dukeTax3: false,            // Duque pega 3 moedas na Ajuda Externa
    twoPlayerVariant: false     // 3 cartas cada (2 jogadores)
};

function getActionCost(action, houseRules, player) {
    const baseCost = ACTION_COSTS[action] || 0;
    
    if (houseRules.assassinCosts2 && action === ACTIONS.ASSASSINATE) return 2;
    if (houseRules.dukeTax3 && action === ACTIONS.FOREIGN_AID) return 0; // Ganha 3 no processamento
    if (houseRules.mustCoupAt10 && action === ACTIONS.COUP && player.coins >= 10) return 7; // Ainda 7, mas obrigatório
    
    return baseCost;
}

function getForeignAidAmount(houseRules) {
    return houseRules.dukeTax3 ? 3 : 2;
}

// Variante 2 jogadores automática: 3 cartas cada
function getInitialCardsPerPlayer(playerCount, houseRules) {
    return playerCount === 2 ? 3 : 2;
}

// Tempo para responder a ação/bloqueio antes de ser considerado "Permitir"
const RESPONSE_MS = (typeof window !== 'undefined' && window.__RESPONSE_MS) || 30000;

// Relógio do servidor Firebase: jogadores em países diferentes têm relógios diferentes
function nowMs() {
    return Date.now() + ((typeof window !== 'undefined' && window.serverTimeOffset) || 0);
}

// Firebase remove arrays/objetos vazios e nulls: restaura formato esperado
function normalizeState(gs) {
    if (!gs) return gs;
    gs.deck = gs.deck || [];
    gs.logs = gs.logs || {};
    gs.houseRules = gs.houseRules || {};
    gs.passes = gs.passes || {};
    Object.values(gs.players || {}).forEach(p => {
        p.influences = p.influences || [];
        p.lost = p.lost || [];
    });
    return gs;
}

function mustCoup(houseRules, coins) {
    return houseRules.mustCoupAt10 && coins >= 10;
}

function canBluff(houseRules, roundNumber) {
    return !houseRules.noBluffFirstRound || roundNumber > 1;
}

const CHARACTER_LABELS = {
    [CHARACTERS.DUKE]: 'Duque',
    [CHARACTERS.ASSASSIN]: 'Assassino',
    [CHARACTERS.CAPTAIN]: 'Capitão',
    [CHARACTERS.AMBASSADOR]: 'Embaixadora',
    [CHARACTERS.COUNTESS]: 'Condessa'
};

const CHARACTER_ICONS = {
    [CHARACTERS.DUKE]: '👑',
    [CHARACTERS.ASSASSIN]: '🗡️',
    [CHARACTERS.CAPTAIN]: '⚓',
    [CHARACTERS.AMBASSADOR]: '🤝',
    [CHARACTERS.COUNTESS]: '👸'
};

const ACTIONS = {
    INCOME: 'income',
    FOREIGN_AID: 'foreign_aid',
    TAX: 'tax',
    COUP: 'coup',
    ASSASSINATE: 'assassinate',
    STEAL: 'steal',
    EXCHANGE: 'exchange'
};

const ACTION_LABELS = {
    [ACTIONS.INCOME]: 'Renda',
    [ACTIONS.FOREIGN_AID]: 'Ajuda Externa',
    [ACTIONS.TAX]: 'Taxar (Duque)',
    [ACTIONS.COUP]: 'Golpe',
    [ACTIONS.ASSASSINATE]: 'Assassinato',
    [ACTIONS.STEAL]: 'Roubo',
    [ACTIONS.EXCHANGE]: 'Troca'
};

const ACTION_COSTS = {
    [ACTIONS.INCOME]: 0,
    [ACTIONS.FOREIGN_AID]: 0,
    [ACTIONS.TAX]: 0,
    [ACTIONS.COUP]: 7,
    [ACTIONS.ASSASSINATE]: 3,
    [ACTIONS.STEAL]: 0,
    [ACTIONS.EXCHANGE]: 0
};

// House Rules (serão passados do estado do jogo)
let currentHouseRules = { ...HOUSE_RULES_DEFAULTS };
let currentRound = 1;

function setHouseRules(rules) {
    currentHouseRules = { ...HOUSE_RULES_DEFAULTS, ...rules };
}

function setRound(round) {
    currentRound = round;
}

function getCurrentHouseRules() {
    return currentHouseRules;
}

const ACTION_BLOCKERS = {
    [ACTIONS.FOREIGN_AID]: [CHARACTERS.DUKE],
    [ACTIONS.ASSASSINATE]: [CHARACTERS.COUNTESS],
    [ACTIONS.STEAL]: [CHARACTERS.CAPTAIN, CHARACTERS.AMBASSADOR]
};

const BLOCKER_LABELS = {
    [CHARACTERS.DUKE]: 'Duque (bloqueia Ajuda Externa)',
    [CHARACTERS.COUNTESS]: 'Condessa (bloqueia Assassinato)',
    [CHARACTERS.CAPTAIN]: 'Capitão (bloqueia Roubo)',
    [CHARACTERS.AMBASSADOR]: 'Embaixadora (bloqueia Roubo/Troca)'
};

// Cria baralho inicial (3 de cada personagem)
function createDeck() {
    const deck = [];
    Object.values(CHARACTERS).forEach(char => {
        for (let i = 0; i < 3; i++) {
            deck.push(char);
        }
    });
    return shuffleArray(deck);
}

// Embaralha array (Fisher-Yates)
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Compra cartas do topo do baralho
function drawCards(deck, count) {
    const drawn = deck.slice(0, count);
    const remaining = deck.slice(count);
    return { drawn, remaining };
}

// Verifica se jogador pode pagar custo
function canAfford(player, action) {
    return player.coins >= ACTION_COSTS[action];
}

// Verifica se ação requer alvo
function requiresTarget(action) {
    return [ACTIONS.COUP, ACTIONS.ASSASSINATE, ACTIONS.STEAL].includes(action);
}

// Verifica se ação é bloqueável
function isBlockable(action) {
    return ACTION_BLOCKERS[action] && ACTION_BLOCKERS[action].length > 0;
}

// Obtém bloqueadores possíveis para uma ação
function getBlockers(action) {
    return ACTION_BLOCKERS[action] || [];
}

// Verifica se jogador tem personagem (para blefe)
function hasCharacter(player, character) {
    return player.influences.includes(character);
}

// Processa ação de renda
function processIncome(gameState, playerId) {
    const player = gameState.players[playerId];
    player.coins += 1;
    addLog(gameState, 'action', `${player.name} pegou <span class="log-action">Renda</span> (+1 moeda)`);
    nextTurn(gameState);
}

// Processa ajuda externa - bloqueável pelo Duque, não contestável
function processForeignAid(gameState, playerId) {
    const player = gameState.players[playerId];
    addLog(gameState, 'action', `${player.name} tentou <span class="log-action">Ajuda Externa</span> (+2 moedas)`);

    gameState.pendingAction = {
        type: ACTIONS.FOREIGN_AID,
        playerId,
        claimedCharacter: null // ninguém reivindica carta: só pode ser bloqueada
    };
    openResponseWindow(gameState, 'challenge_block');
}

// Processa Taxar (Duque) - contestável, não bloqueável
function processTax(gameState, playerId) {
    const player = gameState.players[playerId];
    addLog(gameState, 'action', `${player.name} usou <span class="log-action">Taxar</span> (Duque, +3 moedas)`);

    gameState.pendingAction = {
        type: ACTIONS.TAX,
        playerId,
        claimedCharacter: CHARACTERS.DUKE
    };
    openResponseWindow(gameState, 'challenge_block');
}

// Processa golpe
function processCoup(gameState, playerId, targetId) {
    const player = gameState.players[playerId];
    const target = gameState.players[targetId];
    
    player.coins -= 7;
    addLog(gameState, 'action', `${player.name} fez <span class="log-action">Golpe</span> em <span class="log-target">${target.name}</span> (-7 moedas)`);
    
    // Força alvo a perder influência
    gameState.pendingLoss = {
        playerId: targetId,
        reason: 'coup',
        byPlayer: playerId
    };
    gameState.phase = 'lose_influence';
}

// Processa assassinato
function processAssassinate(gameState, playerId, targetId) {
    const player = gameState.players[playerId];
    const target = gameState.players[targetId];
    const hr = gameState.houseRules || currentHouseRules;
    const cost = hr.assassinCosts2 ? 2 : 3;
    
    player.coins -= cost;
    addLog(gameState, 'action', `${player.name} tentou <span class="log-action">Assassinato</span> em <span class="log-target">${target.name}</span> (-${cost} moedas)`);
    
    gameState.pendingAction = {
        type: ACTIONS.ASSASSINATE,
        playerId,
        targetId,
        claimedCharacter: CHARACTERS.ASSASSIN
    };
    openResponseWindow(gameState, 'challenge_block');
}

// Processa roubo
function processSteal(gameState, playerId, targetId) {
    const player = gameState.players[playerId];
    const target = gameState.players[targetId];
    
    // Moedas só mudam após a ação ser permitida (ver applyPendingAction)
    const stealAmount = Math.min(2, target.coins);
    
    addLog(gameState, 'action', `${player.name} tentou <span class="log-action">Roubo</span> em <span class="log-target">${target.name}</span> (${stealAmount} moedas)`);
    
    gameState.pendingAction = {
        type: ACTIONS.STEAL,
        playerId,
        targetId,
        claimedCharacter: CHARACTERS.CAPTAIN,
        stealAmount
    };
    openResponseWindow(gameState, 'challenge_block');
}

// Processa troca
function processExchange(gameState, playerId) {
    const player = gameState.players[playerId];
    
    addLog(gameState, 'action', `${player.name} usou <span class="log-action">Troca</span> (Embaixadora)`);
    
    gameState.pendingAction = {
        type: ACTIONS.EXCHANGE,
        playerId,
        claimedCharacter: CHARACTERS.AMBASSADOR
    };
    openResponseWindow(gameState, 'challenge_block'); // contestável antes de trocar
}

// Processa bloqueio
function processBlock(gameState, blockerId, claimedCharacter) {
    const blocker = gameState.players[blockerId];
    const action = gameState.pendingAction;
    const actor = gameState.players[action.playerId];
    
    addLog(gameState, 'challenge', `${blocker.name} bloqueou com <span class="log-action">${CHARACTER_LABELS[claimedCharacter]}</span>`);
    
    gameState.pendingBlock = {
        blockerId,
        claimedCharacter,
        actionType: action.type
    };
    openResponseWindow(gameState, 'challenge_block_response');
}

// Abre janela de resposta com prazo; respostas "Permitir" ficam em passes
function openResponseWindow(gameState, phase) {
    gameState.phase = phase;
    gameState.passes = {};
    gameState.deadline = nowMs() + RESPONSE_MS;
}

// Quem precisa responder na fase atual
// ponytail: só o autor da ação contesta um bloqueio; regra oficial permite qualquer um.
function getResponders(gameState) {
    const action = gameState.pendingAction;
    if (!action) return [];
    if (gameState.phase === 'challenge_block_response') return [action.playerId];
    if (gameState.phase !== 'challenge_block') return [];
    return Object.values(gameState.players)
        .filter(p => p.alive && p.id !== action.playerId)
        .map(p => p.id);
}

// Ação/bloqueio aceitos sem contestação
function resolveUncontested(gameState) {
    if (gameState.phase === 'challenge_block_response') {
        const blocker = gameState.players[gameState.pendingBlock.blockerId];
        addLog(gameState, 'result', `Bloqueio de ${blocker.name} aceito. Ação cancelada.`);
        gameState.pendingAction = null;
        gameState.pendingBlock = null;
        nextTurn(gameState);
    } else {
        applyPendingAction(gameState);
    }
    gameState.passes = {};
    gameState.deadline = null;
}

function allPassed(gameState) {
    const passes = gameState.passes || {};
    return getResponders(gameState).every(id => passes[id]);
}

// Jogador escolhe "Permitir"; quando todos permitem, resolve
function processPass(gameState, playerId) {
    gameState.passes = gameState.passes || {};
    gameState.passes[playerId] = true;
    if (allPassed(gameState)) resolveUncontested(gameState);
}

// Quem pode bloquear: Ajuda Externa = qualquer um; Roubo/Assassinato = só o alvo
function canDeclareBlock(gameState, playerId) {
    const action = gameState.pendingAction;
    if (!action || !isBlockable(action.type) || action.playerId === playerId) return false;
    return action.type === ACTIONS.FOREIGN_AID || action.targetId === playerId;
}

// Prazo expirado: silêncio = permitir
function checkTimeout(gameState, now = nowMs()) {
    if (!['challenge_block', 'challenge_block_response'].includes(gameState.phase)) return false;
    if (!gameState.deadline || now < gameState.deadline) return false;
    addLog(gameState, 'result', `Tempo esgotado: sem resposta, segue o jogo.`);
    resolveUncontested(gameState);
    return true;
}

// Processa contestação
function processChallenge(gameState, challengerId) {
    const challenger = gameState.players[challengerId];
    
    if (gameState.pendingBlock) {
        // Contestar bloqueio
        const block = gameState.pendingBlock;
        const blocker = gameState.players[block.blockerId];
        
        addLog(gameState, 'challenge', `${challenger.name} contestou o bloqueio de ${blocker.name}`);
        
        gameState.pendingChallenge = {
            challengerId,
            targetId: block.blockerId,
            claimedCharacter: block.claimedCharacter,
            isBlockChallenge: true
        };
    } else if (gameState.pendingAction) {
        // Contestar ação
        const action = gameState.pendingAction;
        const actor = gameState.players[action.playerId];
        
        addLog(gameState, 'challenge', `${challenger.name} contestou a ação de ${actor.name}`);
        
        gameState.pendingChallenge = {
            challengerId,
            targetId: action.playerId,
            claimedCharacter: action.claimedCharacter,
            isBlockChallenge: false
        };
    }
    
    gameState.deadline = null;
    gameState.phase = 'resolve_challenge';
}

// Resolve contestação
function resolveChallenge(gameState) {
    const challenge = gameState.pendingChallenge;
    const challenger = gameState.players[challenge.challengerId];
    const target = gameState.players[challenge.targetId];
    const claimedChar = challenge.claimedCharacter;
    
    const targetHasChar = target.influences.includes(claimedChar);
    let actionProceeds;
    
    if (targetHasChar) {
        // Target tem a carta - challenger perde influência
        addLog(gameState, 'result', `${challenger.name} contestou <span class="log-action">${CHARACTER_LABELS[claimedChar]}</span> de ${target.name} e <span class="log-action">perdeu</span>! ${target.name} revela a carta.`);
        
        // Target devolve a carta ao baralho, embaralha e compra outra
        const charIndex = target.influences.indexOf(claimedChar);
        target.influences.splice(charIndex, 1);
        gameState.deck = shuffleArray([...gameState.deck, claimedChar]);
        const { drawn, remaining } = drawCards(gameState.deck, 1);
        if (drawn.length) target.influences.push(drawn[0]);
        gameState.deck = remaining;
        
        gameState.pendingLoss = { playerId: challenge.challengerId, reason: 'challenge_lost', byPlayer: challenge.targetId };
        // Ação contestada era verdadeira: prossegue. Bloqueio verdadeiro: ação cancelada.
        actionProceeds = !challenge.isBlockChallenge;
    } else {
        // Target NÃO tem a carta - target perde influência
        addLog(gameState, 'result', `${target.name} <span class="log-action">não tinha</span> ${CHARACTER_LABELS[claimedChar]}! ${challenger.name} venceu a contestação.`);
        
        gameState.pendingLoss = { playerId: challenge.targetId, reason: 'challenge_lost', byPlayer: challenge.challengerId };
        // Blefe da ação: cancelada. Blefe do bloqueio: ação prossegue após a perda.
        actionProceeds = challenge.isBlockChallenge;
        if (!actionProceeds && gameState.pendingAction?.type === ACTIONS.ASSASSINATE) {
            addLog(gameState, 'result', `Assassinato cancelado: blefe desmascarado.`);
        }
    }
    
    if (!actionProceeds) gameState.pendingAction = null;
    gameState.challengeWonByActor = actionProceeds;
    gameState.pendingChallenge = null;
    gameState.pendingBlock = null;
    gameState.phase = 'lose_influence';
}

// Aplica o efeito de uma ação pendente que passou (ninguém bloqueou/contestou com sucesso)
function applyPendingAction(gameState) {
    const action = gameState.pendingAction;
    if (!action) { nextTurn(gameState); return; }

    const hr = gameState.houseRules || currentHouseRules;
    const actor = gameState.players[action.playerId];

    switch (action.type) {
        case ACTIONS.FOREIGN_AID: {
            const amount = hr.dukeTax3 ? 3 : 2;
            actor.coins += amount;
            addLog(gameState, 'result', `${actor.name} recebeu <span class="log-action">Ajuda Externa</span> (+${amount})`);
            gameState.pendingAction = null;
            gameState.pendingBlock = null;
            nextTurn(gameState);
            break;
        }
        case ACTIONS.TAX: {
            const amount = 3; // regra oficial
            actor.coins += amount;
            addLog(gameState, 'result', `${actor.name} taxou <span class="log-action">+${amount} moedas</span> (Duque)`);
            gameState.pendingAction = null;
            gameState.pendingBlock = null;
            nextTurn(gameState);
            break;
        }
        case ACTIONS.STEAL: {
            const target = gameState.players[action.targetId];
            if (!target.alive) { nextTurn(gameState); break; }
            const amount = Math.min(2, target.coins);
            target.coins -= amount;
            actor.coins += amount;
            addLog(gameState, 'result', `${actor.name} roubou <span class="log-action">${amount} moedas</span> de ${target.name}`);
            gameState.pendingAction = null;
            gameState.pendingBlock = null;
            nextTurn(gameState);
            break;
        }
        case ACTIONS.ASSASSINATE: {
            // Alvo já eliminado (ex.: perdeu contestação com a última carta)
            if (!gameState.players[action.targetId].alive) { nextTurn(gameState); break; }
            gameState.pendingLoss = {
                playerId: action.targetId,
                reason: 'assassinate',
                byPlayer: action.playerId
            };
            gameState.pendingAction = null;
            gameState.pendingBlock = null;
            gameState.phase = 'lose_influence';
            break;
        }
        case ACTIONS.EXCHANGE: {
            const { drawn, remaining } = drawCards(gameState.deck, 2);
            gameState.exchangeOffer = drawn;
            gameState.deck = remaining;
            gameState.pendingBlock = null;
            gameState.phase = 'exchange';
            break;
        }
        default:
            gameState.pendingAction = null;
            gameState.pendingBlock = null;
            nextTurn(gameState);
    }
}

// Executa ação após bloqueio falhar (alias semântico)
function executeActionAfterBlock(gameState) {
    applyPendingAction(gameState);
}

// Processa perda de influência
function processLoseInfluence(gameState, playerId, revealedChar) {
    const player = gameState.players[playerId];
    const hr = gameState.houseRules || currentHouseRules;
    
    // Remove a carta revelada
    const charIndex = player.influences.indexOf(revealedChar);
    if (charIndex !== -1) {
        player.influences.splice(charIndex, 1);
    }
    
    // Carta perdida fica virada para cima, visível a todos
    player.lost = [...(player.lost || []), revealedChar];
    
    addLog(gameState, 'result', `${player.name} revelou <span class="log-action">${CHARACTER_LABELS[revealedChar]}</span> e perdeu influência`);
    
    // Verifica eliminação
    if (player.influences.length === 0) {
        player.alive = false;
        
        // House rule: reveal all on death
        if (hr.revealAllOnDeath) {
            const allCards = player.lost.map(c => CHARACTER_LABELS[c]).join(', ');
            addLog(gameState, 'elimination', `${player.name} foi <span class="log-action">eliminado</span>! Cartas: ${allCards}`);
            player.revealedAll = true;
        } else {
            addLog(gameState, 'elimination', `${player.name} foi <span class="log-action">eliminado</span>!`);
        }
        
        checkGameEnd(gameState);
    }
    
    // Limpa estado pendente
    gameState.pendingLoss = null;
    
    if (gameState.phase === 'finished') return;

    // Se o ator venceu a contestação, a ação original ainda precisa ser aplicada
    if (gameState.challengeWonByActor && gameState.pendingAction) {
        gameState.challengeWonByActor = false;
        applyPendingAction(gameState);
        return;
    }
    gameState.challengeWonByActor = false;

    nextTurn(gameState);
}

// Processa troca (Embaixador)
function processExchangeComplete(gameState, playerId, keptCards) {
    const player = gameState.players[playerId];

    // Pool = mão atual + cartas oferecidas pelo baralho
    const pool = [...player.influences, ...(gameState.exchangeOffer || [])];

    // Remove uma ocorrência de cada carta mantida
    const returned = [...pool];
    keptCards.forEach(c => {
        const i = returned.indexOf(c);
        if (i !== -1) returned.splice(i, 1);
    });

    // Mantém as escolhidas; o restante VOLTA ao baralho (não ao descarte)
    player.influences = [...keptCards];
    gameState.deck = shuffleArray([...gameState.deck, ...returned]);
    gameState.exchangeOffer = null;

    addLog(gameState, 'action', `${player.name} completou a <span class="log-action">Troca</span>`);

    gameState.pendingAction = null;
    nextTurn(gameState);
}

// Passa turno
function nextTurn(gameState) {
    // Encontra próximo jogador vivo
    const alivePlayers = Object.values(gameState.players).filter(p => p.alive).sort((a, b) => a.order - b.order);
    
    if (alivePlayers.length <= 1) {
        checkGameEnd(gameState);
        return;
    }
    
    const currentIndex = alivePlayers.findIndex(p => p.id === gameState.currentTurn);
    const nextIndex = (currentIndex + 1) % alivePlayers.length;
    gameState.currentTurn = alivePlayers[nextIndex].id;
    
    // Incrementa rodada quando volta para o primeiro jogador (order 0)
    if (nextIndex === 0) {
        gameState.round = (gameState.round || 1) + 1;
    }
    
    gameState.phase = 'action';
    gameState.pendingAction = null;
    gameState.pendingBlock = null;
    gameState.pendingChallenge = null;
    gameState.pendingLoss = null;
    gameState.exchangeOffer = null;
    gameState.challengeWonByActor = false;
    gameState.passes = {};
    gameState.deadline = null;
    
    addLog(gameState, 'turn-start', `Vez de <span class="log-player">${gameState.players[gameState.currentTurn].name}</span> (Rodada ${gameState.round})`);
}

// Verifica fim de jogo
function checkGameEnd(gameState) {
    const alivePlayers = Object.values(gameState.players).filter(p => p.alive);
    
    if (alivePlayers.length === 1) {
        gameState.phase = 'finished';
        gameState.winner = alivePlayers[0].id;
        addLog(gameState, 'result', `<span class="log-player">${alivePlayers[0].name}</span> venceu o jogo! 🎉`);
    }
}

// Adiciona log ao jogo
function addLog(gameState, type, message) {
    const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    gameState.logs[logId] = {
        type,
        message,
        timestamp: Date.now()
    };
}

// Obtém ações disponíveis para jogador
function getAvailableActions(player, gameState) {
    const hr = gameState.houseRules || currentHouseRules;
    const round = gameState.round || currentRound;
    const actions = [];
    
    const assassinCost = hr.assassinCosts2 ? 2 : 3;
    const foreignAidAmount = hr.dukeTax3 ? 3 : 2;
    // Regra oficial: começar o turno com 10+ moedas obriga o Golpe
    const mustCoupNow = player.coins >= 10;
    const allowBluff = !hr.noBluffFirstRound || round > 1;
    
    // Renda - sempre disponível
    actions.push({ id: ACTIONS.INCOME, label: ACTION_LABELS[ACTIONS.INCOME], cost: 0, primary: true, bluff: false, disabled: mustCoupNow });
    
    // Ajuda Externa - sempre disponível
    actions.push({ id: ACTIONS.FOREIGN_AID, label: ACTION_LABELS[ACTIONS.FOREIGN_AID], cost: 0, primary: true, bluff: false, blockable: true, gain: 2, disabled: mustCoupNow });
    
    // Taxar (Duque) - contestável
    const hasDuke = hasCharacter(player, CHARACTERS.DUKE);
    actions.push({
        id: ACTIONS.TAX,
        label: ACTION_LABELS[ACTIONS.TAX],
        cost: 0,
        primary: hasDuke,
        bluff: allowBluff && !hasDuke,
        disabled: mustCoupNow || (!allowBluff && !hasDuke)
    });
    
    // Golpe - se tem 7+ moedas (ou obrigatório com 10+)
    const canCoup = player.coins >= 7;
    const coupDisabled = !canCoup;
    const coupPrimary = canCoup || mustCoupNow;
    
    actions.push({ 
        id: ACTIONS.COUP, 
        label: mustCoupNow ? '⚠️ GOLPE (OBRIGATÓRIO)' : ACTION_LABELS[ACTIONS.COUP], 
        cost: 7, 
        primary: coupPrimary, 
        bluff: false, 
        requiresTarget: true,
        disabled: coupDisabled,
        forced: mustCoupNow
    });
    
    // Assassinato - se tem moedas suficientes
    const canAssassinate = player.coins >= assassinCost;
    const hasAssassin = hasCharacter(player, CHARACTERS.ASSASSIN);
    actions.push({ 
        id: ACTIONS.ASSASSINATE, 
        label: ACTION_LABELS[ACTIONS.ASSASSINATE], 
        cost: assassinCost, 
        primary: hasAssassin, 
        bluff: allowBluff && !hasAssassin, 
        requiresTarget: true, 
        blockable: true,
        disabled: mustCoupNow || !canAssassinate || (!allowBluff && !hasAssassin)
    });
    
    // Roubo - sempre disponível (blefe possível se permitir)
    const hasCaptain = hasCharacter(player, CHARACTERS.CAPTAIN);
    actions.push({ 
        id: ACTIONS.STEAL, 
        label: ACTION_LABELS[ACTIONS.STEAL], 
        cost: 0, 
        primary: hasCaptain, 
        bluff: allowBluff && !hasCaptain, 
        requiresTarget: true, 
        blockable: true,
        disabled: mustCoupNow || (!allowBluff && !hasCaptain)
    });
    
    // Troca - sempre disponível (blefe possível se permitir)
    const hasAmbassador = hasCharacter(player, CHARACTERS.AMBASSADOR);
    actions.push({ 
        id: ACTIONS.EXCHANGE, 
        label: ACTION_LABELS[ACTIONS.EXCHANGE], 
        cost: 0, 
        primary: hasAmbassador, 
        bluff: allowBluff && !hasAmbassador, 
        blockable: false,
        disabled: mustCoupNow || (!allowBluff && !hasAmbassador)
    });
    
    return actions;
}

// Obtém alvos válidos (jogadores vivos exceto si mesmo)
function getValidTargets(gameState, playerId) {
    return Object.values(gameState.players).filter(p => p.alive && p.id !== playerId);
}

// Verifica se jogador pode bloquear ação
function canBlockAction(player, action) {
    const blockers = getBlockers(action);
    return blockers.some(b => hasCharacter(player, b));
}

// Exporta como módulo ES
const GameLogic = {
    CHARACTERS,
    CHARACTER_LABELS,
    CHARACTER_ICONS,
    ACTIONS,
    ACTION_LABELS,
    ACTION_COSTS,
    ACTION_BLOCKERS,
    BLOCKER_LABELS,
    HOUSE_RULES_DEFAULTS,
    createDeck,
    shuffleArray,
    drawCards,
    canAfford,
    requiresTarget,
    isBlockable,
    getBlockers,
    hasCharacter,
    processIncome,
    processForeignAid,
    processTax,
    processPass,
    allPassed,
    resolveUncontested,
    canDeclareBlock,
    checkTimeout,
    getResponders,
    normalizeState,
    RESPONSE_MS,
    nowMs,
    applyPendingAction,
    resolveChallenge,
    processCoup,
    processAssassinate,
    processSteal,
    processExchange,
    processBlock,
    processChallenge,
    
    executeActionAfterBlock,
    processLoseInfluence,
    processExchangeComplete,
    nextTurn,
    checkGameEnd,
    addLog,
    getAvailableActions,
    getValidTargets,
    canBlockAction,
    setHouseRules,
    setRound,
    getCurrentHouseRules,
    getInitialCardsPerPlayer,
    getActionCost,
    getForeignAidAmount,
    mustCoup,
    canBluff
};

// Compatibilidade global
window.GameLogic = GameLogic;