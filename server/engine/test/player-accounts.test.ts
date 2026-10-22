import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Kysely } from 'kysely';

import { BunSqliteDialect } from '../src/db/dialect/BunSqliteDialect.js';
import type { DB } from '../src/db/types.js';
import PlayerAccounts, { normalizeBotName, normalizePhone, phoneHash, randomPassword, readSession, signSession } from '../src/server/accounts/Players.js';
import { type PhoneVerifier, TwilioVerify } from '../src/server/accounts/PhoneVerify.js';
import { createAccountRoutes } from '../src/web/pages/account.js';

// pvp-sdk: fair play (docs/FAIR_PLAY.md) - one phone number is one player, and a player
// gets 5 bots a season that only log in from a slot.

const SECRET = 'test-accounts-secret';

function freshDb(): Kysely<DB> {
    const database = new Database(':memory:');
    database.exec(`CREATE TABLE account (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
        registration_ip TEXT, registration_date DATETIME, staffmodlevel INTEGER NOT NULL DEFAULT 0)`);
    database.exec(readFileSync(join(import.meta.dir, '../prisma/singleworld/migrations/20261022100000_player_accounts/migration.sql'), 'utf8'));
    return new Kysely<DB>({ dialect: new BunSqliteDialect({ database }) });
}

async function legacyAccount(db: Kysely<DB>, username: string, password: string, staffmodlevel = 0): Promise<number> {
    await db.insertInto('account').values({ username, password: await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 4 }), registration_date: '2026-10-01 00:00:00', staffmodlevel }).execute();
    return (await db.selectFrom('account').select('id').where('username', '=', username).executeTakeFirstOrThrow()).id;
}

describe('inputs', () => {
    test('phone numbers must be full international numbers', () => {
        expect(normalizePhone('+356 9912 3456')).toBe('+35699123456');
        expect(normalizePhone('+1 (555) 010-9999')).toBe('+15550109999');
        expect(normalizePhone('99123456')).toBeNull();
        expect(normalizePhone('+0123456789')).toBeNull();
        expect(normalizePhone('+12')).toBeNull();
    });

    test('bot names follow create-bot.ts: 1-12 letters or digits, stored lower-case', () => {
        expect(normalizeBotName('Zezima')).toBe('zezima');
        expect(normalizeBotName('thirteenchars')).toBeNull();
        expect(normalizeBotName('no spaces')).toBeNull();
        expect(normalizeBotName('')).toBeNull();
    });

    test('phone hashes are keyed, so the table alone reveals nothing', () => {
        expect(phoneHash('+35699123456', SECRET)).toBe(phoneHash('+35699123456', SECRET));
        expect(phoneHash('+35699123456', SECRET)).not.toBe(phoneHash('+35699123456', 'another-secret'));
        expect(phoneHash('+35699123456', SECRET)).not.toContain('35699123456');
    });

    test('passwords are 16 crypto-random letters and digits', () => {
        const a = randomPassword();
        expect(a).toMatch(/^[A-Za-z0-9]{16}$/);
        expect(randomPassword()).not.toBe(a);
    });

    test('sessions are signed and expire', () => {
        const now = Date.UTC(2026, 9, 22);
        const cookie = signSession(42, SECRET, now);
        expect(readSession(cookie, SECRET, now)).toBe(42);
        expect(readSession(cookie, 'another-secret', now)).toBeNull();
        expect(readSession(cookie.replace(/^42\./, '43.'), SECRET, now)).toBeNull();
        expect(readSession(cookie, SECRET, now + 31 * 24 * 60 * 60 * 1000)).toBeNull();
        expect(readSession('garbage', SECRET, now)).toBeNull();
    });
});

