// pvp-sdk: fair play (docs/FAIR_PLAY.md). A player is one verified phone number, and each
// player gets BOTS_PER_PLAYER game accounts ("bots") a season. Slots never come back within
// a season, so nobody can cycle fresh characters. The login server, the /account pages and
// the bot API all go through this file, so they can't disagree about the rules.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import * as bcrypt from 'bcrypt-ts';
import type { Kysely } from 'kysely';

import type { DB } from '#/db/types.js';

/** Same rule as bots/create-bot.ts: 1-12 letters or digits. */
const BOT_NAME = /^[a-z0-9]{1,12}$/;
/** E.164: a plus, a country code that doesn't start with 0, 8-15 digits in all. */
const E164 = /^\+[1-9]\d{7,14}$/;

const SESSION_DAYS = 30;
export const PLAYER_COOKIE = 'pvp_player';

export type BotSlot = { username: string; created: string };
export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export function normalizeBotName(name: string): string | null {
    const lower = name.trim().toLowerCase();
    return BOT_NAME.test(lower) ? lower : null;
}

/** "+1 (555) 010-9999" -> "+15550109999", or null if it isn't a full international number. */
export function normalizePhone(input: string): string | null {
    const compact = input.replace(/[\s().-]/g, '');
    return E164.test(compact) ? compact : null;
}

/** Keyed, so a leaked table can't be reversed by hashing every phone number. */
export function phoneHash(e164: string, secret: string): string {
    return createHmac('sha256', secret).update('phone:' + e164).digest('hex');
}

function sessionMac(playerId: number, expires: number, secret: string): string {
    return createHmac('sha256', secret).update(`session:${playerId}.${expires}`).digest('base64url');
}

/** A stateless session cookie value: the player id and expiry, signed. */
export function signSession(playerId: number, secret: string, now: number = Date.now()): string {
    const expires = Math.floor(now / 1000) + SESSION_DAYS * 24 * 60 * 60;
    return `${playerId}.${expires}.${sessionMac(playerId, expires, secret)}`;
}

/** The player id from a session cookie, or null if it's forged, mangled or expired. */
export function readSession(value: string | null | undefined, secret: string, now: number = Date.now()): number | null {
    if (!value || !secret) return null;
    const [id, expires, mac] = value.split('.');
    const playerId = Number(id);
    const expiry = Number(expires);
    if (!Number.isSafeInteger(playerId) || !Number.isSafeInteger(expiry) || !mac) return null;
    if (expiry * 1000 <= now) return null;
    const want = Buffer.from(sessionMac(playerId, expiry, secret));
    const got = Buffer.from(mac);
    return want.length === got.length && timingSafeEqual(want, got) ? playerId : null;
}

export function sessionMaxAgeSeconds(): number {
    return SESSION_DAYS * 24 * 60 * 60;
}

/** API keys are random and long, so a plain SHA-256 is enough to store them. */
export function apiKeyHash(key: string): string {
    return createHash('sha256').update(key).digest('hex');
}

/** Crypto-random letters and digits (unlike bots/create-bot.ts, which used Math.random). */
export function randomPassword(length: number = 16): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = randomBytes(length * 2);
    let out = '';
    for (let i = 0; out.length < length && i < bytes.length; i++) {
        // 248 = 4 * 62: drop the top of the byte range so every character is equally likely
        if (bytes[i]! < 248) out += chars[bytes[i]! % 62];
    }
    return out.length === length ? out : randomPassword(length);
}

async function hashPassword(password: string): Promise<string> {
    if (typeof Bun !== 'undefined' && Bun.password) {
        return Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 });
    }
    return bcrypt.hash(password, 10);
}

async function checkPassword(password: string, hash: string): Promise<boolean> {
    if (typeof Bun !== 'undefined' && Bun.password) {
        try {
            return await Bun.password.verify(password, hash);
        } catch {
            // not a hash Bun understands; fall through
        }
    }
    return bcrypt.compare(password, hash);
}

