import { describe, expect, test } from 'bun:test';

import RegistrationLimiter from '../src/server/login/RegistrationLimiter.js';
import { OWNER_COOKIE, handleOwnerSignIn, isOwnerOnlyPath, isOwnerRequest, isOwnerToken } from '../src/web/owner.js';

const TOKEN = 'correct-horse-battery-staple';
const req = (path: string, init: RequestInit = {}) => new Request(`https://pvp-sdk.fly.dev${path}`, init);

describe('owner-only routes', () => {
    test('cover live positions, gear and bank boards, and screenshots', () => {
        for (const path of ['/playerpositions', '/playerpositions/', '/playertraces', '/hiscores/outfit', '/highscores/bank/', '/api/screenshot', '/screenshots', '/screenshots/a.png']) {
            expect(isOwnerOnlyPath(path)).toBe(true);
        }
        for (const path of ['/playercount', '/hiscores', '/hiscores/player/zezima', '/hiscores/runite', '/mapview/', '/status/zezima', '/api/version']) {
            expect(isOwnerOnlyPath(path)).toBe(false);
        }
    });

    test('accept the token as a bearer header or the owner cookie', () => {
        expect(isOwnerRequest(req('/playerpositions', { headers: { Authorization: `Bearer ${TOKEN}` } }), TOKEN)).toBe(true);
        expect(isOwnerRequest(req('/playerpositions', { headers: { Cookie: `a=1; ${OWNER_COOKIE}=${encodeURIComponent(TOKEN)}` } }), TOKEN)).toBe(true);
        expect(isOwnerRequest(req('/playerpositions', { headers: { Authorization: 'Bearer nope' } }), TOKEN)).toBe(false);
        expect(isOwnerRequest(req('/playerpositions'), TOKEN)).toBe(false);
    });

    test('stay closed to everyone while no token is configured', () => {
        expect(isOwnerToken('', '')).toBe(false);
        expect(isOwnerRequest(req('/playerpositions', { headers: { Authorization: 'Bearer ' } }), '')).toBe(false);
    });
});

describe('POST /owner', () => {
    test('sets the owner cookie for the right token and goes to the map', async () => {
        const form = new FormData();
        form.set('token', TOKEN);
        const res = (await handleOwnerSignIn(req('/owner', { method: 'POST', body: form }), new URL('https://pvp-sdk.fly.dev/owner'), TOKEN))!;
        expect(res.status).toBe(303);
        expect(res.headers.get('location')).toBe('/mapview/');
        const cookie = res.headers.get('set-cookie')!;
        expect(cookie).toContain(`${OWNER_COOKIE}=`);
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Secure');
    });

    test('refuses a wrong token, and does not exist without one configured', async () => {
        const form = new FormData();
        form.set('token', 'guess');
        const wrong = (await handleOwnerSignIn(req('/owner', { method: 'POST', body: form }), new URL('https://pvp-sdk.fly.dev/owner'), TOKEN))!;
        expect(wrong.status).toBe(403);
        expect(wrong.headers.get('set-cookie')).toBeNull();
        const unset = (await handleOwnerSignIn(req('/owner'), new URL('https://pvp-sdk.fly.dev/owner'), ''))!;
        expect(unset.status).toBe(404);
    });

    test('GET shows a form, so the token never travels in a URL', async () => {
        const res = (await handleOwnerSignIn(req('/owner'), new URL('https://pvp-sdk.fly.dev/owner'), TOKEN))!;
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('method="post"');
    });
});

describe('RegistrationLimiter', () => {
    test('caps new accounts per IP within the window', () => {
        let now = 0;
        const limiter = new RegistrationLimiter(2, 0, 1000, () => now);
        expect(limiter.tryRegister('1.2.3.4')).toBe(true);
        expect(limiter.tryRegister('1.2.3.4')).toBe(true);
        expect(limiter.tryRegister('1.2.3.4')).toBe(false);
        expect(limiter.tryRegister('5.6.7.8')).toBe(true);
        now = 1001;
        expect(limiter.tryRegister('1.2.3.4')).toBe(true);
    });

    test('caps new accounts overall, whatever the address', () => {
        const limiter = new RegistrationLimiter(0, 3, 1000, () => 0);
        expect(['a', 'b', 'c', 'd'].map(ip => limiter.tryRegister(ip))).toEqual([true, true, true, false]);
    });
});
