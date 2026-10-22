import { describe, expect, test } from 'bun:test';

import { BREACH_SITES, BreachSchedule, MAUL_CHANCE, MAX_POINTS, WHIP_CHANCE, breachPayouts } from '../src/engine/pvp/Breaches.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const site = BREACH_SITES[0]!;

describe('BreachSchedule', () => {
    const schedule = () => new BreachSchedule(3 * HOUR, 10 * MIN, 20 * MIN, () => site);

    test('opens at fixed UTC times, announced ten minutes ahead, and closes', () => {
        const s = schedule();
        const slot = 100 * 3 * HOUR; // some 3-hourly opening
        expect(s.tick(slot - 30 * MIN)).toEqual([]);
        expect(s.tick(slot - 10 * MIN)).toEqual([{ kind: 'warn', site, opensAt: slot }]);
        expect(s.tick(slot - 9 * MIN)).toEqual([]);
        expect(s.status(slot - 5 * MIN).announced).toEqual({ site: site.name, opensAt: slot });
        expect(s.tick(slot)).toEqual([{ kind: 'open', site, closesAt: slot + 20 * MIN }]);
        expect(s.status(slot + MIN).open).toEqual({ site: site.name, closesAt: slot + 20 * MIN });
        expect(s.tick(slot + 19 * MIN)).toEqual([]);
        expect(s.tick(slot + 20 * MIN)).toEqual([{ kind: 'close', site }]);
        expect(s.status(slot + 21 * MIN)).toEqual({ nextOpensAt: slot + 3 * HOUR, announced: null, open: null });
    });

    test('a killed guardian ends the breach without a closing message', () => {
        const s = schedule();
        const slot = 7 * 3 * HOUR;
        s.tick(slot - 10 * MIN);
        s.tick(slot);
        expect(s.guardianKilled()).toEqual(site);
        expect(s.tick(slot + 20 * MIN)).toEqual([]);
    });

    test('a server started mid-slot waits for the next announced breach', () => {
        const s = schedule();
        const slot = 3 * 3 * HOUR;
        expect(s.tick(slot + MIN)).toEqual([]); // no warning was given for this one
        expect(s.tick(slot + 3 * HOUR - 10 * MIN)[0]!.kind).toBe('warn');
    });
});

describe('breachPayouts', () => {
    test('a point per 5 damage, capped, with fortune half as many again', () => {
        const payouts = breachPayouts([
            { username: 'small', damage: 12, fortune: false },
            { username: 'big', damage: 600, fortune: false },
            { username: 'lucky', damage: 100, fortune: true },
            { username: 'tickled', damage: 1, fortune: false }
        ], 750, () => 0.99);
        expect(payouts).toEqual([
            { username: 'big', points: MAX_POINTS, sigil: true, weapon: null }, // top damage always wins a sigil
            { username: 'lucky', points: 30, sigil: false, weapon: null },
            { username: 'small', points: 2, sigil: false, weapon: null },
            { username: 'tickled', points: 1, sigil: false, weapon: null }
        ]);
    });

    test('a 5% share of the guardian\'s hitpoints buys a 20% sigil chance', () => {
        const fighters = [{ username: 'a', damage: 400, fortune: false }, { username: 'b', damage: 38, fortune: false }, { username: 'c', damage: 37, fortune: false }];
        expect(breachPayouts(fighters, 750, () => 0.1).map(p => p.sigil)).toEqual([true, true, false]);
        expect(breachPayouts(fighters, 750, () => 0.3).map(p => p.sigil)).toEqual([true, false, false]);
    });

    test('every damager rolls once for a whip, else a maul', () => {
        // Rolls in order: each fighter's sigil roll (if eligible), then their weapon roll.
        const rolls = [0.5 /* a: weapon */, 0.9 /* b: sigil */, WHIP_CHANCE / 2 /* b: weapon */, WHIP_CHANCE + MAUL_CHANCE / 2 /* c: weapon */];
        const payouts = breachPayouts([
            { username: 'a', damage: 500, fortune: false },
            { username: 'b', damage: 100, fortune: false },
            { username: 'c', damage: 1, fortune: false }
        ], 750, () => rolls.shift()!);
        expect(payouts.map(p => [p.username, p.weapon])).toEqual([['a', null], ['b', 'abyssal_whip'], ['c', 'granite_maul']]);
    });
});
