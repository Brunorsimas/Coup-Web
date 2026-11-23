// ========================================
// COUP GAME LOGIC
// ========================================

const CHARACTERS = {
    DUKE: 'duke',
    ASSASSIN: 'assassin',
    CAPTAIN: 'captain',
    AMBASSADOR: 'ambassador',
    COUNTESS: 'countess',
    INQUISITOR: 'inquisitor' // opcional: entra junto com o Embaixador (houseRules.withInquisitor)
};

// House Rules Configuration
const HOUSE_RULES_DEFAULTS = {
    mustCoupAt10: false,        // Obrigatório dar Golpe com 10+ moedas
    twoPlayerVariant: false     // 3 cartas cada (2 jogadores)
};

function getActionCost(action, houseRules, player) {
    const baseCost = ACTION_COSTS[action] || 0;
    
    if (houseRules.mustCoupAt10 && action === ACTIONS.COUP && player.coins >= 10) return 7; // Ainda 7, mas obrigatório
    
    return baseCost;
}

function getForeignAidAmount(houseRules) {
    return 2;
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

// Nome sem caracteres de HTML: impede injeção de código pelo nome (XSS)
function cleanName(n) {
    return String(n ?? '').replace(/[<>&"'`]/g, '').slice(0, 20) || '?';
}

// Tempo para escolher a ação na própria vez; esgotado, joga sozinho
const TURN_MS = (typeof window !== 'undefined' && window.__TURN_MS) || 30000;

// Firebase remove arrays/objetos vazios e nulls: restaura formato esperado
function normalizeState(gs) {
    if (!gs) return gs;
    gs.deck = gs.deck || [];
    gs.logs = gs.logs || {};
    gs.houseRules = gs.houseRules || {};
    gs.passes = gs.passes || {};
    Object.values(gs.players || {}).forEach(p => {
        p.name = cleanName(p.name);
        p.influences = p.influences || [];
        p.lost = p.lost || [];
    });
    return gs;
}

function mustCoup(houseRules, coins) {
    return houseRules.mustCoupAt10 && coins >= 10;
}

function canBluff(houseRules, roundNumber) {
    return true; // blefe sempre permitido
}

const CHARACTER_LABELS = {
    [CHARACTERS.DUKE]: 'Duque',
    [CHARACTERS.ASSASSIN]: 'Assassino',
    [CHARACTERS.CAPTAIN]: 'Capitão',
    [CHARACTERS.AMBASSADOR]: 'Embaixadora',
    [CHARACTERS.COUNTESS]: 'Condessa',
    [CHARACTERS.INQUISITOR]: 'Inquisidor'
};

const CHARACTER_ICONS = {
    [CHARACTERS.DUKE]: '👑',
    [CHARACTERS.ASSASSIN]: '🗡️',
    [CHARACTERS.CAPTAIN]: '⚓',
    [CHARACTERS.AMBASSADOR]: '🤝',
    [CHARACTERS.COUNTESS]: '👸',
    [CHARACTERS.INQUISITOR]: '🔍'
};

const ACTIONS = {
    INCOME: 'income',
    FOREIGN_AID: 'foreign_aid',
    TAX: 'tax',
    COUP: 'coup',
    ASSASSINATE: 'assassinate',
    STEAL: 'steal',
    EXCHANGE: 'exchange',
    INQ_EXCHANGE: 'inq_exchange', // Inquisidor: compra 1, devolve 1
    EXAMINE: 'examine',           // Inquisidor: olha 1 carta do alvo e pode forçar troca
    CONVERT_SELF: 'convert_self', // Reforma: paga 1 ao Tesouro e troca a própria facção
    CONVERT: 'convert',           // Reforma: paga 2 ao Tesouro e troca a facção de outro
    EMBEZZLE: 'embezzle'          // Reforma: pega o Tesouro alegando NÃO ter o Duque
};

const ACTION_LABELS = {
    [ACTIONS.INCOME]: 'Renda',
    [ACTIONS.FOREIGN_AID]: 'Ajuda Externa',
    [ACTIONS.TAX]: 'Taxar (Duque)',
    [ACTIONS.COUP]: 'Golpe',
    [ACTIONS.ASSASSINATE]: 'Assassinato',
    [ACTIONS.STEAL]: 'Roubo',
    [ACTIONS.EXCHANGE]: 'Troca (Embaixador)',
    [ACTIONS.INQ_EXCHANGE]: 'Troca (Inquisidor)',
    [ACTIONS.EXAMINE]: 'Investigar',
    [ACTIONS.CONVERT_SELF]: 'Converter-se',
    [ACTIONS.CONVERT]: 'Converter Outro',
    [ACTIONS.EMBEZZLE]: 'Desviar Tesouro'
};

// ===== Reforma: facções =====
const FACTIONS = { LOYALIST: 'loyalist', REFORMIST: 'reformist' };
const FACTION_LABELS = { loyalist: 'Lealista', reformist: 'Reformista' };
const FACTION_ICONS = { loyalist: '👑', reformist: '✊' };

// Facções alternadas à mesa a partir do 1º jogador
function assignFactions(players, firstFaction = FACTIONS.LOYALIST) {
    const other = f => f === FACTIONS.LOYALIST ? FACTIONS.REFORMIST : FACTIONS.LOYALIST;
    let f = firstFaction;
    [...players].sort((a, b) => a.order - b.order).forEach(p => { p.faction = f; f = other(f); });
}

// Regra da Reforma: não se ataca a própria facção, salvo se todos os vivos forem da mesma
function allSameFaction(gameState) {
    return new Set(Object.values(gameState.players).filter(p => p.alive).map(p => p.faction)).size <= 1;
}
function canHitFaction(gameState, aId, bId) {
    if (!gameState.houseRules?.reformation || allSameFaction(gameState)) return true;
    return gameState.players[aId].faction !== gameState.players[bId].faction;
}

const ACTION_COSTS = {
    [ACTIONS.INCOME]: 0,
    [ACTIONS.FOREIGN_AID]: 0,
    [ACTIONS.TAX]: 0,
    [ACTIONS.COUP]: 7,
    [ACTIONS.ASSASSINATE]: 3,
    [ACTIONS.STEAL]: 0,
    [ACTIONS.EXCHANGE]: 0,
    [ACTIONS.INQ_EXCHANGE]: 0,
    [ACTIONS.EXAMINE]: 0,
    [ACTIONS.CONVERT_SELF]: 1,
    [ACTIONS.CONVERT]: 2,
    [ACTIONS.EMBEZZLE]: 0
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
    [ACTIONS.STEAL]: [CHARACTERS.CAPTAIN, CHARACTERS.AMBASSADOR, CHARACTERS.INQUISITOR]
};

// Personagens presentes na partida (Inquisidor só se ativado)
function inGame(gameState, character) {
    return character !== CHARACTERS.INQUISITOR || !!gameState?.houseRules?.withInquisitor;
}

const BLOCKER_LABELS = {
    [CHARACTERS.DUKE]: 'Duque (bloqueia Ajuda Externa)',
    [CHARACTERS.COUNTESS]: 'Condessa (bloqueia Assassinato)',
    [CHARACTERS.CAPTAIN]: 'Capitão (bloqueia Roubo)',
    [CHARACTERS.AMBASSADOR]: 'Embaixadora (bloqueia Roubo)',
    [CHARACTERS.INQUISITOR]: 'Inquisidor (bloqueia Roubo)'
};

// Cria baralho inicial (3 de cada personagem; 18 cartas com Inquisidor)
function createDeck(houseRules = {}) {
    const deck = [];
    Object.values(CHARACTERS).filter(c => inGame({ houseRules }, c)).forEach(char => {
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
    return [ACTIONS.COUP, ACTIONS.ASSASSINATE, ACTIONS.STEAL, ACTIONS.EXAMINE, ACTIONS.CONVERT].includes(action);
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
    const cost = 3;
    
    player.coins -= cost;
    addLog(gameState, 'action', `${player.name} tentou <span class="log-action">Assassinato</span> em <span class="log-target">${target.name}</span> (-${cost} moedas)`);
    
    gameState.pendingAction = {
        type: ACTIONS.ASSASSINATE,
        playerId,
        targetId,
        claimedCharacter: CHARACTERS.ASSASSIN,
        cost // devolvido se o blefe do Assassino for desmascarado
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

// Inquisidor: Troca de 1 carta (contestável, não bloqueável)
function processInqExchange(gameState, playerId) {
    const player = gameState.players[playerId];
    addLog(gameState, 'action', `${player.name} usou <span class="log-action">Troca</span> (Inquisidor)`);
    gameState.pendingAction = { type: ACTIONS.INQ_EXCHANGE, playerId, claimedCharacter: CHARACTERS.INQUISITOR };
    openResponseWindow(gameState, 'challenge_block');
}

// Inquisidor: Investigar um jogador (contestável, não bloqueável)
function processExamine(gameState, playerId, targetId) {
    const player = gameState.players[playerId];
    const target = gameState.players[targetId];
    addLog(gameState, 'action', `${player.name} quer <span class="log-action">Investigar</span> <span class="log-target">${target.name}</span> (Inquisidor)`);
    gameState.pendingAction = { type: ACTIONS.EXAMINE, playerId, targetId, claimedCharacter: CHARACTERS.INQUISITOR };
    openResponseWindow(gameState, 'challenge_block');
}

// Reforma: Conversão (não contestável nem bloqueável). Moedas vão ao Tesouro Reserva.
function processConvert(gameState, playerId, targetId) {
    const player = gameState.players[playerId];
    const target = gameState.players[targetId || playerId];
    const cost = target.id === playerId ? 1 : 2;
    if (!gameState.houseRules?.reformation || player.coins < cost || !target.alive) return false;
    player.coins -= cost;
    gameState.treasury = (gameState.treasury || 0) + cost;
    target.faction = target.faction === FACTIONS.LOYALIST ? FACTIONS.REFORMIST : FACTIONS.LOYALIST;
    addLog(gameState, 'action', target.id === playerId
        ? `${player.name} se <span class="log-action">converteu</span> em ${FACTION_LABELS[target.faction]} (-1 moeda ao Tesouro)`
        : `${player.name} <span class="log-action">converteu</span> <span class="log-target">${target.name}</span> em ${FACTION_LABELS[target.faction]} (-2 moedas ao Tesouro)`);
    nextTurn(gameState);
    return true;
}

// Reforma: Desvio. Alega NÃO ter o Duque; contestação vence se ele tiver o Duque.
function processEmbezzle(gameState, playerId) {
    const player = gameState.players[playerId];
    addLog(gameState, 'action', `${player.name} quer <span class="log-action">Desviar o Tesouro</span> (${gameState.treasury || 0} moedas, alega não ter Duque)`);
    gameState.pendingAction = { type: ACTIONS.EMBEZZLE, playerId, claimedCharacter: CHARACTERS.DUKE, inverse: true };
    openResponseWindow(gameState, 'challenge_block');
}

// Investigar, passo 1: alvo escolhe qual carta mostrar ao Inquisidor
function processExamineShow(gameState, targetId, character) {
    const action = gameState.pendingAction;
    const target = gameState.players[targetId];
    if (gameState.phase !== 'examine_show' || action?.targetId !== targetId || !target.influences.includes(character)) return false;
    gameState.examinedCard = character;
    gameState.phase = 'examine_decide';
    addLog(gameState, 'result', `${target.name} mostrou uma carta a ${gameState.players[action.playerId].name}`);
    return true;
}

// Investigar, passo 2: Inquisidor devolve a carta ou força a troca com o baralho
function processExamineDecide(gameState, playerId, forceSwap) {
    const action = gameState.pendingAction;
    if (gameState.phase !== 'examine_decide' || action?.playerId !== playerId) return false;
    const target = gameState.players[action.targetId];
    const card = gameState.examinedCard;
    if (forceSwap) {
        target.influences.splice(target.influences.indexOf(card), 1);
        const { drawn, remaining } = drawCards(shuffleArray([...gameState.deck, card]), 1);
        target.influences.push(drawn[0]);
        gameState.deck = remaining;
        addLog(gameState, 'result', `${gameState.players[playerId].name} forçou ${target.name} a <span class="log-action">trocar</span> a carta`);
    } else {
        addLog(gameState, 'result', `${gameState.players[playerId].name} devolveu a carta a ${target.name}`);
    }
    gameState.examinedCard = null;
    nextTurn(gameState);
    return true;
}

// Processa bloqueio
function processBlock(gameState, blockerId, claimedCharacter) {
    const blocker = gameState.players[blockerId];
    const action = gameState.pendingAction;
    if (gameState.phase !== 'challenge_block' || !blockOptions(gameState, blockerId).includes(claimedCharacter)) return false;
    
    addLog(gameState, 'challenge', `${blocker.name} bloqueou com <span class="log-action">${CHARACTER_LABELS[claimedCharacter]}</span>`);
    
    gameState.pendingBlock = {
        blockerId,
        claimedCharacter,
        actionType: action.type
    };
    openResponseWindow(gameState, 'challenge_block_response');
    return true;
}

// Abre janela de resposta com prazo; respostas "Permitir" ficam em passes
function openResponseWindow(gameState, phase) {
    gameState.phase = phase;
    gameState.passes = {};
    gameState.deadline = nowMs() + RESPONSE_MS;
}

// Quem precisa responder na fase atual (regra oficial)
// - Ação: todos os vivos exceto o autor (contestar e/ou bloquear)
// - Ação já contestada sem sucesso: só quem ainda pode bloquear
// - Bloqueio: todos os vivos exceto quem bloqueou podem contestá-lo
function getResponders(gameState) {
    const action = gameState.pendingAction;
    if (!action) return [];
    const alive = Object.values(gameState.players).filter(p => p.alive);
    if (gameState.phase === 'challenge_block_response') {
        return alive.filter(p => p.id !== gameState.pendingBlock?.blockerId).map(p => p.id);
    }
    if (gameState.phase !== 'challenge_block') return [];
    if (action.challenged) return alive.filter(p => blockOptions(gameState, p.id).length).map(p => p.id);
    return alive.filter(p => p.id !== action.playerId).map(p => p.id);
}

// Ação ainda pode ser contestada? (cada ação é contestada uma única vez)
function canChallengeAction(gameState, playerId) {
    const action = gameState.pendingAction;
    return !!action && !!action.claimedCharacter && !action.challenged && action.playerId !== playerId;
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
    const player = gameState.players[playerId];
    if (!action || !player?.alive || !isBlockable(action.type) || action.playerId === playerId || action.blocked) return false;
    if (action.type === ACTIONS.FOREIGN_AID) return canHitFaction(gameState, playerId, action.playerId);
    return action.targetId === playerId;
}

// Cartas com que o jogador pode bloquear. Blefe sempre permitido.
function blockOptions(gameState, playerId) {
    if (!canDeclareBlock(gameState, playerId)) return [];
    const player = gameState.players[playerId];
    const chars = getBlockers(gameState.pendingAction.type).filter(c => inGame(gameState, c));
    return isBluffAllowed(gameState) ? chars : chars.filter(c => hasCharacter(player, c));
}

function isBluffAllowed(gameState) {
    return true; // blefe sempre permitido
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
    // Validação: só durante janela de resposta, por jogador vivo, contra alegação de carta
    if (!challenger?.alive) return false;
    if (gameState.phase === 'challenge_block_response') {
        if (gameState.pendingBlock?.blockerId === challengerId) return false;
    } else if (gameState.phase !== 'challenge_block' || !canChallengeAction(gameState, challengerId)) {
        return false;
    }
    
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
    return true;
}

// Resolve contestação
function resolveChallenge(gameState) {
    const challenge = gameState.pendingChallenge;
    const challenger = gameState.players[challenge.challengerId];
    const target = gameState.players[challenge.targetId];
    const claimedChar = challenge.claimedCharacter;
    
    const inverse = !challenge.isBlockChallenge && gameState.pendingAction?.inverse;
    const targetHasChar = target.influences.includes(claimedChar);
    let actionProceeds;
    
    if (inverse) {
        // Desvio: alegou NÃO ter o Duque. Com Duque, perde; sem Duque, o contestador perde. Nada é revelado/trocado.
        const lied = targetHasChar;
        addLog(gameState, 'result', lied
            ? `${target.name} <span class="log-action">tinha</span> o Duque! Desvio cancelado, ${challenger.name} venceu a contestação.`
            : `${target.name} <span class="log-action">não tinha</span> o Duque. ${challenger.name} perdeu a contestação.`);
        gameState.pendingLoss = lied
            ? { playerId: challenge.targetId, reason: 'challenge_lost', byPlayer: challenge.challengerId }
            : { playerId: challenge.challengerId, reason: 'challenge_lost', byPlayer: challenge.targetId };
        actionProceeds = !lied;
    } else if (targetHasChar) {
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
            const refund = gameState.pendingAction.cost || 0;
            target.coins += refund; // house rule pedida: blefe desmascarado devolve as moedas
            addLog(gameState, 'result', `Assassinato cancelado: blefe desmascarado. ${target.name} recebe ${refund} moedas de volta.`);
        }
    }
    
    if (!actionProceeds) gameState.pendingAction = null;
    else if (challenge.isBlockChallenge) gameState.pendingAction.blocked = true; // bloqueio caiu: sem novo bloqueio
    else gameState.pendingAction.challenged = true; // ação provada: ainda pode ser bloqueada
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
            const amount = 2;
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
        case ACTIONS.EMBEZZLE: {
            const amount = gameState.treasury || 0;
            actor.coins += amount;
            gameState.treasury = 0;
            addLog(gameState, 'result', `${actor.name} <span class="log-action">desviou ${amount} moedas</span> do Tesouro`);
            gameState.pendingAction = null;
            gameState.pendingBlock = null;
            nextTurn(gameState);
            break;
        }
        case ACTIONS.EXAMINE: {
            const target = gameState.players[action.targetId];
            if (!target.alive || !actor.alive) { nextTurn(gameState); break; }
            gameState.pendingBlock = null;
            gameState.phase = 'examine_show';
            break;
        }
        case ACTIONS.INQ_EXCHANGE:
        case ACTIONS.EXCHANGE: {
            if (!actor.alive) { nextTurn(gameState); break; }
            const n = action.type === ACTIONS.EXCHANGE ? 2 : 1;
            const { drawn, remaining } = drawCards(gameState.deck, n);
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
        addLog(gameState, 'elimination', `${player.name} foi <span class="log-action">eliminado</span>!`);
        
        checkGameEnd(gameState);
    }
    
    // Limpa estado pendente
    gameState.pendingLoss = null;
    
    if (gameState.phase === 'finished') return;
    continueAfterLoss(gameState);
}

// Após perder carta: aplica a ação de quem venceu a contestação, ou passa o turno
function continueAfterLoss(gameState) {
    // Se o ator venceu a contestação, a ação original ainda precisa ser aplicada
    if (gameState.challengeWonByActor && gameState.pendingAction) {
        gameState.challengeWonByActor = false;
        // Regra oficial: após contestação fracassada, o alvo ainda pode bloquear
        // Bloqueio desmascarado: ação segue direto
        if (gameState.pendingAction.blocked) { applyPendingAction(gameState); return; }
        openResponseWindow(gameState, 'challenge_block');
        if (!getResponders(gameState).length) applyPendingAction(gameState);
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
    
    // Anda pela mesa inteira a partir do jogador da vez (ele pode ter acabado de ser eliminado)
    const all = Object.values(gameState.players).sort((a, b) => a.order - b.order);
    const cur = all.findIndex(p => p.id === gameState.currentTurn);
    let i = cur;
    do { i = (i + 1) % all.length; } while (!all[i].alive);
    gameState.currentTurn = all[i].id;
    
    // Nova rodada quando a vez dá a volta na mesa
    if (i <= cur) {
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
    gameState.turnDeadline = nowMs() + TURN_MS;
    
    addLog(gameState, 'turn-start', `Vez de <span class="log-player">${gameState.players[gameState.currentTurn].name}</span> (Rodada ${gameState.round})`);
}

// Tempo da vez esgotado: Golpe obrigatório (10+) em alvo aleatório, senão Renda
function autoTurn(gameState) {
    const p = gameState.players[gameState.currentTurn];
    if (gameState.phase !== 'action' || !p?.alive) return false;
    addLog(gameState, 'result', `⏳ ${p.name} não jogou a tempo: jogada automática`);
    const t = getValidTargets(gameState, p.id, ACTIONS.COUP);
    if (p.coins >= 10 && t.length) processCoup(gameState, p.id, t[Math.floor(Math.random() * t.length)].id);
    else processIncome(gameState, p.id);
    return true;
}

// Jogador saiu/caiu: fica eliminado nesta partida (cartas viradas) e o jogo segue
function removePlayer(gameState, playerId) {
    const p = gameState.players[playerId];
    if (!p?.alive || gameState.phase === 'finished') return false;
    p.lost = [...(p.lost || []), ...p.influences];
    p.influences = [];
    p.alive = false;
    p.left = true;
    addLog(gameState, 'elimination', `🚪 ${p.name} saiu da partida e foi eliminado`);
    checkGameEnd(gameState);
    if (gameState.phase === 'finished') return true;
    const a = gameState.pendingAction, c = gameState.pendingChallenge;
    if (gameState.currentTurn === playerId || a?.targetId === playerId || gameState.pendingBlock?.blockerId === playerId ||
        c?.challengerId === playerId || c?.targetId === playerId) {
        nextTurn(gameState); // ação envolvendo quem saiu perde o sentido: segue para o próximo
    } else if (gameState.pendingLoss?.playerId === playerId) {
        gameState.pendingLoss = null;
        continueAfterLoss(gameState);
    }
    return true;
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
    
    const assassinCost = 3;
    // Regra oficial: começar o turno com 10+ moedas obriga o Golpe
    const mustCoupNow = player.coins >= 10;
    const allowBluff = true;
    
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

    if (inGame(gameState, CHARACTERS.INQUISITOR)) {
        const hasInq = hasCharacter(player, CHARACTERS.INQUISITOR);
        const off = mustCoupNow || (!allowBluff && !hasInq);
        actions.push({ id: ACTIONS.INQ_EXCHANGE, label: ACTION_LABELS[ACTIONS.INQ_EXCHANGE], cost: 0, primary: hasInq, bluff: allowBluff && !hasInq, blockable: false, disabled: off });
        actions.push({ id: ACTIONS.EXAMINE, label: ACTION_LABELS[ACTIONS.EXAMINE], cost: 0, primary: hasInq, bluff: allowBluff && !hasInq, requiresTarget: true, blockable: false, disabled: off || !getValidTargets(gameState, player.id, ACTIONS.EXAMINE).length });
    }

    if (hr.reformation) {
        const hasDukeR = hasCharacter(player, CHARACTERS.DUKE);
        actions.push({ id: ACTIONS.CONVERT_SELF, label: ACTION_LABELS[ACTIONS.CONVERT_SELF], cost: 1, primary: false, bluff: false, disabled: mustCoupNow || player.coins < 1 });
        actions.push({ id: ACTIONS.CONVERT, label: ACTION_LABELS[ACTIONS.CONVERT], cost: 2, primary: false, bluff: false, requiresTarget: true, disabled: mustCoupNow || player.coins < 2 });
        actions.push({ id: ACTIONS.EMBEZZLE, label: `${ACTION_LABELS[ACTIONS.EMBEZZLE]} (${gameState.treasury || 0})`, cost: 0, primary: !hasDukeR, bluff: hasDukeR, disabled: mustCoupNow });
    }
    // Reforma: ataques só contra a outra facção (salvo todos iguais)
    actions.forEach(a => {
        if ([ACTIONS.COUP, ACTIONS.ASSASSINATE, ACTIONS.STEAL].includes(a.id) && !getValidTargets(gameState, player.id, a.id).length) a.disabled = true;
    });
    
    return actions;
}

// Obtém alvos válidos (vivos, exceto si mesmo; na Reforma, ataques só contra a outra facção)
function getValidTargets(gameState, playerId, action) {
    const attack = [ACTIONS.COUP, ACTIONS.ASSASSINATE, ACTIONS.STEAL, ACTIONS.EXAMINE].includes(action);
    return Object.values(gameState.players).filter(p => p.alive && p.id !== playerId && (!attack || canHitFaction(gameState, playerId, p.id)));
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
    canChallengeAction,
    blockOptions,
    checkTimeout,
    getResponders,
    normalizeState,
    cleanName,
    autoTurn,
    removePlayer,
    TURN_MS,
    RESPONSE_MS,
    nowMs,
    applyPendingAction,
    resolveChallenge,
    processCoup,
    processAssassinate,
    processSteal,
    processExchange,
    processInqExchange,
    processExamine,
    processExamineShow,
    processExamineDecide,
    processConvert,
    processEmbezzle,
    assignFactions,
    canHitFaction,
    FACTIONS,
    FACTION_LABELS,
    FACTION_ICONS,
    inGame,
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