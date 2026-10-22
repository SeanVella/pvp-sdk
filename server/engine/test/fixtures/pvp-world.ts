import { expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Runs the compiled pvp-sdk world rules (pvp_world.rs2, dmm_bank_keys.rs2, ~pvp_level_check)
// from the built pack against in-memory players: who can attack whom, where, spawn
// protection, the Deadman guards, bank keys, the teleport lock and the login skull migration.
const output = process.env.PVP_WORLD_TEST_OUTPUT!;
const cache = resolve('data/pack');

mkdirSync(`${output}/data/config`, { recursive: true });
copyFileSync(resolve('data/config/private.pem'), `${output}/data/config/private.pem`);
process.chdir(output);
class TestWorker extends EventEmitter { postMessage() {} }
mock.module('worker_threads', () => ({ Worker: TestWorker }));
const { default: World } = await import('../../src/engine/World.js');
const { default: VarPlayerType } = await import('../../src/cache/config/VarPlayerType.js');
const { default: VarBitType } = await import('../../src/cache/config/VarBitType.js');
const { default: ParamType } = await import('../../src/cache/config/ParamType.js');
const { default: ObjType } = await import('../../src/cache/config/ObjType.js');
const { default: InvType } = await import('../../src/cache/config/InvType.js');
const { default: EnumType } = await import('../../src/cache/config/EnumType.js');
const { default: StructType } = await import('../../src/cache/config/StructType.js');
const { default: CategoryType } = await import('../../src/cache/config/CategoryType.js');
const { default: DbTableType } = await import('../../src/cache/config/DbTableType.js');
const { default: DbRowType } = await import('../../src/cache/config/DbRowType.js');
const { default: DbTableIndex } = await import('../../src/cache/config/DbTableIndex.js');
const { default: ScriptProvider } = await import('../../src/engine/script/ScriptProvider.js');
const { default: ScriptRunner } = await import('../../src/engine/script/ScriptRunner.js');
const { default: ScriptState } = await import('../../src/engine/script/ScriptState.js');
const { default: ScriptPointer } = await import('../../src/engine/script/ScriptPointer.js');
const { NetworkPlayer } = await import('../../src/engine/entity/NetworkPlayer.js');
const { PlayerLoading } = await import('../../src/engine/entity/PlayerLoading.js');
const { default: Packet } = await import('../../src/io/Packet.js');
const { default: Obj } = await import('../../src/engine/entity/Obj.js');
const { PlayerStat } = await import('../../src/engine/entity/PlayerStat.js');
const { default: NullClientSocket } = await import('../../src/server/NullClientSocket.js');
// Not SeqType: it needs the packed client cache, and none of these scripts animate.
for (const type of [VarPlayerType, VarBitType, ParamType, ObjType, InvType, EnumType, StructType, CategoryType, DbTableType, DbRowType]) {
    type.load(cache);
}
DbTableIndex.init();
expect(ScriptProvider.load(cache)).toBeGreaterThan(0);

type TestPlayer = InstanceType<typeof NetworkPlayer> & { messages: string[] };
const varp = (name: string) => VarPlayerType.getId(name);
const inv = (name: string) => InvType.getId(name);
const obj = (name: string) => ObjType.getId(name);
const BANK = inv('bank');
const INV = inv('inv');
const KEY = obj('dmm_bank_key');

// Scripts reach players by uid (damage) and drop loot through World.addObj; serve both
// from the test's own players instead of a running world.
const players: TestPlayer[] = [];
const drops: { obj: number; count: number; receiver: bigint }[] = [];
World.getPlayerByUid = (uid: number) => players.find(p => p.uid === uid) ?? null;
World.addObj = (o: { type: number; count: number }, receiver64: bigint) => void drops.push({ obj: o.type, count: o.count, receiver: receiver64 });

// Every melee stat (and hitpoints) at `stats` gives combat level floor(1.15 * stats).
function player(name: string, stats: number, x: number, z: number, level = 0): TestPlayer {
    const n = players.length + 1;
    const p = new NetworkPlayer(name, BigInt(n), BigInt(n), new NullClientSocket()) as TestPlayer;
    for (const stat of [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.HITPOINTS]) {
        p.baseLevels[stat] = stats;
        p.levels[stat] = stats;
    }
    p.uid = 1000 + n;
    p.x = x;
    p.z = z;
    p.level = level;
    p.messages = [];
    p.messageGame = (msg: string) => void p.messages.push(msg);
    players.push(p);
    return p;
}

function run(name: string, self: TestPlayer, target: TestPlayer | null = null, args: (number | string)[] = []): ScriptState {
    const script = ScriptProvider.getByName(name);
    expect(script).toBeDefined();
    const state = ScriptRunner.init(script!, self, target, args);
    state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
    if (target) state.pointerAdd(ScriptPointer.ProtectedActivePlayer2);
    expect(ScriptRunner.execute(state)).toBe(ScriptState.FINISHED);
    return state;
}

function attack(attacker: TestPlayer, target: TestPlayer): { allowed: boolean; messages: string[] } {
    attacker.messages = [];
    const allowed = run('[proc,pvp_level_check]', attacker, target).popInt() === 1;
    return { allowed, messages: attacker.messages };
}

function stacks(p: TestPlayer, invId: number): Map<number, number> {
    const out = new Map<number, number>();
    for (let slot = 0; slot < p.invSize(invId); slot++) {
        const item = p.invGetSlot(invId, slot);
        if (item) out.set(item.id, (out.get(item.id) ?? 0) + item.count);
    }
    return out;
}

// Open ground east of Lumbridge (past the river): no town, bank or wilderness.
const FIELD = { x: 3255, z: 3275 };
const LUMBRIDGE_SPAWN = { x: 3221, z: 3218 };
const VARROCK_SQUARE = { x: 3212, z: 3428 };
const VARROCK_WEST_BANK = { x: 3185, z: 3440 };
const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const DRAYNOR_BANK = { x: 3092, z: 3243 };
const TUTORIAL_ISLAND = { x: 3094, z: 3106 };
const DUEL_ARENA_LOBBY = { x: 3360, z: 3270 };
// Wilderness level n starts at z = 3520 + (n - 1) * 8.
const wilderness = (lvl: number) => ({ x: 3100, z: 3520 + (lvl - 1) * 8 });

test('everyone outside safe areas can fight within 15 combat levels', () => {
    const low = player('low', 3, FIELD.x, FIELD.z); // combat 3
    expect(attack(low, player('peer', 3, FIELD.x + 1, FIELD.z)).allowed).toBe(true);
    expect(attack(low, player('gap15', 16, FIELD.x + 1, FIELD.z)).allowed).toBe(true); // combat 18
    const tooHigh = attack(low, player('gap16', 17, FIELD.x + 1, FIELD.z)); // combat 19
    expect(tooHigh.allowed).toBe(false);
    expect(tooHigh.messages).toEqual(['Your level difference is too great!', "Outside the wilderness the level gap can't exceed 15."]);
});

test('each wilderness level widens the range by one', () => {
    const low = player('low', 3, wilderness(10).x, wilderness(10).z); // combat 3
    const high = player('high', 40, wilderness(10).x + 1, wilderness(10).z); // combat 46, gap 43
    const shallow = attack(low, high);
    expect(shallow.allowed).toBe(false);
    expect(shallow.messages).toEqual(['Your level difference is too great!', 'You need to move deeper into the wilderness.']);
    for (const p of [low, high]) p.z = wilderness(28).z; // 15 + 28 = 43
    expect(attack(low, high).allowed).toBe(true);
    expect(attack(high, low).allowed).toBe(true);
    // The shallower of the two players sets the range.
    high.z = FIELD.z;
    high.x = FIELD.x;
    expect(attack(low, high).allowed).toBe(false);
});

test('nobody fights in or out of the guarded towns and other safe areas', () => {
    for (const safe of [LUMBRIDGE_SPAWN, VARROCK_SQUARE, VARROCK_WEST_BANK, TUTORIAL_ISLAND, DUEL_ARENA_LOBBY]) {
        const inside = player('inside', 10, safe.x, safe.z);
        const outside = player('outside', 10, FIELD.x, FIELD.z);
        const into = attack(outside, inside);
        expect(into.allowed).toBe(false);
        expect(into.messages).toEqual(['That player is in a safe area.']);
        const outOf = attack(inside, outside);
        expect(outOf.allowed).toBe(false);
        expect(outOf.messages).toEqual(["You can't attack other players from a safe area."]);
    }
    // Banks outside the guarded towns are fair game, as in Deadman.
    for (const bank of [EDGEVILLE_BANK, DRAYNOR_BANK]) {
        expect(attack(player('a', 10, bank.x, bank.z), player('b', 10, bank.x + 1, bank.z)).allowed).toBe(true);
    }
});

test('spawn protection blocks attacks until it ends or the protected player attacks', () => {
    const attacker = player('attacker', 10, FIELD.x, FIELD.z);
    const respawned = player('respawned', 10, FIELD.x + 1, FIELD.z);
    run('[proc,pvp_protection_start]', respawned);
    expect(respawned.vars[varp('pvp_protection')]).toBe(1);
    const blocked = attack(attacker, respawned);
    expect(blocked.allowed).toBe(false);
    expect(blocked.messages).toEqual(['That player has just respawned and is protected.']);

    // The protected player may still attack; doing so (set_pk_vars) ends the protection.
    expect(attack(respawned, attacker).allowed).toBe(true);
    run('[proc,set_pk_vars]', respawned, attacker);
    expect(respawned.vars[varp('pvp_protection')]).toBe(0);
    expect(respawned.messages).toContain('You are no longer protected from other players.');
    expect(attack(attacker, respawned).allowed).toBe(true);
});

test('a new account is protected for its first hours of play; an old one never is', () => {
    const fresh = player('fresh_acct', 10, FIELD.x, FIELD.z);
    fresh.playtime = 0;
    run('[proc,pvp_newbie_login]', fresh);
    expect(fresh.vars[varp('pvp_newbie')]).toBe(1);
    expect(fresh.messages[0]).toBe('You are protected from other players for 180 more minutes of play.');

    const attacker = player('attacker', 10, FIELD.x + 1, FIELD.z);
    const refused = attack(attacker, fresh);
    expect(refused.allowed).toBe(false);
    expect(refused.messages).toEqual(['That player is new and protected for now.']);

    // An account that has already played is never protected, even at low playtime.
    const veteran = player('veteran', 10, FIELD.x, FIELD.z);
    veteran.playtime = 5000;
    run('[proc,pvp_newbie_login]', veteran);
    expect(veteran.vars[varp('pvp_newbie')]).toBe(0);
    expect(attack(attacker, veteran).allowed).toBe(true);

    // Three hours of play (36000 ticks at 300ms) later, the protection wears off.
    fresh.playtime = 36000;
    expect(attack(attacker, fresh).allowed).toBe(true);
    run('[softtimer,pvp_newbie_check]', fresh);
    expect(fresh.vars[varp('pvp_newbie')]).toBe(0);
    expect(fresh.messages).toContain('Your new-player protection has worn off.');
});

test('attacking someone gives up new-player protection', () => {
    const fresh = player('eager', 10, FIELD.x, FIELD.z);
    fresh.playtime = 0;
    run('[proc,pvp_newbie_login]', fresh);
    const target = player('target', 10, FIELD.x + 1, FIELD.z);
    expect(attack(fresh, target).allowed).toBe(true);
    run('[proc,set_pk_vars]', fresh, target);
    expect(fresh.vars[varp('pvp_newbie')]).toBe(0);
    expect(fresh.messages).toContain('You have given up your new-player protection by attacking.');
    expect(attack(target, fresh).allowed).toBe(true);
});

test('guards shoot a skulled player in a safe area harder every hit, and only there', () => {
    const p = player('skulled', 40, VARROCK_SQUARE.x, VARROCK_SQUARE.z); // 40 hitpoints
    p.vars[varp('pk_skull')] = 2000;
    run('[softtimer,dmm_guard_check]', p);
    expect(p.levels[PlayerStat.HITPOINTS]).toBe(32); // 40 / 5
    expect(p.messages).toContain('The guards attack you for bringing a skull into a safe area!');
    run('[softtimer,dmm_guard_check]', p);
    expect(p.levels[PlayerStat.HITPOINTS]).toBe(22); // 8 + 2
    p.x = FIELD.x;
    p.z = FIELD.z;
    run('[softtimer,dmm_guard_check]', p);
    expect(p.levels[PlayerStat.HITPOINTS]).toBe(22);
    expect(p.vars[varp('dmm_guard_hits')]).toBe(0);
});

test('the client skull countdown is written with the skull and resynced every 50 ticks', () => {
    World.currentTick = 5000;
    const p = player('countdown', 10, FIELD.x, FIELD.z);
    run('[proc,pk_skull]', p, null, [2000]);
    expect(p.vars[varp('pvp_skull_ticks')]).toBe(2000);
    World.currentTick = 5040; // 40 ticks on: the client's own count is still close enough
    run('[softtimer,dmm_guard_check]', p);
    expect(p.vars[varp('pvp_skull_ticks')]).toBe(2000);
    World.currentTick = 5050;
    run('[softtimer,dmm_guard_check]', p);
    expect(p.vars[varp('pvp_skull_ticks')]).toBe(1950);
    run('[proc,clear_pk_skull]', p);
    expect(p.vars[varp('pvp_skull_ticks')]).toBe(0);
});

test('a skull from before the safe zones last grew is cleared once at login', () => {
    const fresh = player('fresh', 10, FIELD.x, FIELD.z);
    run('[proc,dmm_rules_login]', fresh);
    const version = fresh.vars[varp('dmm_rules_version')];
    expect(version).toBeGreaterThan(0);
    expect(fresh.messages).toEqual([]);
    const old = player('old', 10, LUMBRIDGE_SPAWN.x, LUMBRIDGE_SPAWN.z);
    old.vars[varp('pk_skull')] = 1500; // ticks left, as saved at logout
    run('[proc,dmm_rules_login]', old);
    expect(old.vars[varp('pk_skull')]).toBe(0);
    expect(old.vars[varp('dmm_rules_version')]).toBe(version);
    expect(old.messages).toEqual(['The safe zones have changed since you logged out, so your skull has been removed.']);
    // Under the current rules the skull stays, and the guards will see it.
    const current = player('current', 10, LUMBRIDGE_SPAWN.x, LUMBRIDGE_SPAWN.z);
    current.vars[varp('dmm_rules_version')] = version;
    current.vars[varp('pk_skull')] = 1500;
    run('[proc,dmm_rules_login]', current);
    expect(current.vars[varp('pk_skull')]).toBe(1500);
    expect(current.messages).toEqual([]);
});

test('the rules version is saved, so logging out and back in keeps a current skull', () => {
    const p = player('relog', 10, LUMBRIDGE_SPAWN.x, LUMBRIDGE_SPAWN.z);
    run('[proc,dmm_rules_login]', p);
    p.vars[varp('pk_skull')] = 1500;
    const back = PlayerLoading.load('relog', new Packet(p.save(false)), new NullClientSocket()) as TestPlayer;
    back.messages = [];
    back.messageGame = (msg: string) => void back.messages.push(msg);
    expect(back.vars[varp('dmm_rules_version')]).toBe(p.vars[varp('dmm_rules_version')]);
    run('[proc,dmm_rules_login]', back);
    expect(back.vars[varp('pk_skull')]).toBe(1500);
    expect(back.messages).toEqual([]);
});

test('a PvP hit teleport-locks both players for 24 ticks', () => {
    World.currentTick = 1000;
    const attacker = player('attacker', 10, FIELD.x, FIELD.z);
    const target = player('target', 10, FIELD.x + 1, FIELD.z);
    run('[proc,set_pk_vars]', attacker, target);
    expect(attacker.vars[varp('pvp_combat_clock')]).toBe(1000);
    expect(target.vars[varp('pvp_combat_clock')]).toBe(1000);
    World.currentTick = 1023;
    expect(run('[proc,pre_tele_checks]', target, null, [0]).popInt()).toBe(0);
    expect(target.messages).toContain("You can't teleport so soon after fighting another player.");
    World.currentTick = 1024;
    expect(run('[proc,pre_tele_checks]', target, null, [0]).popInt()).toBe(1);
});

test('dying skulled raids your 10 most valuable tradeable bank stacks into a key for the killer', () => {
    const victim = player('victim', 10, FIELD.x, FIELD.z);
    const killer = player('killer', 10, FIELD.x + 1, FIELD.z);
    const bank: [string, number][] = [
        ['coins', 50000], ['dragon_longsword', 1], ['rune_platebody', 1], ['rune_platelegs', 1], ['rune_full_helm', 1],
        ['rune_scimitar', 1], ['adamant_platebody', 1], ['shark', 100], ['lobster', 100], ['swordfish', 20],
        ['coal', 50], ['iron_ore', 100], ['logs', 100], ['thgoodminekey', 10000000]
    ];
    for (const [name, count] of bank) victim.invAdd(BANK, obj(name), count);
    const byValue = bank
        .filter(([name]) => ObjType.get(obj(name)).tradeable)
        .sort((a, b) => ObjType.get(obj(b[0])).cost * b[1] - ObjType.get(obj(a[0])).cost * a[1]);
    const raided = byValue.slice(0, 10).map(([name]) => obj(name));

    run('[proc,dmm_death_to_player]', victim, killer, [1]);
    const key = stacks(killer, inv('dmm_key_1'));
    expect([...key.keys()].sort()).toEqual([...raided].sort());
    const left = stacks(victim, BANK);
    for (const id of raided) expect(left.has(id)).toBe(false);
    for (const name of ['coal', 'iron_ore', 'logs', 'thgoodminekey']) expect(left.has(obj(name))).toBe(true);

    // The killer gets the key token and its message at once, not through a queue that
    // waits for them to close a dialog.
    expect(stacks(killer, INV).get(KEY)).toBe(1);
    expect(killer.messages).toContain('You take a bank key from your victim.');

    // Keys only open unskulled, in a safe area; the stacks then go to the bank.
    killer.vars[varp('pk_skull')] = 2000;
    run('[opheld1,dmm_bank_key]', killer);
    expect(killer.messages).toContain("You can't open a bank key while you're skulled.");
    killer.vars[varp('pk_skull')] = 0;
    run('[opheld1,dmm_bank_key]', killer);
    expect(killer.messages).toContain('Bank keys can only be opened in a safe area.');
    killer.x = VARROCK_SQUARE.x;
    killer.z = VARROCK_SQUARE.z;
    run('[opheld1,dmm_bank_key]', killer);
    expect(killer.messages).toContain('You open the bank key: 10 stacks go to your bank.');
    const banked = stacks(killer, BANK);
    for (const id of raided) expect(banked.has(id)).toBe(true);
    expect(stacks(killer, inv('dmm_key_1')).size).toBe(0);
    expect(stacks(killer, INV).get(KEY) ?? 0).toBe(0);
});

test('the safe deposit box keeps ten stacks out of a bank raid', () => {
    const SAFE = inv('dmm_safe_box');
    const p = player('saver', 10, VARROCK_SQUARE.x, VARROCK_SQUARE.z);
    p.invAdd(INV, obj('rune_platebody'), 1);
    p.invAdd(INV, obj('coins'), 5000);
    p.invAdd(INV, KEY, 1);

    run('[label,dmm_safe_box_store]', p, null, [0, 1]);
    run('[label,dmm_safe_box_store]', p, null, [1, 2147483647]);
    expect(stacks(p, SAFE)).toEqual(new Map([[obj('rune_platebody'), 1], [obj('coins'), 5000]]));
    expect(stacks(p, INV).has(obj('rune_platebody'))).toBe(false);

    // Bank keys stand for keys held elsewhere, so they can't go in.
    p.messages = [];
    run('[label,dmm_safe_box_store]', p, null, [2, 1]);
    expect(p.messages).toEqual(["That can't go in your safe deposit box."]);
    expect(stacks(p, INV).get(KEY)).toBe(1);

    // A skulled death's raid takes the bank's best stacks and never the box.
    p.invAdd(BANK, obj('dragon_longsword'), 1);
    const killer = player('raider', 10, FIELD.x + 1, FIELD.z);
    run('[proc,dmm_death_to_player]', p, killer, [1]);
    expect(stacks(killer, inv('dmm_key_1')).get(obj('dragon_longsword'))).toBe(1);
    expect(stacks(p, SAFE).get(obj('rune_platebody'))).toBe(1);
    expect(stacks(p, SAFE).get(obj('coins'))).toBe(5000);

    // Withdrawing gives back what fits.
    run('[label,dmm_safe_box_withdraw]', p, null, [1, 1000]);
    expect(stacks(p, SAFE).get(obj('coins'))).toBe(4000);
    expect(stacks(p, INV).get(obj('coins'))).toBe(1000);
});

test('an unskulled victim keeps their bank but loses carried keys to the killer', () => {
    const holder = player('holder', 10, FIELD.x, FIELD.z);
    const killer = player('killer', 10, FIELD.x + 1, FIELD.z);
    holder.invAdd(inv('dmm_key_3'), obj('rune_platebody'), 1);
    holder.invAdd(BANK, obj('dragon_longsword'), 1);
    run('[proc,dmm_death_to_player]', holder, killer, [0]);
    expect(stacks(killer, inv('dmm_key_1')).get(obj('rune_platebody'))).toBe(1);
    expect(stacks(killer, INV).get(KEY)).toBe(1);
    expect(killer.messages).toContain('You take a bank key from your victim.');
    expect(stacks(holder, INV).get(KEY) ?? 0).toBe(0);
    expect(stacks(holder, inv('dmm_key_3')).size).toBe(0);
    expect(stacks(holder, BANK).get(obj('dragon_longsword'))).toBe(1);
});

test('a killer with five keys gets the overflow dropped for them instead', () => {
    const victim = player('victim', 10, FIELD.x, FIELD.z);
    const killer = player('killer', 10, FIELD.x + 1, FIELD.z);
    for (let k = 1; k <= 5; k++) killer.invAdd(inv(`dmm_key_${k}`), obj('coins'), k);
    victim.invAdd(BANK, obj('rune_scimitar'), 1);
    drops.length = 0;
    run('[proc,dmm_death_to_player]', victim, killer, [1]);
    expect(drops).toEqual([{ obj: obj('rune_scimitar'), count: 1, receiver: killer.hash64 }]);
});

test('dying to an npc destroys carried keys, and a skulled one drops the raided stacks for anyone', () => {
    const p = player('npcdeath', 10, FIELD.x, FIELD.z);
    p.invAdd(inv('dmm_key_2'), obj('rune_platebody'), 1);
    p.invAdd(BANK, obj('rune_full_helm'), 1);
    drops.length = 0;
    run('[proc,dmm_death_to_npc]', p, null, [1]);
    expect(stacks(p, inv('dmm_key_2')).size).toBe(0);
    expect(stacks(p, BANK).has(obj('rune_full_helm'))).toBe(false);
    expect(drops).toEqual([{ obj: obj('rune_full_helm'), count: 1, receiver: Obj.NO_RECEIVER }]);
});