describe('PlayerAccounts', () => {
    let db: Kysely<DB>;
    let season1: PlayerAccounts;
    beforeEach(() => {
        db = freshDb();
        season1 = new PlayerAccounts(db, 1, 5, ['badword']);
    });

    test('a phone number is one player, however often they sign in', async () => {
        const a = await season1.playerForPhone(phoneHash('+35699123456', SECRET));
        expect(await season1.playerForPhone(phoneHash('+35699123456', SECRET))).toBe(a);
        expect(await season1.playerForPhone(phoneHash('+35699000000', SECRET))).not.toBe(a);
    });

    test('five bots a season, and a slot never comes back', async () => {
        const player = await season1.playerForPhone('p1');
        for (let i = 1; i <= 5; i++) {
            const made = await season1.createBot(player, `bot${i}`, '203.0.113.9');
            expect(made.ok).toBe(true);
        }
        const sixth = await season1.createBot(player, 'bot6', null);
        expect(sixth).toEqual({ ok: false, error: expect.stringContaining('5 bots this season') });
        expect((await season1.bots(player)).map(b => b.username)).toEqual(['bot1', 'bot2', 'bot3', 'bot4', 'bot5']);
        // the refused bot wasn't left behind as an unowned account
        expect(await db.selectFrom('account').select('id').where('username', '=', 'bot6').executeTakeFirst()).toBeUndefined();
    });

    test('names must be free, valid and clean', async () => {
        const player = await season1.playerForPhone('p1');
        await legacyAccount(db, 'zezima', 'hunter2');
        expect((await season1.createBot(player, 'Zezima', null)).ok).toBe(false);
        expect((await season1.createBot(player, 'my bot', null)).ok).toBe(false);
        expect((await season1.createBot(player, 'xbadwordx', null)).ok).toBe(false);
        expect(await season1.bots(player)).toEqual([]);
    });

    test('only slotted bots and staff may log in', async () => {
        const player = await season1.playerForPhone('p1');
        const legacy = await legacyAccount(db, 'oldbot', 'pw-oldbot');
        const staff = await legacyAccount(db, 'jmod', 'pw-jmod', 2);
        expect(await season1.mayLogIn(legacy, 0)).toBe(false);
        expect(await season1.mayLogIn(staff, 2)).toBe(true);

        const made = await season1.createBot(player, 'newbot', null);
        const newbot = (await db.selectFrom('account').select('id').where('username', '=', 'newbot').executeTakeFirstOrThrow()).id;
        expect(made.ok && (await Bun.password.verify(made.password, (await db.selectFrom('account').select('password').where('id', '=', newbot).executeTakeFirstOrThrow()).password))).toBe(true);
        expect(await season1.mayLogIn(newbot, 0)).toBe(true);
    });

    test('claiming needs the password, and an account has one owner a season', async () => {
        const alice = await season1.playerForPhone('alice');
        const bob = await season1.playerForPhone('bob');
        const legacy = await legacyAccount(db, 'oldbot', 'pw-oldbot');

        expect(await season1.claimBot(alice, 'oldbot', 'wrong')).toEqual({ ok: false, error: 'Wrong bot name or password.' });
        expect(await season1.claimBot(alice, 'nosuchbot', 'pw')).toEqual({ ok: false, error: 'Wrong bot name or password.' });
        expect(await season1.claimBot(alice, 'OldBot', 'pw-oldbot')).toEqual({ ok: true, username: 'oldbot' });
        expect(await season1.mayLogIn(legacy, 0)).toBe(true);
        expect((await season1.claimBot(alice, 'oldbot', 'pw-oldbot')).ok).toBe(false);
        expect(await season1.claimBot(bob, 'oldbot', 'pw-oldbot')).toEqual({ ok: false, error: '"oldbot" belongs to another player this season.' });
    });

    test('a claim counts toward the five', async () => {
        const player = await season1.playerForPhone('p1');
        for (let i = 1; i <= 5; i++) await season1.createBot(player, `bot${i}`, null);
        await legacyAccount(db, 'oldbot', 'pw-oldbot');
        expect((await season1.claimBot(player, 'oldbot', 'pw-oldbot')).ok).toBe(false);
    });

    test('a new season starts everyone with empty slots', async () => {
        const player = await season1.playerForPhone('p1');
        await season1.createBot(player, 'veteran', null);
        const id = (await db.selectFrom('account').select('id').where('username', '=', 'veteran').executeTakeFirstOrThrow()).id;
        const season2 = new PlayerAccounts(db, 2, 5);
        expect(await season2.bots(player)).toEqual([]);
        expect(await season2.mayLogIn(id, 0)).toBe(false);
    });

    test('password resets only for your own bots, and the old password stops working', async () => {
        const alice = await season1.playerForPhone('alice');
        const bob = await season1.playerForPhone('bob');
        const made = await season1.createBot(alice, 'alicebot', null);
        expect((await season1.resetPassword(bob, 'alicebot')).ok).toBe(false);
        const reset = await season1.resetPassword(alice, 'alicebot');
        expect(reset.ok).toBe(true);
        const stored = (await db.selectFrom('account').select('password').where('username', '=', 'alicebot').executeTakeFirstOrThrow()).password;
        expect(made.ok && (await Bun.password.verify(made.password, stored))).toBe(false);
        expect(reset.ok && (await Bun.password.verify(reset.password, stored))).toBe(true);
    });

    test('API keys are stored hashed, and a new one replaces the old', async () => {
        const player = await season1.playerForPhone('p1');
        const first = await season1.newApiKey(player);
        expect(await season1.playerForApiKey(first)).toBe(player);
        const stored = (await db.selectFrom('player').select('api_key_hash').where('id', '=', player).executeTakeFirstOrThrow()).api_key_hash;
        expect(stored).not.toContain(first);
        const second = await season1.newApiKey(player);
        expect(await season1.playerForApiKey(first)).toBeNull();
        expect(await season1.playerForApiKey(second)).toBe(player);
        expect(await season1.playerForApiKey('pvp_guess')).toBeNull();
    });
});

