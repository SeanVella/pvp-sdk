import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { marketDatabasePath } from '../src/engine/market/MarketStore.js';

// pvp-sdk: seasons. A season is a profile (saves, hiscores, PvP kills) plus its own
// exchange database, all chosen from SEASON (util/Environment.ts).

describe('season exchange database', () => {
    test('the beta keeps GE_DATABASE; every season gets its own file beside it', () => {
        expect(marketDatabasePath('/opt/server/data/market.sqlite', 0)).toBe('/opt/server/data/market.sqlite');
        expect(marketDatabasePath('/opt/server/data/market.sqlite', 1)).toBe('/opt/server/data/market.season-1.sqlite');
        expect(marketDatabasePath('data/market', 2)).toBe('data/market.season-2');
    });
});

describe('season profile', () => {
    async function profileWith(env: Record<string, string>) {
        const { SEASON: _s, NODE_PROFILE: _p, ...inherited } = process.env;
        const proc = Bun.spawn({
            cmd: ['bun', '-e', "const { default: E } = await import('#/util/Environment.js'); console.log(E.SEASON, E.node.profile)"],
            cwd: join(import.meta.dir, '..'),
            env: { ...inherited, ...env },
            stdout: 'pipe',
            stderr: 'pipe'
        });
        return (await new Response(proc.stdout).text()).trim().split('\n').pop();
    }

    test('the beta, season 0, is the original world; each season starts over on season-N', async () => {
        expect(await profileWith({})).toBe('0 main');
        expect(await profileWith({ SEASON: '0' })).toBe('0 main');
        expect(await profileWith({ SEASON: '1' })).toBe('1 season-1');
        expect(await profileWith({ SEASON: '4' })).toBe('4 season-4');
    });

    test('an explicit NODE_PROFILE wins', async () => {
        expect(await profileWith({ SEASON: '4', NODE_PROFILE: 'test' })).toBe('4 test');
    });
});
