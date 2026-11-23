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
t('Padrão: sem blefe na 1ª rodada', () => assert.strictEqual(G.HOUSE_RULES_DEFAULTS?.noBluffFirstRound ?? true, true));
t('1ª rodada sem blefe: bloqueio só com carta real', () => {
    const s = mk(['captain', 'duke'], ['captain', 'countess'], 2, 5);
    s.houseRules = { noBluffFirstRound: true };
    G.processSteal(s, 'p1', 'p2');
    assert.deepStrictEqual(G.blockOptions(s, 'p2'), ['captain']);
    assert.strictEqual(G.processBlock(s, 'p2', 'ambassador'), false);
    s.round = 2;
    assert.deepStrictEqual(G.blockOptions(s, 'p2'), ['captain', 'ambassador']);
});
t('Contestar: inválido fora da janela, contra Ajuda Externa, por si mesmo ou morto', () => {
    const s = mk(['duke', 'captain'], ['assassin', 'countess'], 2, 2,
        { p3: { id: 'p3', name: 'C', coins: 2, influences: [], alive: false, order: 2 } });
    assert.strictEqual(G.processChallenge(s, 'p2'), false, 'fase action');
    G.processForeignAid(s, 'p1');
    assert.strictEqual(G.processChallenge(s, 'p2'), false, 'ajuda externa');
    s.phase = 'action'; G.processTax(s, 'p1');
    assert.strictEqual(G.processChallenge(s, 'p1'), false, 'autor');
    assert.strictEqual(G.processChallenge(s, 'p3'), false, 'morto');
    assert.strictEqual(G.processChallenge(s, 'p2'), true);
});
t('Contestação fracassada: alvo ainda pode bloquear (Assassinato + Condessa)', () => {
    const s = mk(['assassin', 'duke'], ['captain', 'countess', 'duke'], 3);
    G.processAssassinate(s, 'p1', 'p2'); G.processChallenge(s, 'p2'); G.resolveChallenge(s);
    G.processLoseInfluence(s, 'p2', 'captain');
    assert.strictEqual(s.phase, 'challenge_block');
    assert.deepStrictEqual(G.getResponders(s), ['p2']);
    assert.strictEqual(G.canChallengeAction(s, 'p2'), false, 'não contesta 2x');
    G.processBlock(s, 'p2', 'countess'); allPass(s);
    assert.strictEqual(s.players.p2.influences.length, 2); assert.strictEqual(s.currentTurn, 'p2');
});
t('Qualquer jogador pode contestar um bloqueio', () => {
    const s = mk(['duke', 'captain'], ['assassin', 'countess'], 2, 2,
        { p3: { id: 'p3', name: 'C', coins: 2, influences: ['duke', 'captain'], alive: true, order: 2 } });
    G.processForeignAid(s, 'p1'); G.processBlock(s, 'p2', 'duke');
    assert.deepStrictEqual(G.getResponders(s).sort(), ['p1', 'p3']);
    assert.strictEqual(G.processChallenge(s, 'p3'), true); G.resolveChallenge(s);
    assert.strictEqual(s.pendingLoss.playerId, 'p2');
    G.processLoseInfluence(s, 'p2', 'assassin');
    assert.strictEqual(s.players.p1.coins, 4);
});
t('Bloqueio verdadeiro (Duque) contestado: contestador perde e a vez passa', () => {
    for (const who of ['p1', 'p3']) {
        const s = mk(['captain', 'assassin'], ['duke', 'countess'], 2, 2,
            { p3: { id: 'p3', name: 'C', coins: 2, influences: ['captain', 'ambassador'], alive: true, order: 2 } });
        G.processForeignAid(s, 'p1'); G.processBlock(s, 'p2', 'duke');
        assert.ok(G.processChallenge(s, who)); G.resolveChallenge(s);
        assert.strictEqual(s.pendingLoss.playerId, who);
        G.processLoseInfluence(s, who, 'captain');
        assert.strictEqual(s.phase, 'action'); assert.strictEqual(s.currentTurn, 'p2');
        assert.strictEqual(s.players.p1.coins, 2, 'ajuda bloqueada');
        assert.strictEqual(s.players.p2.influences.length, 2, 'Duque trocado por outra carta');
    }
});
t('Assassinato bloqueado por Condessa verdadeira e contestado: vez passa', () => {
    const s = mk(['assassin', 'duke'], ['countess', 'captain'], 3, 2);
    G.processAssassinate(s, 'p1', 'p2'); G.processBlock(s, 'p2', 'countess');
    assert.ok(G.processChallenge(s, 'p1')); G.resolveChallenge(s);
    assert.strictEqual(s.pendingLoss.playerId, 'p1');
    G.processLoseInfluence(s, 'p1', 'duke');
    assert.strictEqual(s.phase, 'action'); assert.strictEqual(s.currentTurn, 'p2');
    assert.strictEqual(s.players.p2.influences.length, 2);
});
t('Turno pula eliminado', () => {
    const s = mk(['duke'], ['assassin'], 2, 2,
        { p3: { id: 'p3', name: 'C', coins: 2, influences: ['duke'], alive: true, order: 2 } });
    s.players.p2.alive = false;
    G.nextTurn(s);
    assert.strictEqual(s.currentTurn, 'p3');
});