describe('/account and /api/bots', () => {
    const sent: string[] = [];
    let refuse = false;
    const filledSlots = (html: string) => (html.match(/class="slot filled"/g) ?? []).length;
    const verifier: PhoneVerifier = {
        async send(phone) {
            if (refuse) return { ok: false, error: 'Provider said no.' };
            sent.push(phone);
            return { ok: true };
        },
        async check(_phone, code) {
            return code === '123456';
        }
    };

    function routes(overrides: Partial<Parameters<typeof createAccountRoutes>[0]> = {}) {
        const db = freshDb();
        const accounts = new PlayerAccounts(db, 1, 5);
        const handle = createAccountRoutes({
            accounts, verifier, secret: SECRET, enforced: true, turnstileSiteKey: 'site-key',
            turnstile: async token => token === 'human', smsPerIpPerHour: 3, smsPerDay: 100, allowedPrefixes: [], ...overrides
        });
        const call = (path: string, init: RequestInit = {}, ip = '203.0.113.9') => handle(new Request(`https://pvp-sdk.fly.dev${path}`, init), new URL(`https://pvp-sdk.fly.dev${path}`), ip);
        const form = (fields: Record<string, string>, cookie = '') => ({ method: 'POST', body: new URLSearchParams(fields), headers: cookie ? { cookie } : {} });
        return { db, accounts, call, form };
    }

    async function signIn(r: ReturnType<typeof routes>, phone = '+35699123456') {
        await r.call('/account/sms', r.form({ phone, 'cf-turnstile-response': 'human' }));
        const res = (await r.call('/account/verify', r.form({ phone, code: '123456' })))!;
        return res.headers.get('set-cookie')!.split(';')[0]!;
    }

    test('other paths pass through', async () => {
        expect(await routes().call('/hiscores')).toBeNull();
    });

    test('signed out, /account asks for a phone number behind Turnstile', async () => {
        const html = await (await routes().call('/account'))!.text();
        expect(html).toContain('action="/account/sms"');
        expect(html).toContain('data-sitekey="site-key"');
        expect(html).toContain('challenges.cloudflare.com/turnstile');
    });

    test('without SMS keys, sign-up says so instead of half-working', async () => {
        const res = (await routes({ verifier: null }).call('/account'))!;
        expect(res.status).toBe(503);
        expect(await res.text()).toContain("isn't set up");
    });

    test('a text needs a full number, a passed human check and an allowed country', async () => {
        sent.length = 0;
        const r = routes({ allowedPrefixes: ['+356'] });
        expect(await (await r.call('/account/sms', r.form({ phone: '99123456', 'cf-turnstile-response': 'human' })))!.text()).toContain('country code');
        expect(await (await r.call('/account/sms', r.form({ phone: '+35699123456', 'cf-turnstile-response': 'robot' })))!.text()).toContain('human check failed');
        expect(await (await r.call('/account/sms', r.form({ phone: '+15550109999', 'cf-turnstile-response': 'human' })))!.text()).toContain('isn&#39;t open to that country');
        expect(sent).toEqual([]);
        expect(await (await r.call('/account/sms', r.form({ phone: '+356 9912 3456', 'cf-turnstile-response': 'human' })))!.text()).toContain('Enter your code');
        expect(sent).toEqual(['+35699123456']);
    });

    test('texts are capped per address', async () => {
        sent.length = 0;
        const r = routes();
        for (let i = 0; i < 3; i++) await r.call('/account/sms', r.form({ phone: `+3569912345${i}`, 'cf-turnstile-response': 'human' }));
        expect(await (await r.call('/account/sms', r.form({ phone: '+35699123459', 'cf-turnstile-response': 'human' })))!.text()).toContain('Too many codes');
        expect(sent.length).toBe(3);
    });

    test('a text the provider refused does not use up the caps', async () => {
        sent.length = 0;
        const r = routes();
        refuse = true;
        for (let i = 0; i < 5; i++) {
            expect(await (await r.call('/account/sms', r.form({ phone: '+35699123456', 'cf-turnstile-response': 'human' })))!.text()).toContain('Provider said no.');
        }
        refuse = false;
        expect(await (await r.call('/account/sms', r.form({ phone: '+35699123456', 'cf-turnstile-response': 'human' })))!.text()).toContain('Enter your code');
        expect(sent).toEqual(['+35699123456']);
    });

    test('the right code signs you in with a strict, http-only cookie', async () => {
        const r = routes();
        await r.call('/account/sms', r.form({ phone: '+35699123456', 'cf-turnstile-response': 'human' }));
        expect(await (await r.call('/account/verify', r.form({ phone: '+35699123456', code: '000000' })))!.text()).toContain('didn&#39;t work');
        const res = (await r.call('/account/verify', r.form({ phone: '+35699123456', code: '123456' })))!;
        expect(res.status).toBe(303);
        const cookie = res.headers.get('set-cookie')!;
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=Strict');
        expect(cookie).toContain('Secure');
        const page = await (await r.call('/account', { headers: { cookie: cookie.split(';')[0]! } }))!.text();
        expect(page).toContain('slots used');
        expect(filledSlots(page)).toBe(0);
        expect((page.match(/class="slot empty"/g) ?? []).length).toBe(5);
    });

    test('a signed-in player creates a bot and sees its password once', async () => {
        const r = routes();
        const cookie = await signIn(r);
        const html = await (await r.call('/account/bots', r.form({ name: 'Webbot' }, cookie)))!.text();
        expect(html).toMatch(/PASSWORD=[A-Za-z0-9]{16}/);
        expect(html).toContain('SERVER=pvp-sdk.fly.dev');
        const after = await (await r.call('/account', { headers: { cookie } }))!.text();
        expect(filledSlots(after)).toBe(1);
        expect(after).toContain('webbot');
    });

    test('forms from other sites are refused', async () => {
        const r = routes();
        const cookie = await signIn(r);
        const res = (await r.call('/account/bots', { method: 'POST', body: new URLSearchParams({ name: 'evil' }), headers: { cookie, origin: 'https://evil.example' } }))!;
        expect(res.status).toBe(403);
        expect(await r.accounts.bots(1)).toEqual([]);
    });

    test('the API needs a key, creates bots in the slots and stops at five', async () => {
        const r = routes();
        expect(await (await r.call('/api/accounts'))!.json()).toEqual({ enabled: true, configured: true, season: 1, botsPerPlayer: 5, signup: '/account' });
        expect((await r.call('/api/bots', { method: 'POST', body: JSON.stringify({ username: 'x' }) }))!.status).toBe(401);

        const cookie = await signIn(r);
        const keyPage = await (await r.call('/account/key', r.form({}, cookie)))!.text();
        const key = keyPage.match(/PVP_SDK_KEY=(pvp_[A-Za-z0-9_-]+)/)![1]!;
        const auth = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
        for (let i = 1; i <= 5; i++) {
            const res = (await r.call('/api/bots', { method: 'POST', headers: auth, body: JSON.stringify({ username: `apibot${i}` }) }))!;
            expect(res.status).toBe(200);
            expect((await res.json()).password).toMatch(/^[A-Za-z0-9]{16}$/);
        }
        const sixth = (await r.call('/api/bots', { method: 'POST', headers: auth, body: JSON.stringify({ username: 'apibot6' }) }))!;
        expect(sixth.status).toBe(409);
        const list = await (await r.call('/api/bots', { headers: auth }))!.json();
        expect(list.bots.length).toBe(5);
        expect(list.limit).toBe(5);
    });

    test('the API claims an existing bot with its password', async () => {
        const r = routes();
        await legacyAccount(r.db, 'oldbot', 'pw-oldbot');
        const cookie = await signIn(r);
        const key = (await (await r.call('/account/key', r.form({}, cookie)))!.text()).match(/PVP_SDK_KEY=(pvp_[A-Za-z0-9_-]+)/)![1]!;
        const auth = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
        expect((await r.call('/api/bots/claim', { method: 'POST', headers: auth, body: JSON.stringify({ username: 'oldbot', password: 'nope' }) }))!.status).toBe(409);
        const ok = (await r.call('/api/bots/claim', { method: 'POST', headers: auth, body: JSON.stringify({ username: 'oldbot', password: 'pw-oldbot' }) }))!;
        expect(await ok.json()).toEqual({ username: 'oldbot' });
    });
});

