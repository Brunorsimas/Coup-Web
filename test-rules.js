// Autoteste das regras: node test-rules.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, 'game-logic.js'), 'utf8').replace(/^export\s+/m, '');
const G = new Function('window', src + '\nreturn GameLogic;')({});

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('OK   ' + name); }
    catch (e) { fail++; console.log('FAIL ' + name + ' - ' + e.message); }
}

function mk(p1, p2, c1 = 2, c2 = 2, extra = {}) {
    return G.normalizeState({
        currentTurn: 'p1',
        players: {
            p1: { id: 'p1', name: 'A', coins: c1, influences: [...p1], alive: true, order: 0 },
            p2: { id: 'p2', name: 'B', coins: c2, influences: [...p2], alive: true, order: 1 },
            ...extra
        },
        deck: ['duke', 'captain', 'assassin', 'ambassador'],
        phase: 'action', round: 1
    });
}
const allPass = (s) => G.getResponders(s).forEach(id => G.processPass(s, id));

t('Renda +1 e passa turno', () => {
    const s = mk(['duke', 'captain'], ['assassin', 'countess']);
    G.processIncome(s, 'p1');
    assert.strictEqual(s.players.p1.coins, 3); assert.strictEqual(s.currentTurn, 'p2');
});
t('Ajuda Externa: só aplica após todos permitirem', () => {
    const s = mk(['duke', 'captain'], ['assassin', 'countess']);
    G.processForeignAid(s, 'p1');
    assert.strictEqual(s.players.p1.coins, 2); assert.strictEqual(s.phase, 'challenge_block');
    allPass(s);
    assert.strictEqual(s.players.p1.coins, 4); assert.strictEqual(s.currentTurn, 'p2');
});
t('Com 3 jogadores, um Permitir não resolve', () => {
    const s = mk(['duke', 'captain'], ['assassin', 'countess'], 2, 2,
        { p3: { id: 'p3', name: 'C', coins: 2, influences: ['duke'], alive: true, order: 2 } });
    G.processTax(s, 'p1');
    G.processPass(s, 'p2');
    assert.strictEqual(s.phase, 'challenge_block');
    G.processPass(s, 'p3');
    assert.strictEqual(s.players.p1.coins, 5);
});
t('Timeout: silêncio = permitir', () => {
    const s = mk(['duke', 'captain'], ['assassin', 'countess']);
    G.processTax(s, 'p1');
    assert.strictEqual(G.checkTimeout(s, Date.now()), false);
    assert.strictEqual(G.checkTimeout(s, Date.now() + G.RESPONSE_MS + 1), true);
    assert.strictEqual(s.players.p1.coins, 5);
});
t('Timeout em bloqueio: bloqueio aceito, ação cancelada', () => {
    const s = mk(['captain', 'duke'], ['ambassador', 'countess'], 2, 5);
    G.processSteal(s, 'p1', 'p2');
    G.processBlock(s, 'p2', 'ambassador');
    G.checkTimeout(s, Date.now() + G.RESPONSE_MS + 1);
    assert.strictEqual(s.players.p2.coins, 5); assert.strictEqual(s.currentTurn, 'p2');
});
t('Só alvo bloqueia Roubo; qualquer um bloqueia Ajuda Externa', () => {
    const s = mk(['captain', 'duke'], ['ambassador', 'countess'], 2, 5,
        { p3: { id: 'p3', name: 'C', coins: 2, influences: ['duke'], alive: true, order: 2 } });
    G.processSteal(s, 'p1', 'p2');
    assert.ok(G.canDeclareBlock(s, 'p2')); assert.ok(!G.canDeclareBlock(s, 'p3'));
    s.pendingAction = { type: 'foreign_aid', playerId: 'p1' };
    assert.ok(G.canDeclareBlock(s, 'p3')); assert.ok(!G.canDeclareBlock(s, 'p1'));
    s.pendingAction = { type: 'tax', playerId: 'p1' };
    assert.ok(!G.canDeclareBlock(s, 'p2'));
});
t('Roubo limitado às moedas do alvo', () => {
    const s = mk(['captain', 'duke'], ['assassin', 'countess'], 0, 1);
    G.processSteal(s, 'p1', 'p2'); allPass(s);
    assert.strictEqual(s.players.p1.coins, 1); assert.strictEqual(s.players.p2.coins, 0);
});
t('Golpe: -7 e alvo perde influência', () => {
    const s = mk(['duke', 'captain'], ['assassin', 'countess'], 7);
    G.processCoup(s, 'p1', 'p2');
    assert.strictEqual(s.players.p1.coins, 0); assert.strictEqual(s.pendingLoss.playerId, 'p2');
});
t('Carta perdida fica virada (lost)', () => {
    const s = mk(['duke', 'captain'], ['assassin', 'countess']);
    G.processLoseInfluence(s, 'p2', 'countess');
    assert.deepStrictEqual(s.players.p2.influences, ['assassin']);
    assert.deepStrictEqual(s.players.p2.lost, ['countess']);
});
t('Última influência: eliminado e fim de jogo', () => {
    const s = mk(['duke', 'captain'], ['countess']);
    G.processLoseInfluence(s, 'p2', 'countess');
    assert.strictEqual(s.players.p2.alive, false); assert.strictEqual(s.winner, 'p1');
});
t('Contestação errada: contestador perde e ação ocorre depois', () => {
    const s = mk(['duke', 'captain'], ['assassin', 'countess']);
    G.processTax(s, 'p1'); G.processChallenge(s, 'p2'); G.resolveChallenge(s);
    assert.strictEqual(s.pendingLoss.playerId, 'p2');
    assert.strictEqual(s.players.p1.influences.length, 2, 'repôs carta');
    G.processLoseInfluence(s, 'p2', 'countess');
    assert.strictEqual(s.players.p1.coins, 5);
});
t('Blefe pego: blefador perde e ação cancela', () => {
    const s = mk(['captain', 'assassin'], ['duke', 'countess']);
    G.processTax(s, 'p1'); G.processChallenge(s, 'p2'); G.resolveChallenge(s);
    assert.strictEqual(s.pendingLoss.playerId, 'p1');
    G.processLoseInfluence(s, 'p1', 'captain');
    assert.strictEqual(s.players.p1.coins, 2); assert.strictEqual(s.currentTurn, 'p2');
});
t('Bloqueio verdadeiro contestado: ação cancelada', () => {
    const s = mk(['captain', 'duke'], ['ambassador', 'countess'], 2, 5);
    G.processSteal(s, 'p1', 'p2'); G.processBlock(s, 'p2', 'ambassador');
    G.processChallenge(s, 'p1'); G.resolveChallenge(s);
    assert.strictEqual(s.pendingLoss.playerId, 'p1');
    G.processLoseInfluence(s, 'p1', 'duke');
    assert.strictEqual(s.players.p2.coins, 5); assert.strictEqual(s.currentTurn, 'p2');
});
t('Bloqueio blefado contestado: blefador perde e ação ocorre', () => {
    const s = mk(['captain', 'duke'], ['assassin', 'countess'], 2, 5);
    G.processSteal(s, 'p1', 'p2'); G.processBlock(s, 'p2', 'captain');
    G.processChallenge(s, 'p1'); G.resolveChallenge(s);
    assert.strictEqual(s.pendingLoss.playerId, 'p2');
    G.processLoseInfluence(s, 'p2', 'assassin');
    assert.strictEqual(s.players.p1.coins, 4); assert.strictEqual(s.players.p2.coins, 3);
});
t('Condessa blefada contra Assassinato: perde as 2 cartas', () => {
    const s = mk(['assassin', 'duke'], ['captain', 'duke'], 3);
    G.processAssassinate(s, 'p1', 'p2'); G.processBlock(s, 'p2', 'countess');
    G.processChallenge(s, 'p1'); G.resolveChallenge(s);
    G.processLoseInfluence(s, 'p2', 'captain');
    assert.strictEqual(s.phase, 'lose_influence'); assert.strictEqual(s.pendingLoss.playerId, 'p2');
    G.processLoseInfluence(s, 'p2', 'duke');
    assert.strictEqual(s.winner, 'p1');
});
t('Assassinato: alvo eliminado na contestação não perde de novo', () => {
    const s = mk(['assassin', 'duke'], ['captain'], 3);
    G.processAssassinate(s, 'p1', 'p2'); G.processChallenge(s, 'p2'); G.resolveChallenge(s);
    G.processLoseInfluence(s, 'p2', 'captain');
    assert.strictEqual(s.phase, 'finished');
});
t('Troca: contestável, depois sorteia 2 e devolve ao baralho', () => {
    const s = mk(['duke', 'captain'], ['assassin', 'countess']);
    G.processExchange(s, 'p1');
    assert.strictEqual(s.phase, 'challenge_block');
    const deck0 = s.deck.length;
    allPass(s);
    assert.strictEqual(s.phase, 'exchange'); assert.strictEqual(s.exchangeOffer.length, 2);
    G.processExchangeComplete(s, 'p1', [s.exchangeOffer[0], 'duke']);
    assert.strictEqual(s.players.p1.influences.length, 2); assert.strictEqual(s.deck.length, deck0);
});
t('Troca não é bloqueável', () => assert.strictEqual(G.getBlockers('exchange').length, 0));
t('Baralho 15 cartas', () => assert.strictEqual(G.createDeck().length, 15));
t('2 jogadores = 3 cartas (automático)', () => {
    assert.strictEqual(G.getInitialCardsPerPlayer(2, {}), 3);
    assert.strictEqual(G.getInitialCardsPerPlayer(4, {}), 2);
});
t('10+ moedas: só Golpe', () => {
    const s = mk(['duke', 'captain'], ['assassin', 'countess'], 10);
    const a = G.getAvailableActions(s.players.p1, s);
    assert.deepStrictEqual(a.filter(x => !x.disabled).map(x => x.id), ['coup']);
});
t('House rule: Assassino custa 2', () => {
    const s = mk(['assassin', 'duke'], ['captain', 'countess'], 2);
    s.houseRules = { assassinCosts2: true };
    G.processAssassinate(s, 'p1', 'p2');
    assert.strictEqual(s.players.p1.coins, 0);
});
t('House rule: sem blefe na 1ª rodada', () => {
    const s = mk(['duke', 'captain'], ['assassin', 'countess'], 3);
    s.houseRules = { noBluffFirstRound: true };
    const a = Object.fromEntries(G.getAvailableActions(s.players.p1, s).map(x => [x.id, x.disabled]));
    assert.strictEqual(a.tax, false); assert.strictEqual(a.steal, false);
    assert.strictEqual(a.assassinate, true); assert.strictEqual(a.exchange, true);
});
t('Turno pula eliminado', () => {
    const s = mk(['duke'], ['assassin'], 2, 2,
        { p3: { id: 'p3', name: 'C', coins: 2, influences: ['duke'], alive: true, order: 2 } });
    s.players.p2.alive = false;
    G.nextTurn(s);
    assert.strictEqual(s.currentTurn, 'p3');
});

