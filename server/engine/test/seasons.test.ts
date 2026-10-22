import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { marketDatabasePath } from '../src/engine/market/MarketStore.js';

// pvp-sdk: seasons. A season is a profile (saves, hiscores, PvP kills) plus its own
// exchange database, all chosen from SEASON (util/Environment.ts).

describe('season exchange database', () => {
    test('season 1 keeps GE_DATABASE; later seasons get their own file beside it', () => {
        expect(marketDatabasePath('/opt/server/data/market.sqlite', 1)).toBe('/opt/server/data/market.sqlite');
        expect(marketDatabasePath('/opt/server/data/market.sqlite', 3)).toBe('/opt/server/data/market.season-3.sqlite');
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

    test('season 1 is the original world; later seasons start over on season-N', async () => {
        expect(await profileWith({})).toBe('1 main');
        expect(await profileWith({ SEASON: '1' })).toBe('1 main');
        expect(await profileWith({ SEASON: '4' })).toBe('4 season-4');
    });

    test('an explicit NODE_PROFILE wins', async () => {
        expect(await profileWith({ SEASON: '4', NODE_PROFILE: 'test' })).toBe('4 test');
    });
});