describe('TwilioVerify', () => {
    test('sends and checks through the Verify service with basic auth', async () => {
        const calls: { url: string; body: string; auth: string }[] = [];
        const fake = async (url: string, init?: RequestInit) => {
            calls.push({ url, body: String(init?.body), auth: new Headers(init?.headers).get('authorization')! });
            return new Response(JSON.stringify(url.endsWith('VerificationCheck') ? { status: 'approved' } : { status: 'pending' }));
        };
        const twilio = new TwilioVerify('AC123', 'tok', 'VA456', fake);
        expect(await twilio.send('+35699123456')).toEqual({ ok: true });
        expect(await twilio.check('+35699123456', '123456')).toBe(true);
        expect(calls[0]!.url).toBe('https://verify.twilio.com/v2/Services/VA456/Verifications');
        expect(calls[0]!.body).toBe('To=%2B35699123456&Channel=sms');
        expect(calls[0]!.auth).toBe('Basic ' + Buffer.from('AC123:tok').toString('base64'));
        expect(calls[1]!.body).toBe('To=%2B35699123456&Code=123456');
    });

    test('turns Twilio errors into something a player can act on', async () => {
        const failing = (code: number, status = 400) => new TwilioVerify('AC', 't', 'VA', async () => new Response(JSON.stringify({ code }), { status }));
        expect(await failing(60203).send('+35699123456')).toEqual({ ok: false, error: 'Too many codes sent to that number. Try again later.' });
        expect(await failing(60605).send('+35699123456')).toEqual({ ok: false, error: "We can't send texts to that number's country." });
        expect(await failing(60200).send('+35699123456')).toEqual({ ok: false, error: "That doesn't look like a valid mobile number." });
        expect(await failing(21608, 403).send('+35699123456')).toEqual({ ok: false, error: 'Sign-up texts are switched off for now. Tell the server owner.' });
        expect(await failing(21408, 403).send('+35699123456')).toEqual({ ok: false, error: "We can't send texts to that number's country." });
        expect(await failing(20404, 404).check('+35699123456', '1')).toBe(false);
    });
});