// Fuzz: partidas aleatórias completas; conservação das 15 cartas e término
t('Fuzz: 300 partidas aleatórias terminam e conservam 15 cartas', () => {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    for (let g = 0; g < 300; g++) {
        const n = 2 + (g % 5);
        let deck = G.createDeck();
        const players = {};
        for (let i = 0; i < n; i++) {
            const { drawn, remaining } = G.drawCards(deck, G.getInitialCardsPerPlayer(n, {}));
            deck = remaining;
            players['p' + i] = { id: 'p' + i, name: 'P' + i, coins: 2, influences: drawn, alive: true, order: i };
        }
        const s = G.normalizeState({ currentTurn: 'p0', players, deck, phase: 'action', round: 1,
            houseRules: g % 2 ? { assassinCosts2: true, dukeTax3: true } : {} });
        let steps = 0;
        while (s.phase !== 'finished') {
            if (++steps > 5000) throw new Error('não terminou');
            const me = s.players[s.currentTurn];
            if (s.phase === 'action') {
                const act = pick(G.getAvailableActions(me, s).filter(a => !a.disabled));
                const tgt = pick(G.getValidTargets(s, me.id)).id;
                ({ income: () => G.processIncome(s, me.id), foreign_aid: () => G.processForeignAid(s, me.id),
                   tax: () => G.processTax(s, me.id), coup: () => G.processCoup(s, me.id, tgt),
                   assassinate: () => G.processAssassinate(s, me.id, tgt), steal: () => G.processSteal(s, me.id, tgt),
                   exchange: () => G.processExchange(s, me.id) })[act.id]();
            } else if (s.phase === 'challenge_block') {
                const r = Math.random(), who = pick(G.getResponders(s));
                if (r < 0.2 && s.pendingAction.claimedCharacter) G.processChallenge(s, who);
                else if (r < 0.4 && G.canDeclareBlock(s, who)) G.processBlock(s, who, pick(G.getBlockers(s.pendingAction.type)));
                else G.checkTimeout(s, Date.now() + G.RESPONSE_MS + 1);
            } else if (s.phase === 'challenge_block_response') {
                if (Math.random() < 0.4) G.processChallenge(s, s.currentTurn);
                else G.processPass(s, s.currentTurn);
            } else if (s.phase === 'resolve_challenge') {
                G.resolveChallenge(s);
            } else if (s.phase === 'lose_influence') {
                const p = s.players[s.pendingLoss.playerId];
                G.processLoseInfluence(s, p.id, pick(p.influences));
            } else if (s.phase === 'exchange') {
                const pool = [...me.influences, ...s.exchangeOffer].sort(() => Math.random() - 0.5);
                G.processExchangeComplete(s, me.id, pool.slice(0, me.influences.length));
            } else throw new Error('fase desconhecida ' + s.phase);

            const total = s.deck.length + (s.exchangeOffer || []).length +
                Object.values(s.players).reduce((a, p) => a + p.influences.length + p.lost.length, 0);
            if (total !== 15) throw new Error(`cartas=${total} fase=${s.phase} jogo ${g}`);
            Object.values(s.players).forEach(p => {
                if (p.coins < 0) throw new Error('moedas negativas');
                if (p.alive !== p.influences.length > 0) throw new Error('alive inconsistente');
            });
        }
    }
});

console.log(`\n${fail ? fail + ' FALHARAM' : 'TODOS PASSARAM'} (${pass}/${pass + fail})`);
process.exit(fail ? 1 : 0);