function dbDate(date: Date = new Date()): string {
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

export default class PlayerAccounts {
    constructor(
        private readonly db: Kysely<DB>,
        readonly season: number,
        readonly botsPerPlayer: number,
        private readonly bannedWords: string[] = []
    ) {}

    /** The player for a verified phone number, created on their first sign-in. */
    async playerForPhone(hash: string): Promise<number> {
        const found = await this.db.selectFrom('player').select('id').where('phone_hash', '=', hash).executeTakeFirst();
        if (found) return found.id;
        try {
            await this.db.insertInto('player').values({ phone_hash: hash, created: dbDate() }).executeTakeFirst();
        } catch {
            // a second tab signed in at the same moment; its row is the one we want
        }
        const row = await this.db.selectFrom('player').select('id').where('phone_hash', '=', hash).executeTakeFirstOrThrow();
        return row.id;
    }

    async playerForApiKey(key: string | null | undefined): Promise<number | null> {
        if (!key) return null;
        const row = await this.db.selectFrom('player').select('id').where('api_key_hash', '=', apiKeyHash(key)).executeTakeFirst();
        return row?.id ?? null;
    }

    /** A new API key for the player, replacing the old one. Only its hash is kept. */
    async newApiKey(playerId: number): Promise<string> {
        const key = 'pvp_' + randomBytes(32).toString('base64url');
        await this.db.updateTable('player').set({ api_key_hash: apiKeyHash(key) }).where('id', '=', playerId).execute();
        return key;
    }

    async bots(playerId: number): Promise<BotSlot[]> {
        const rows = await this.db
            .selectFrom('player_bot')
            .innerJoin('account', 'account.id', 'player_bot.account_id')
            .select(['account.username', 'player_bot.created'])
            .where('player_bot.player_id', '=', playerId)
            .where('player_bot.season', '=', this.season)
            .orderBy('player_bot.id')
            .execute();
        return rows.map(r => ({ username: r.username, created: String(r.created) }));
    }

    /** A brand-new game account in one of the player's slots, with a generated password. */
    async createBot(playerId: number, name: string, ip: string | null): Promise<Result<{ username: string; password: string }>> {
        const username = normalizeBotName(name);
        if (!username) return { ok: false, error: 'Bot names are 1-12 letters or digits.' };
        if (this.bannedWords.some(w => username.includes(w))) return { ok: false, error: 'Pick a different name.' };
        if ((await this.slotsUsed(playerId)) >= this.botsPerPlayer) return this.full();

        const taken = await this.db.selectFrom('account').select('id').where('username', '=', username).executeTakeFirst();
        if (taken) return { ok: false, error: `"${username}" is taken. If it's yours, claim it with its password instead.` };

        const password = randomPassword();
        try {
            await this.db
                .insertInto('account')
                .values({ username, password: await hashPassword(password), registration_ip: ip ?? 'web', registration_date: dbDate() })
                .executeTakeFirst();
        } catch {
            return { ok: false, error: `"${username}" is taken.` };
        }
        const account = await this.db.selectFrom('account').select('id').where('username', '=', username).executeTakeFirstOrThrow();
        const slotted = await this.takeSlot(playerId, account.id);
        if (!slotted.ok) {
            // lost a race for the last slot: the account we just made must not linger unowned
            await this.db.deleteFrom('account').where('id', '=', account.id).execute();
            return slotted;
        }
        return { ok: true, username, password };
    }

    /**
     * Brings an account that existed before fair play into one of the player's slots.
     * Knowing its password is the proof of ownership; it can't be in anyone's slot this season.
     */
    async claimBot(playerId: number, name: string, password: string): Promise<Result<{ username: string }>> {
        const username = normalizeBotName(name);
        const account = username
            ? await this.db.selectFrom('account').select(['id', 'password']).where('username', '=', username).executeTakeFirst()
            : undefined;
        if (!username || !account || !(await checkPassword(password, account.password))) {
            return { ok: false, error: 'Wrong bot name or password.' };
        }
        const owner = await this.slotOwner(account.id);
        if (owner === playerId) return { ok: false, error: `"${username}" is already one of your bots.` };
        if (owner !== null) return { ok: false, error: `"${username}" belongs to another player this season.` };
        if ((await this.slotsUsed(playerId)) >= this.botsPerPlayer) return this.full();
        const slotted = await this.takeSlot(playerId, account.id);
        return slotted.ok ? { ok: true, username } : slotted;
    }

    /** A new generated password for one of the player's own bots. */
    async resetPassword(playerId: number, name: string): Promise<Result<{ username: string; password: string }>> {
        const username = normalizeBotName(name);
        const account = username ? await this.db.selectFrom('account').select('id').where('username', '=', username).executeTakeFirst() : undefined;
        if (!username || !account || (await this.slotOwner(account.id)) !== playerId) {
            return { ok: false, error: 'That isn\'t one of your bots this season.' };
        }
        const password = randomPassword();
        await this.db.updateTable('account').set({ password: await hashPassword(password) }).where('id', '=', account.id).execute();
        return { ok: true, username, password };
    }

    /** Staff always; anyone else only with a slot this season. */
    async mayLogIn(accountId: number, staffmodlevel: number): Promise<boolean> {
        if (staffmodlevel >= 2) return true;
        return (await this.slotOwner(accountId)) !== null;
    }

    private async slotOwner(accountId: number): Promise<number | null> {
        const row = await this.db
            .selectFrom('player_bot')
            .select('player_id')
            .where('account_id', '=', accountId)
            .where('season', '=', this.season)
            .executeTakeFirst();
        return row?.player_id ?? null;
    }

    private async slotsUsed(playerId: number): Promise<number> {
        const row = await this.db
            .selectFrom('player_bot')
            .select(eb => eb.fn.countAll<number>().as('n'))
            .where('player_id', '=', playerId)
            .where('season', '=', this.season)
            .executeTakeFirstOrThrow();
        return Number(row.n);
    }

    /** Inserts the slot, then re-counts: two requests racing for the last slot can't both win. */
    private async takeSlot(playerId: number, accountId: number): Promise<Result<object>> {
        try {
            await this.db.insertInto('player_bot').values({ player_id: playerId, account_id: accountId, season: this.season, created: dbDate() }).executeTakeFirst();
        } catch {
            return { ok: false, error: 'That bot already has an owner this season.' };
        }
        const mine = await this.db
            .selectFrom('player_bot')
            .select('account_id')
            .where('player_id', '=', playerId)
            .where('season', '=', this.season)
            .orderBy('id')
            .execute();
        // Earlier rows keep their slots; only a row past the cap gives its slot back.
        if (mine.findIndex(r => r.account_id === accountId) >= this.botsPerPlayer) {
            await this.db.deleteFrom('player_bot').where('player_id', '=', playerId).where('account_id', '=', accountId).where('season', '=', this.season).execute();
            return this.full();
        }
        return { ok: true };
    }

    private full(): { ok: false; error: string } {
        return { ok: false, error: `You already have ${this.botsPerPlayer} bots this season. Slots don't come back until the next season.` };
    }
}
