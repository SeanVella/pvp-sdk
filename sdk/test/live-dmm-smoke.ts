#!/usr/bin/env bun
/**
 * Post-deploy smoke test of the Deadman rules, on the live server by default.
 *
 *   E2E_BOTS=alpha,bravo bun sdk/test/live-dmm-smoke.ts
 *
 * Needs two of your own bots (`bun bots/create-bot.ts <name>`, add `--local` for a local
 * stack), each with a lite runner connected (`cd server/webclient && bun src/lite/runner.ts
 * <name>`). alpha needs something in its bank: a fresh account has 25 coins from the
 * tutorial. E2E_GATEWAY overrides the gateway URL (ws://localhost:7780 for a local stack).
 *
 * 1. Two bots in Lumbridge can't fight (town safe zone).
 * 2. North of Lumbridge's zone (z > 3260) alpha attacks bravo and is skulled, which both
 *    bots' state shows; bravo fights back until alpha is 2 below full, so bravo is the
 *    killer of record, and stays unskulled.
 * 3. alpha walks into Lumbridge and the guards shoot him dead; he keeps nothing and
 *    respawns unskulled.
 * 4. bravo receives a bank key raided from alpha's bank, checks it and opens it in town.
 *
 * alpha dies and loses its top 10 bank stacks to bravo: use test accounts only. Brand-new
 * accounts get 3 hours of new-player protection, which refuses step 2: use bots that
 * have played longer, or that first logged in before the protection was deployed.
 * Both bots run from one machine, so their kill is stored but not counted (same_ip).
 * `walkTo` may log PATHFINDING FAILED for the field tiles; the bots stop a tile or two
 * away, which is fine.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BotSDK } from '../index';
import { BotActions } from '../actions';

const GATEWAY = process.env.E2E_GATEWAY ?? 'wss://pvp-sdk.fly.dev/gateway';
if (!process.env.E2E_BOTS) throw new Error('Set E2E_BOTS=alpha,bravo (two of your own bots)');
const [ALPHA, BRAVO] = process.env.E2E_BOTS.split(',') as [string, string];

function env(name: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of readFileSync(join(import.meta.dir, '..', '..', 'bots', name, 'bot.env'), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m) out[m[1]!] = m[2]!;
    }
    return out;
}
async function connect(name: string) {
    const e = env(name);
    const sdk = new BotSDK({ botUsername: e.BOT_USERNAME!, password: e.PASSWORD, gatewayUrl: GATEWAY, autoLaunchBrowser: false, showChat: true });
    await sdk.connect();
    return { name, sdk, bot: new BotActions(sdk) };
}
type Bot = Awaited<ReturnType<typeof connect>>;
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
const pos = (b: Bot) => { const p = b.sdk.getState()?.player; return `(${p?.worldX}, ${p?.worldZ})`; };
const hp = (b: Bot) => b.sdk.getSkill('Hitpoints');
const tick = (b: Bot) => b.sdk.getState()?.tick ?? 0;
const skulled = (b: Bot) => b.sdk.getState()?.isSkulled;
const seen = (viewer: Bot, name: string) => viewer.sdk.getNearbyPlayers().find(p => p.name.toLowerCase() === name.toLowerCase());
// gameMessages[].tick counts from each client's login, so only compare ticks within one bot.
const messagesSince = (b: Bot, t: number): string[] => (b.sdk.getState()?.gameMessages ?? []).filter(m => m.tick > t).map(m => m.text);
const named = (n: string) => new RegExp(`^${n}$`, 'i');
async function waitFor(pred: () => boolean, ms: number) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (pred()) return true;
        await sleep(250);
    }
    return pred();
}
let failures = 0;
function check(label: string, ok: boolean, detail = '') {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
}

const alpha = await connect(ALPHA);
const bravo = await connect(BRAVO);
for (const b of [alpha, bravo]) {
    const p = b.sdk.getState()?.player;
    if (p && p.worldX >= 3053 && p.worldX <= 3156 && p.worldZ >= 3056 && p.worldZ <= 3136) await b.bot.skipTutorial();
    console.log(`${b.name} at ${pos(b)} hp ${hp(b)?.level}/${hp(b)?.baseLevel} combat ${b.sdk.getState()?.player?.combatLevel}, carrying ${b.sdk.getInventory().length} items`);
}

// 1. Lumbridge is a guarded town: nobody can attack inside it.
await Promise.all([alpha.bot.walkTo(3222, 3220, 1), bravo.bot.walkTo(3223, 3220, 1)]);
let r = await alpha.bot.attack(named(BRAVO), 4000);
check('attack inside Lumbridge is refused', !r.success && r.reason === 'not_attackable', `${r.reason}: ${r.message}`);

// 2. North of the town zone the attack lands and skulls alpha; bravo fights back.
await Promise.all([alpha.bot.walkTo(3229, 3272, 1), bravo.bot.walkTo(3230, 3272, 1)]);
console.log(`field: alpha ${pos(alpha)} bravo ${pos(bravo)}`);
check('nobody is skulled before the fight', skulled(alpha) === false && skulled(bravo) === false,
    `alpha ${skulled(alpha)}, bravo ${skulled(bravo)}`);
const t1 = tick(alpha);
r = await alpha.bot.attack(named(BRAVO), 8000);
check('alpha attacks bravo north of Lumbridge', r.success, `${r.reason ?? ''} ${r.message ?? ''}`);
check('alpha sees his own skull', await waitFor(() => skulled(alpha) === true, 5000), `isSkulled ${skulled(alpha)}`);
check('bravo sees alpha skulled', await waitFor(() => seen(bravo, ALPHA)?.isSkulled === true, 5000), JSON.stringify(seen(bravo, ALPHA)));
await bravo.bot.attack(named(ALPHA), 6000);
// The engine forgets who damaged a player once they're back at full health, so take alpha
// 2 below full: one regen tick on the walk into town can't wipe bravo's credit.
const hurt = await waitFor(() => (hp(alpha)?.level ?? 0) <= (hp(alpha)?.baseLevel ?? 0) - 2, 120_000);
check('bravo hits alpha for 2+ (so he is credited with the kill)', hurt, `alpha hp ${hp(alpha)?.level}/${hp(alpha)?.baseLevel}`);
check('bravo, who only fought back, is not skulled', skulled(bravo) === false, `isSkulled ${skulled(bravo)}`);
const carried = alpha.sdk.getInventory().length + alpha.sdk.getEquipment().length;

// 3. alpha runs into Lumbridge with his skull: the guards shoot him until he dies.
void alpha.bot.walkTo(3222, 3240, 1).catch(() => undefined);
const died = await waitFor(() => messagesSince(alpha, t1).some(m => m.includes('Oh dear you are dead')), 60_000);
const alphaMsgs = messagesSince(alpha, t1);
check('the guards attack the skulled player in town', alphaMsgs.some(m => m.includes('The guards attack you for bringing a skull into a safe area!')), alphaMsgs.slice(-6).join(' | '));
check('the guards kill him', died);
await sleep(3000);
if (carried === 0) console.log('note: alpha carried nothing, so the next check proves little');
check('alpha respawns with nothing (no kept items)', alpha.sdk.getInventory().length === 0 && alpha.sdk.getEquipment().length === 0,
    `inv ${alpha.sdk.getInventory().map(i => i.name).join(', ')} | worn ${alpha.sdk.getEquipment().map(i => i.name).join(', ')}`);
check('alpha respawns at full health', hp(alpha)?.level === hp(alpha)?.baseLevel, `${hp(alpha)?.level}/${hp(alpha)?.baseLevel} at ${pos(alpha)}`);
check('alpha respawns unskulled', await waitFor(() => skulled(alpha) === false, 5000), `isSkulled ${skulled(alpha)}`);

// 4. bravo gets a key raided from alpha's bank and opens it in town.
const gotKey = await waitFor(() => messagesSince(bravo, t1).some(m => m.includes('bank key')) && !!bravo.sdk.findInventoryItem(/^bank key$/i), 20_000);
check('bravo receives a bank key', gotKey, messagesSince(bravo, t1).slice(-5).join(' | '));
if (gotKey) {
    await bravo.bot.dismissBlockingUI();
    await bravo.bot.walkTo(3222, 3240, 1);
    const t4 = tick(bravo);
    let key = bravo.sdk.findInventoryItem(/^bank key$/i)!;
    await bravo.sdk.sendUseItem(key.slot, 2);
    const checked = await waitFor(() => messagesSince(bravo, t4).some(m => m.startsWith('Bank key 1:')), 10_000);
    check('Check lists the raided stacks', checked, messagesSince(bravo, t4).join(' | '));
    key = bravo.sdk.findInventoryItem(/^bank key$/i)!;
    await bravo.sdk.sendUseItem(key.slot, 1);
    const opened = await waitFor(() => messagesSince(bravo, t4).some(m => m.startsWith('You open the bank key')), 10_000);
    check('Open sends the stacks to the bank', opened, messagesSince(bravo, t4).join(' | '));
    check('the key is used up', await waitFor(() => !bravo.sdk.findInventoryItem(/^bank key$/i), 5000));
}

console.log(failures === 0 ? 'ALL LIVE DEADMAN CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
