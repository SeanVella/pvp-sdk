import { describe, expect, test } from 'bun:test';

import { KillJudge, MIN_RISK_GP, PAIR_COOLDOWN_MS, comparableIp, pvpBoard, riskedValue, type CostOf } from '../src/engine/pvp/PvpKills.js';

// id -> store value; 99 is untradeable
const costs: Record<number, { cost: number; tradeable: boolean }> = {
    995: { cost: 1, tradeable: true }, // coins
    1127: { cost: 65000, tradeable: true }, // rune platebody
    385: { cost: 300, tradeable: true }, // shark
    99: { cost: 50000, tradeable: false }
};
const cost: CostOf = id => costs[id] ?? null;

describe('riskedValue', () => {
    test('counts carried items and held keys, never untradeables', () => {
        expect(riskedValue(cost, [{ id: 1127, count: 1 }, { id: 99, count: 1 }], [{ id: 995, count: 500 }], [{ id: 385, count: 100 }], false)).toBe(65500);
    });

    test('adds the 10 most valuable bank stacks only when skulled', () => {
        const bank = Array.from({ length: 12 }, (_, i) => ({ id: 995, count: (i + 1) * 100 }));
        // the top 10 stacks are 300..1200 coins
        expect(riskedValue(cost, [], [], bank, true)).toBe(7500);
        expect(riskedValue(cost, [], [], bank, false)).toBe(0);
    });
});

describe('KillJudge', () => {
    test('counts a fair kill once per pair per cooldown, whichever way it goes', () => {
        const judge = new KillJudge();
        expect(judge.judge('a', 'b', '1.1.1.1', '2.2.2.2', MIN_RISK_GP, 0)).toEqual({ counted: true, reason: null });
        expect(judge.judge('b', 'a', '2.2.2.2', '1.1.1.1', MIN_RISK_GP, 1000)).toEqual({ counted: false, reason: 'repeat_pair' });
        expect(judge.judge('a', 'c', '1.1.1.1', '3.3.3.3', MIN_RISK_GP, 1000).counted).toBe(true);
        expect(judge.judge('b', 'a', '2.2.2.2', '1.1.1.1', MIN_RISK_GP, PAIR_COOLDOWN_MS)).toEqual({ counted: true, reason: null });
    });

    test('sets aside kills between one address, and kills of players who risked nothing', () => {
        const judge = new KillJudge();
        expect(judge.judge('a', 'b', '1.1.1.1', '1.1.1.1', 100_000, 0)).toEqual({ counted: false, reason: 'same_ip' });
        expect(judge.judge('a', 'b', '1.1.1.1', '2.2.2.2', MIN_RISK_GP - 1, 0)).toEqual({ counted: false, reason: 'no_risk' });
        // a set-aside kill doesn't start the pair's cooldown
        expect(judge.judge('a', 'b', '1.1.1.1', '2.2.2.2', MIN_RISK_GP, 0).counted).toBe(true);
    });
});

describe('pvpBoard', () => {
    test('ranks by kills, then loot, with deaths and the best streak between deaths', () => {
        const rows = [
            { timestamp: 1, killer: 'zezima', victim: 'bob', value: 5000 },
            { timestamp: 2, killer: 'zezima', victim: 'carl', value: 1000 },
            { timestamp: 3, killer: 'bob', victim: 'zezima', value: 2000 },
            { timestamp: 4, killer: 'zezima', victim: 'bob', value: 1000 },
            { timestamp: 5, killer: 'carl', victim: 'dave', value: 9000 }
        ];
        expect(pvpBoard(rows, () => false, 10)).toEqual([
            { username: 'zezima', kills: 3, deaths: 1, bestStreak: 2, loot: 7000 },
            { username: 'carl', kills: 1, deaths: 1, bestStreak: 1, loot: 9000 },
            { username: 'bob', kills: 1, deaths: 2, bestStreak: 1, loot: 2000 }
        ]);
    });

    test('leaves out hidden names and players with no kills, and keeps to the size', () => {
        const rows = [
            { timestamp: 1, killer: 'mod', victim: 'bob', value: 5000 },
            { timestamp: 2, killer: 'carl', victim: 'bob', value: 5000 },
            { timestamp: 3, killer: 'dave', victim: 'bob', value: 1000 }
        ];
        expect(pvpBoard(rows, name => name === 'mod', 1).map(r => r.username)).toEqual(['carl']);
    });
});

describe('comparableIp', () => {
    test('treats loopback as unknown, so a local stack can test kills', () => {
        expect(comparableIp('127.0.0.1')).toBeNull();
        expect(comparableIp('::1')).toBeNull();
        expect(comparableIp('::ffff:127.0.0.1')).toBeNull();
        expect(comparableIp(null)).toBeNull();
        expect(comparableIp('203.0.113.7')).toBe('203.0.113.7');
    });
});
