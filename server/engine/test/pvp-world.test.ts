import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('compiled pvp-world rules: level range, safe areas, protection, guards and bank keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pvp-world-'));
    try {
        // Run against the built pack, isolating engine workers/database from the main suite.
        const result = Bun.spawnSync([process.execPath, 'test', join(import.meta.dir, 'fixtures/pvp-world.ts')], {
            cwd: join(import.meta.dir, '..'),
            env: { ...process.env, GE_DATABASE: join(dir, 'market.sqlite'), PVP_WORLD_TEST_OUTPUT: dir },
            stdout: 'pipe',
            stderr: 'pipe'
        });
        const output = result.stdout.toString() + result.stderr.toString();
        if (result.exitCode !== 0) throw new Error(output);
        expect(output).toContain('21 pass');
        expect(output).toContain('0 fail');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}, 60000);