// Fuzz: partidas aleatórias completas; conservação das 15 cartas e término
t('Inquisidor: baralho 18, Troca 1, bloqueia Roubo, só se ativado', () => {
    assert.strictEqual(G.createDeck().length, 15);
    assert.strictEqual(G.createDeck({ withInquisitor: true }).length, 18);
    const s = mk(['inquisitor', 'duke'], ['captain', 'inquisitor'], 2, 5);
    assert.ok(!G.getAvailableActions(s.players.p1, s).some(a => a.id === 'examine'));
    G.processSteal(s, 'p1', 'p2');
    assert.ok(!G.blockOptions(s, 'p2').includes('inquisitor'), 'sem opção, sem Inquisidor');
    s.houseRules = { withInquisitor: true };
    assert.ok(G.blockOptions(s, 'p2').includes('inquisitor'));
    s.phase = 'action'; s.pendingAction = null;
    G.processInqExchange(s, 'p1'); allPass(s);
    assert.strictEqual(s.phase, 'exchange'); assert.strictEqual(s.exchangeOffer.length, 1);
});
t('Inquisidor: bloqueio blefado contestado por terceiro', () => {
    const s = mk(['captain', 'duke'], ['duke', 'countess'], 2, 4,
        { p3: { id: 'p3', name: 'C', coins: 2, influences: ['duke', 'captain'], alive: true, order: 2 } });
    s.houseRules = { withInquisitor: true }; s.round = 2;
    G.processSteal(s, 'p1', 'p2'); assert.ok(G.processBlock(s, 'p2', 'inquisitor'));
    assert.ok(G.processChallenge(s, 'p3')); G.resolveChallenge(s);
    G.processLoseInfluence(s, 'p2', 'duke');
    assert.strictEqual(s.players.p1.coins, 4); assert.strictEqual(s.players.p2.coins, 2);
});
t('Investigar: alvo mostra, Inquisidor força troca', () => {
    const s = mk(['inquisitor', 'duke'], ['captain', 'countess'], 2, 2);
    s.houseRules = { withInquisitor: true };
    G.processExamine(s, 'p1', 'p2'); allPass(s);
    assert.strictEqual(s.phase, 'examine_show');
    assert.strictEqual(G.processExamineShow(s, 'p1', 'duke'), false, 'só o alvo');
    assert.ok(G.processExamineShow(s, 'p2', 'captain'));
    assert.strictEqual(G.processExamineDecide(s, 'p2', true), false, 'só o Inquisidor');
    const before = s.deck.length;
    assert.ok(G.processExamineDecide(s, 'p1', true));
    assert.strictEqual(s.players.p2.influences.length, 2); assert.strictEqual(s.deck.length, before);
    assert.strictEqual(s.currentTurn, 'p2');
});
t('Assassino blefando desmascarado recebe moedas de volta', () => {
    const s = mk(['duke', 'captain'], ['countess', 'duke'], 3, 2);
    s.round = 2;
    G.processAssassinate(s, 'p1', 'p2'); assert.strictEqual(s.players.p1.coins, 0);
    G.processChallenge(s, 'p2'); G.resolveChallenge(s);
    assert.strictEqual(s.players.p1.coins, 3);
    G.processLoseInfluence(s, 'p1', 'duke');
    assert.strictEqual(s.players.p2.influences.length, 2); assert.strictEqual(s.currentTurn, 'p2');
});
t('Assassino verdadeiro bloqueado pela Condessa: moedas gastas', () => {
    const s = mk(['assassin', 'captain'], ['countess', 'duke'], 3, 2);
    G.processAssassinate(s, 'p1', 'p2'); G.processBlock(s, 'p2', 'countess'); allPass(s);
    assert.strictEqual(s.players.p1.coins, 0);
});
t('Fuzz: 300 partidas aleatórias terminam e conservam cartas e moedas', () => {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    for (let g = 0; g < 300; g++) {
        const n = 2 + (g % 5);
        const houseRules = { assassinCosts2: g % 2 === 1, withInquisitor: g % 3 === 0, noBluffFirstRound: g % 4 === 0 };
        const totalCards = houseRules.withInquisitor ? 18 : 15;
        let deck = G.createDeck(houseRules);
        const players = {};
        for (let i = 0; i < n; i++) {
            const { drawn, remaining } = G.drawCards(deck, G.getInitialCardsPerPlayer(n, {}));
            deck = remaining;
            players['p' + i] = { id: 'p' + i, name: 'P' + i, coins: 2, influences: drawn, alive: true, order: i };
        }
        const s = G.normalizeState({ currentTurn: 'p0', players, deck, phase: 'action', round: 1,
            houseRules });
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
                   exchange: () => G.processExchange(s, me.id), inq_exchange: () => G.processInqExchange(s, me.id),
                   examine: () => G.processExamine(s, me.id, tgt) })[act.id]();
            } else if (s.phase === 'challenge_block') {
                const r = Math.random(), who = pick(G.getResponders(s));
                const opts = G.blockOptions(s, who);
                if (r < 0.2 && G.canChallengeAction(s, who)) assert.ok(G.processChallenge(s, who));
                else if (r < 0.4 && opts.length) assert.ok(G.processBlock(s, who, pick(opts)));
                else G.checkTimeout(s, Date.now() + G.RESPONSE_MS + 1);
            } else if (s.phase === 'challenge_block_response') {
                if (Math.random() < 0.4) assert.ok(G.processChallenge(s, pick(G.getResponders(s))));
                else G.checkTimeout(s, Date.now() + G.RESPONSE_MS + 1);
            } else if (s.phase === 'examine_show') {
                const t2 = s.players[s.pendingAction.targetId];
                assert.ok(G.processExamineShow(s, t2.id, pick(t2.influences)));
            } else if (s.phase === 'examine_decide') {
                assert.ok(G.processExamineDecide(s, me.id, Math.random() < 0.5));
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
            if (total !== totalCards) throw new Error(`cartas=${total} fase=${s.phase} jogo ${g}`);
            Object.values(s.players).forEach(p => {
                if (p.coins < 0) throw new Error('moedas negativas');
                if (p.alive !== p.influences.length > 0) throw new Error('alive inconsistente');
            });
        }
    }
});

console.log(`\n${fail ? fail + ' FALHARAM' : 'TODOS PASSARAM'} (${pass}/${pass + fail})`);
process.exit(fail ? 1 : 0);
