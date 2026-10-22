// pvp-sdk: the gateway's bot list and every bot's position belong to the server owner.
// Runs the real gateway with an OWNER_TOKEN and LOGIN_SERVER on but no login server, so
// no bot password can be checked: what's left is exactly what an anonymous caller sees.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'path';

const PORT = 20000 + Math.floor(Math.random() * 10000);
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'owner-test-token';
const owner = { headers: { Authorization: `Bearer ${TOKEN}` } };

let gateway: ReturnType<typeof Bun.spawn> | null = null;

beforeAll(async () => {
    gateway = Bun.spawn({
        cmd: ['bun', join(import.meta.dir, '..', '..', 'server', 'gateway', 'gateway.ts')],
        env: { ...process.env, AGENT_PORT: String(PORT), LOGIN_SERVER: 'true', LOGIN_PORT: '1', OWNER_TOKEN: TOKEN },
        stdout: 'ignore',
        stderr: 'ignore'
    });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        try {
            if ((await fetch(`${BASE}/`, { signal: AbortSignal.timeout(500) })).ok) return;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('gateway did not boot');
});

afterAll(() => {
    gateway?.kill();
});

describe('gateway owner gating', () => {
    test('GET / is a plain banner for everyone, so direct-gateway probes still pass', async () => {
        const res = await fetch(`${BASE}/`);
        expect(res.ok).toBe(true);
        expect(await res.text()).toContain('Gateway Service');
    });

    test('the bot list is the owner\'s', async () => {
        expect(await (await fetch(`${BASE}/status`)).json()).toEqual({ status: 'running' });
        const full = await (await fetch(`${BASE}/status`, owner)).json();
        expect(full).toMatchObject({ status: 'running', bots: {}, sdks: {} });
        expect(await (await fetch(`${BASE}/`, owner)).json()).toMatchObject({ bots: {} });
    });

    test('a bot\'s status is public, its sessions and position are not', async () => {
        const anon = await (await fetch(`${BASE}/status/zezima`)).json();
        expect(anon).toMatchObject({ status: 'dead', inGame: false });
        expect(anon).not.toHaveProperty('player');
        expect(anon).not.toHaveProperty('controllers');

        const full = await (await fetch(`${BASE}/status/zezima`, owner)).json();
        expect(full).toMatchObject({ status: 'dead', controllers: [], observers: [], player: null });
    });

    test('a wrong token is just anonymous', async () => {
        const res = await (await fetch(`${BASE}/status`, { headers: { Authorization: 'Bearer nope' } })).json();
        expect(res).toEqual({ status: 'running' });
    });
});