describe('switching fair play on', () => {
    const KEYS = ['PLAYER_ACCOUNTS', 'ACCOUNTS_SECRET', 'PHONE_VERIFY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'];

    async function enforced(env: Record<string, string>): Promise<string | undefined> {
        const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.includes(k)));
        const proc = Bun.spawn({
            cmd: ['bun', '-e', "const { default: E } = await import('#/util/Environment.js'); console.log(E.PLAYER_ACCOUNTS)"],
            cwd: join(import.meta.dir, '..'),
            env: { ...inherited, ...env },
            stdout: 'pipe',
            stderr: 'pipe'
        });
        return (await new Response(proc.stdout).text()).trim().split('\n').pop();
    }

    const live = { ACCOUNTS_SECRET: 's', TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_VERIFY_SERVICE_SID: 'VA', TURNSTILE_SITE_KEY: 'k', TURNSTILE_SECRET_KEY: 'k' };

    test('off unless asked for', async () => {
        expect(await enforced(live)).toBe('false');
    });

    test('asked for with every key set, it is enforced', async () => {
        expect(await enforced({ ...live, PLAYER_ACCOUNTS: 'true' })).toBe('true');
    });

    test('a missing key keeps it off, so nobody is locked out while sign-up cannot work', async () => {
        for (const missing of Object.keys(live)) {
            const { [missing]: _gone, ...rest } = live as Record<string, string>;
            expect(await enforced({ ...rest, PLAYER_ACCOUNTS: 'true' })).toBe('false');
        }
    });

    test('dev mode needs only the secret', async () => {
        expect(await enforced({ PLAYER_ACCOUNTS: 'true', PHONE_VERIFY: 'dev', ACCOUNTS_SECRET: 's' })).toBe('true');
    });
});
