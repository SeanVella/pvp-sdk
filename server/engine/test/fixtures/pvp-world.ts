import { expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Runs the compiled pvp-sdk world rules (pvp_world.rs2, dmm_bank_keys.rs2, ~pvp_level_check)
// from the built pack against in-memory players: who can attack whom, where, spawn
// protection, the Deadman guards, bank keys, the teleport lock and the login skull migration.
// The last tests cover the PvP kit's abyssal whip and granite maul (scripts/pvp_kit/).
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
const { ParamHelper } = await import('../../src/cache/config/ParamHelper.js');
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

test('sigils of escape and stone change the teleport lock and damage taken from players', () => {
    World.currentTick = 2000;
    const p = player('sigil_holder', 40, FIELD.x, FIELD.z);
    p.vars[varp('pvp_combat_clock')] = 1995; // hit 5 ticks ago
    expect(run('[proc,pvp_teleport_locked]', p).popInt()).toBe(1);
    p.invAdd(INV, obj('sigil_of_escape'), 1);
    World.currentTick = 2007; // 12 ticks after: past half of the 24-tick lock
    expect(run('[proc,pvp_teleport_locked]', p).popInt()).toBe(0);

    const hp = p.levels[PlayerStat.HITPOINTS];
    run('[queue,pvp_damage]', p, null, [20]);
    expect(p.levels[PlayerStat.HITPOINTS]).toBe(hp - 20);
    p.invAdd(INV, obj('sigil_of_stone'), 1);
    run('[queue,pvp_damage]', p, null, [20]);
    expect(p.levels[PlayerStat.HITPOINTS]).toBe(hp - 20 - 18);
});

test('the breach warden trades points for rewards', () => {
    const p = player('breacher', 10, LUMBRIDGE_SPAWN.x, LUMBRIDGE_SPAWN.z);
    p.vars[varp('breach_points')] = 70;
    run('[proc,breach_buy]', p, null, [8, obj('shark'), 10]);
    expect(stacks(p, INV).get(obj('shark'))).toBe(10);
    expect(p.vars[varp('breach_points')]).toBe(62);
    expect(p.messages).toContain('You spend 8 breach points. You have 62 left.');
});

test('a breach guardian\'s death pays its fighters in points and sigils', () => {
    const big = player('big_hitter', 40, FIELD.x, FIELD.z);
    const small = player('small_hitter', 10, FIELD.x + 1, FIELD.z);
    small.vars[varp('breach_points')] = 5;
    const byHash = new Map([[big.hash64, big], [small.hash64, small]]);
    const original = World.getPlayerByHash64;
    World.getPlayerByHash64 = (hash64: bigint) => byHash.get(hash64) ?? null;
    try {
        const guardian = { baseLevels: [0, 0, 0, 750, 0, 0] } as any;
        World.onBreachGuardianKilled(guardian, [{ hash64: big.hash64, points: 600 }, { hash64: small.hash64, points: 20 }]);
    } finally {
        World.getPlayerByHash64 = original;
    }
    expect(big.vars[varp('breach_points')]).toBe(50);
    expect(small.vars[varp('breach_points')]).toBe(9);
    expect(big.messages).toContain('You earn 50 breach points (50 in all).');
    const sigils = ['sigil_of_fury', 'sigil_of_stone', 'sigil_of_the_feast', 'sigil_of_escape', 'sigil_of_fortune'].map(obj);
    expect([...stacks(big, INV).keys()].some(id => sigils.includes(id))).toBe(true); // the top damage dealer always gets one
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

// The PvP kit: LostCity 377-wip's abyssal whip and granite maul (scripts/pvp_kit/).
const WHIP = 4151;
const MAUL = 4153;
const intParam = (id: number, name: string) => ParamHelper.getIntParam(ParamType.getId(name), ObjType.get(id), -1);

test('the abyssal whip and granite maul load at their 377 ids, with their 377 animations', async () => {
    for (const [id, name] of [[4151, 'abyssal_whip'], [4152, 'cert_abyssal_whip'], [4153, 'granite_maul'], [4154, 'cert_granite_maul']] as const) {
        expect(ObjType.get(id).debugname).toBe(name);
    }
    expect(ObjType.get(4152).certlink).toBe(WHIP);
    expect(ObjType.get(4154).certlink).toBe(MAUL);
    expect(ObjType.get(WHIP).name).toBe('Abyssal whip');
    expect(ObjType.get(MAUL).wearpos2).toBe(5); // two-handed: also takes the shield slot
    expect([intParam(WHIP, 'slashattack'), intParam(WHIP, 'strengthbonus'), intParam(WHIP, 'sa_energy'), intParam(WHIP, 'specwep')]).toEqual([82, 82, 500, 1]);
    expect([intParam(MAUL, 'crushattack'), intParam(MAUL, 'strengthbonus'), intParam(MAUL, 'attackrate'), intParam(MAUL, 'sa_energy')]).toEqual([81, 79, 7, 500]);

    // Animations sit at 377's seq ids and every frame exists in the packed animsets: the
    // player frames re-encoded for 289's skeleton, the special attack graphics' own sets.
    const { default: OnDemand } = await import('../../src/engine/OnDemand.js');
    const { default: FileStream } = await import('../../src/io/FileStream.js');
    const { default: SeqType } = await import('../../src/cache/config/SeqType.js');
    const { default: SpotanimType } = await import('../../src/cache/config/SpotanimType.js');
    const { default: AnimFrame } = await import('../../src/cache/graphics/AnimFrame.js');
    OnDemand.cache = new FileStream(cache, false, true); // read-only: the fixture runs from a temp dir
    SeqType.load(cache);
    SpotanimType.load(cache);
    const seqs = [
        'slayer_abyssal_whip_attack', 'slayer_abyssal_whip_defend', 'slayer_abyssal_whip_walk', 'slayer_abyssal_whip_run',
        'slayer_granite_maul_ready', 'slayer_granite_maul_walk', 'slayer_granite_maul_run', 'slayer_granite_maul_attack',
        'slayer_granite_maul_defend', 'slayer_granite_maul_special_attack', 'slayer_maul_sp_attack', 'slayer_whip_sp_attack'
    ];
    seqs.forEach((name, i) => {
        expect(SeqType.getId(name)).toBe(1658 + i);
        for (const frame of SeqType.get(1658 + i).frames!) expect(AnimFrame.instances[frame]).toBeDefined();
    });
    // durations come from the frames' own delays (in client cycles), as in 377
    expect(SeqType.getByName('slayer_abyssal_whip_attack')!.duration).toBe(39);
    expect(SeqType.getByName('slayer_granite_maul_special_attack')!.duration).toBe(18);
    expect(intParam(WHIP, 'slashattack_anim')).toBe(1658);
    expect(intParam(MAUL, 'ready_baseanim')).toBe(1662);
    expect(intParam(MAUL, 'crushattack_anim')).toBe(1665);
    expect(SpotanimType.getId('sp_attack_maul_spotanim')).toBe(340);
    expect(SpotanimType.getId('sp_attack_abyssal_whip')).toBe(341);
    expect(SpotanimType.get(340).anim).toBe(SeqType.getId('slayer_maul_sp_attack'));
    expect(SpotanimType.get(341).anim).toBe(SeqType.getId('slayer_whip_sp_attack'));
});

const WORN = inv('worn');
const wield = (p: TestPlayer, id: number) => p.invSet(WORN, id, 1, 3); // ^wearpos_rhand
function armSpecial(p: TestPlayer) {
    p.vars[varp('sa_energy')] = 1000;
    p.vars[varp('sa_attack')] = 1;
}
// Damage reaches the target through its queue (~.pvp_damage).
function queuedDamage(p: TestPlayer): number[] {
    const out: number[] = [];
    for (const q of [p.queue, p.weakQueue]) {
        for (let r = q.head(); r; r = q.next()) {
            if (r.script.name === '[queue,pvp_damage]') out.push(r.args[0] as number);
        }
    }
    return out;
}

test("the whip's special moves a tenth of the target's run energy to the attacker", async () => {
    const { default: JavaRandom } = await import('../../src/util/JavaRandom.js');
    World.currentTick = 2000;
    const attacker = player('whipper', 70, FIELD.x, FIELD.z);
    const target = player('drained', 70, FIELD.x + 1, FIELD.z);
    wield(attacker, WHIP);
    armSpecial(attacker);
    // the rolls and max hit are worked out on equip (player_combat_stat.rs2); set them directly
    for (const roll of ['com_stabattack', 'com_slashattack', 'com_crushattack']) attacker.vars[varp(roll)] = 5000;
    target.vars[varp('com_slashdef')] = 100;
    attacker.vars[varp('com_maxhit')] = 20;
    attacker.runenergy = 5000;
    target.runenergy = 10000;
    // pin randominc high: the attack roll then beats the defence roll and hits for the max
    const roll = JavaRandom.nextDouble;
    JavaRandom.nextDouble = () => 0.999;
    try {
        run('[label,pvp_special_attack]', attacker, target);
    } finally {
        JavaRandom.nextDouble = roll;
    }
    expect(attacker.vars[varp('sa_energy')]).toBe(500);
    expect(attacker.vars[varp('sa_attack')]).toBe(0);
    expect(target.runenergy).toBe(9000);
    expect(attacker.runenergy).toBe(6000);
    expect(target.messages).toContain('You feel drained!');
    expect(queuedDamage(target)).toEqual([20]);
    // a PvP hit like any other: it teleport-locks both players
    expect(attacker.vars[varp('pvp_combat_clock')]).toBe(2000);
    expect(target.vars[varp('pvp_combat_clock')]).toBe(2000);
});

test('the granite maul special lands through the attack delay; other specials wait for it', () => {
    World.currentTick = 3000;
    const attacker = player('mauler', 70, FIELD.x, FIELD.z);
    const target = player('smashed', 70, FIELD.x + 1, FIELD.z);

    // the maul's bar only arms mid-fight
    wield(attacker, MAUL);
    attacker.vars[varp('sa_energy')] = 1000;
    run('[if_button,combat_blunt:specbar]', attacker);
    expect(attacker.messages).toContain("You're not fighting anything.");
    expect(attacker.vars[varp('sa_attack')]).toBe(0);

    // mid-fight: the last swing still has 5 ticks of attack delay left
    attacker.vars[varp('action_delay')] = 3005;
    wield(attacker, obj('dragon_mace'));
    armSpecial(attacker);
    run('[label,pvp_special_attack]', attacker, target);
    expect(attacker.vars[varp('sa_energy')]).toBe(1000);
    expect(attacker.vars[varp('sa_attack')]).toBe(1);
    expect(queuedDamage(target)).toEqual([]);

    wield(attacker, MAUL);
    run('[label,pvp_special_attack]', attacker, target);
    expect(attacker.vars[varp('sa_energy')]).toBe(500);
    expect(attacker.vars[varp('sa_attack')]).toBe(0);
    expect(attacker.vars[varp('action_delay')]).toBe(3007);
    expect(queuedDamage(target).length).toBe(1);

    // and again at once with the energy left: the double smash
    run('[if_button,combat_blunt:specbar]', attacker);
    expect(attacker.vars[varp('sa_attack')]).toBe(1);
    run('[label,pvp_special_attack]', attacker, target);
    expect(attacker.vars[varp('sa_energy')]).toBe(0);
    expect(queuedDamage(target).length).toBe(2);
});

test('the whip and the maul come only from breaches, not the Varrock Swordshop', () => {
    const shop = InvType.get(inv('swordshop'));
    expect([...shop.stockobj!]).not.toContain(WHIP);
    expect([...shop.stockobj!]).not.toContain(MAUL);

    // A lucky roll (under 1%) gives a fighter the whip when a breach guardian dies.
    const lucky = player('lucky_hitter', 40, FIELD.x, FIELD.z);
    const original = { random: Math.random, byHash: World.getPlayerByHash64 };
    Math.random = () => 0.005;
    World.getPlayerByHash64 = (hash64: bigint) => (hash64 === lucky.hash64 ? lucky : null);
    try {
        World.onBreachGuardianKilled({ baseLevels: [0, 0, 0, 750, 0, 0] } as any, [{ hash64: lucky.hash64, points: 50 }]);
    } finally {
        Math.random = original.random;
        World.getPlayerByHash64 = original.byHash;
    }
    expect(stacks(lucky, INV).get(WHIP)).toBe(1);
    expect(lucky.messages).toContain('You find an abyssal whip in the breach!');
});

test('an armed special attack still stops at the PvP gate', () => {
    const attacker = player('specced', 70, FIELD.x, FIELD.z);
    const townsfolk = player('townsfolk', 70, VARROCK_SQUARE.x, VARROCK_SQUARE.z);
    for (const weapon of [WHIP, MAUL]) {
        attacker.messages = [];
        wield(attacker, weapon);
        armSpecial(attacker);
        run('[opplayer2,_]', attacker, townsfolk);
        expect(attacker.messages).toEqual(['That player is in a safe area.']);
        expect(attacker.vars[varp('sa_energy')]).toBe(1000);
        expect(queuedDamage(townsfolk)).toEqual([]);
    }
});

// PvP kit: Tele Block (scripts/pvp_kit/scripts/tele_block.rs2).
test('Tele Block is a level 85 spell costing a law, a death and a chaos rune', () => {
    const table = DbTableType.getByName('magic_spell_table')!;
    const row = DbRowType.getByName('magic_spell_tele_block')!;
    const column = (name: string) => row.columnValues[table.columnNames.indexOf(name)];
    expect(column('levelrequired')).toEqual([85]);
    expect(column('runesrequired')).toEqual([obj('lawrune'), 1, obj('deathrune'), 1, obj('chaosrune'), 1]);
    expect(column('experience')).toEqual([800]);
});

test('Tele Block stops every teleport for 5 minutes, half that under Protect from Magic', () => {
    World.currentTick = 5000;
    const caster = player('blocker', 90, FIELD.x, FIELD.z);
    const target = player('runner', 90, FIELD.x + 1, FIELD.z);
    run('[proc,pvp_tele_block_hit]', caster, target);
    expect(target.vars[varp('pvp_tele_block')]).toBe(6000);
    expect(target.vars[varp('pvp_tele_block_ticks')]).toBe(1000);
    expect(target.messages).toContain('A teleport block has been cast on you. It should wear off in 5 minutes.');

    World.currentTick = 5999;
    target.messages = [];
    expect(run('[proc,pre_tele_checks]', target, null, [0]).popInt()).toBe(0);
    expect(target.messages).toContain('A magical force stops you from teleporting.');
    World.currentTick = 6000;
    expect(run('[proc,pre_tele_checks]', target, null, [0]).popInt()).toBe(1);

    const praying = player('praying', 90, FIELD.x + 2, FIELD.z);
    praying.vars[varp('prayer12')] = 1; // Protect from Magic
    run('[proc,pvp_tele_block_hit]', caster, praying);
    expect(praying.vars[varp('pvp_tele_block_ticks')]).toBe(500);
    expect(praying.messages).toContain('A teleport block has been cast on you. It should wear off in 2 minutes 30 seconds.');
});

test("a Tele Blocked player can't be blocked again until it wears off", () => {
    World.currentTick = 7000;
    const caster = player('blocker2', 90, FIELD.x, FIELD.z);
    const target = player('blocked2', 90, FIELD.x + 1, FIELD.z);
    run('[proc,pvp_tele_block_hit]', caster, target);
    caster.messages = [];
    expect(run('[proc,pvp_tele_block_allowed]', caster, target).popInt()).toBe(0);
    expect(caster.messages).toContain('That player is already affected by this spell.');
    World.currentTick = 8000;
    expect(run('[proc,pvp_tele_block_allowed]', caster, target).popInt()).toBe(1);
});

test('a Tele Block lasts through logging out, is capped after a restart, and ends on death', () => {
    World.currentTick = 9000;
    const caster = player('blocker3', 90, FIELD.x, FIELD.z);
    const target = player('blocked3', 90, FIELD.x + 1, FIELD.z);
    run('[proc,pvp_tele_block_hit]', caster, target);

    World.currentTick = 9400;
    run('[proc,pvp_tele_block_login]', target);
    expect(target.vars[varp('pvp_tele_block')]).toBe(10000);
    expect(target.vars[varp('pvp_tele_block_ticks')]).toBe(600);

    // the server restarted: map_clock starts again, and the block is never longer than a full one
    World.currentTick = 50;
    run('[proc,pvp_tele_block_login]', target);
    expect(target.vars[varp('pvp_tele_block')]).toBe(1050);
    expect(target.vars[varp('pvp_tele_block_ticks')]).toBe(1000);

    run('[proc,pvp_tele_block_clear]', target); // what death calls
    expect(target.vars[varp('pvp_tele_block')]).toBe(0);
    expect(run('[proc,pre_tele_checks]', target, null, [0]).popInt()).toBe(1);

    // an expired block is cleared at login
    target.vars[varp('pvp_tele_block')] = 40;
    run('[proc,pvp_tele_block_login]', target);
    expect(target.vars[varp('pvp_tele_block')]).toBe(0);
});

// PvP kit: Ancient Magicks (scripts/pvp_kit/scripts/ancients.rs2).
function spellColumn(spell: string, name: string) {
    const table = DbTableType.getByName('magic_spell_table')!;
    return DbRowType.getByName(`magic_spell_${spell}`)!.columnValues[table.columnNames.indexOf(name)];
}
function queuedArgs(p: TestPlayer, script: string): number[] {
    const out: number[] = [];
    for (const q of [p.queue, p.weakQueue]) {
        for (let r = q.head(); r; r = q.next()) {
            if (r.script.name === script) out.push(r.args[0] as number);
        }
    }
    return out;
}
async function withRolls<T>(roll: number, fn: () => T): Promise<T> {
    const { default: JavaRandom } = await import('../../src/util/JavaRandom.js');
    const original = JavaRandom.nextDouble;
    JavaRandom.nextDouble = () => roll;
    try {
        return fn();
    } finally {
        JavaRandom.nextDouble = original;
    }
}

test('the 16 ancient spells have OSRS levels and max hits, death runes as their fourth rune', () => {
    const spells: Record<string, [number, number]> = {
        smoke_rush: [50, 13], shadow_rush: [52, 14], blood_rush: [56, 15], ice_rush: [58, 16],
        smoke_burst: [62, 17], shadow_burst: [64, 18], blood_burst: [68, 21], ice_burst: [70, 22],
        smoke_blitz: [74, 23], shadow_blitz: [76, 24], blood_blitz: [80, 25], ice_blitz: [82, 26],
        smoke_barrage: [86, 27], shadow_barrage: [88, 28], blood_barrage: [92, 29], ice_barrage: [94, 30]
    };
    for (const [spell, [level, maxhit]] of Object.entries(spells)) {
        expect(spellColumn(spell, 'levelrequired')).toEqual([level]);
        expect(spellColumn(spell, 'maxhit')).toEqual([maxhit]);
        expect(spellColumn(spell, 'extrarune')![0]).toBe(obj('deathrune'));
    }
    expect(spellColumn('smoke_barrage', 'runesrequired')).toEqual([obj('bloodrune'), 2, obj('firerune'), 4, obj('airrune'), 4]);
    expect(spellColumn('smoke_barrage', 'extrarune')).toEqual([obj('deathrune'), 4]);
    expect(spellColumn('smoke_barrage', 'experience')).toEqual([480]);
    expect(['ice_rush', 'ice_burst', 'ice_blitz', 'ice_barrage'].map(s => spellColumn(s, 'freeze_time'))).toEqual([[8], [16], [24], [32]]);
});

test('the Zaros altar swaps spellbooks and turns autocast off; staffs only autocast the normal book', () => {
    const MAGIC_TAB = 6; // ^tab_magic; interface.pack: magic 1151, ancients 40603
    const p = player('zarosian', 60, FIELD.x, FIELD.z);
    p.vars[varp('autocast_spell')] = 5;
    p.vars[varp('attackstyle_magic')] = 3;
    run('[proc,ancient_altar_switch]', p);
    expect(p.vars[varp('pvp_spellbook')]).toBe(1);
    expect(p.tabs[MAGIC_TAB]).toBe(40603);
    expect(p.vars[varp('autocast_spell')]).toBe(-1);
    expect(p.messages).toContain('You feel a strange wisdom fill your mind...');

    run('[label,open_autocast_interface]', p);
    expect(p.messages).toContain("You can't autocast while using Ancient Magicks.");

    run('[proc,pvp_magic_tab]', p); // what login and every tab reset call
    expect(p.tabs[MAGIC_TAB]).toBe(40603);
    run('[proc,ancient_altar_switch]', p);
    expect(p.vars[varp('pvp_spellbook')]).toBe(0);
    expect(p.tabs[MAGIC_TAB]).toBe(1151);
    expect(p.messages).toContain('You feel a strange drain upon your memory...');
});

test('Ice Barrage hits up to 30 and freezes for 32 ticks; Protect from Magic cuts both, and a frozen target only takes the hit', async () => {
    World.currentTick = 11000;
    const caster = player('icer', 99, FIELD.x, FIELD.z);
    caster.vars[varp('com_magicattack')] = 5000;
    const barrage = DbRowType.getId('magic_spell_ice_barrage');
    const hit = (target: TestPlayer) => withRolls(0.999, () => run('[proc,pvp_ancient_hit]', caster, target, [barrage, 0]).popInt());

    const target = player('iced', 99, FIELD.x + 1, FIELD.z);
    expect(await hit(target)).toBe(30);
    expect(queuedDamage(target)).toEqual([30]);
    expect(queuedArgs(target, '[queue,pvp_freeze_player]')).toEqual([32]);

    const praying = player('iced_praying', 99, FIELD.x + 2, FIELD.z);
    praying.vars[varp('prayer12')] = 1; // Protect from Magic
    expect(await hit(praying)).toBe(18);
    expect(queuedArgs(praying, '[queue,pvp_freeze_player]')).toEqual([16]);

    const frozen = player('iced_already', 99, FIELD.x + 3, FIELD.z);
    frozen.vars[varp('frozen')] = 11010;
    expect(await hit(frozen)).toBe(30);
    expect(queuedArgs(frozen, '[queue,pvp_freeze_player]')).toEqual([]);
});

test('smoke poisons, shadow lowers Attack once, and blood heals the caster a quarter of the damage', async () => {
    const caster = player('ancient_effects', 99, FIELD.x, FIELD.z);
    const target = player('ancient_victim', 70, FIELD.x + 1, FIELD.z);
    const effect = (spell: string) => withRolls(0, () => run('[proc,pvp_ancient_effect]', caster, target, [DbRowType.getId(`magic_spell_${spell}`)]));

    await effect('smoke_barrage'); // the 1 in 8 roll (random(8) = 0)
    expect(queuedArgs(target, '[queue,poison_player]')).toEqual([20]);

    await effect('shadow_barrage');
    expect(target.levels[PlayerStat.ATTACK]).toBe(60); // 70 less 15%
    await effect('shadow_rush');
    expect(target.levels[PlayerStat.ATTACK]).toBe(60); // already lowered

    caster.levels[PlayerStat.HITPOINTS] = 50;
    run('[proc,ancient_blood_heal]', caster, null, [120, 29]); // ^blood_barrage
    expect(caster.levels[PlayerStat.HITPOINTS]).toBe(57);
    run('[proc,ancient_blood_heal]', caster, null, [121, 29]); // ^ice_barrage: no heal
    expect(caster.levels[PlayerStat.HITPOINTS]).toBe(57);
});

test('Burst and Barrage splash only onto players the caster could attack, and only in multi-combat', () => {
    const isMulti = World.gameMap.isMulti;
    World.gameMap.isMulti = () => true;
    try {
        const caster = player('burster', 70, FIELD.x, FIELD.z);
        const splash = (target: TestPlayer) => run('[proc,pvp_ancient_extra_target]', caster, target).popInt() === 1;
        const fair = player('splash_fair', 70, FIELD.x + 1, FIELD.z);
        expect(splash(fair)).toBe(true);
        const respawned = player('splash_respawned', 70, FIELD.x + 1, FIELD.z + 1);
        respawned.vars[varp('pvp_protection')] = 1;
        expect(splash(respawned)).toBe(false);
        expect(splash(player('splash_low', 3, FIELD.x, FIELD.z + 1))).toBe(false); // 15+ levels apart
        expect(splash(player('splash_town', 70, VARROCK_SQUARE.x, VARROCK_SQUARE.z))).toBe(false);
        expect(caster.messages).toEqual([]); // silent, unlike the attack checks

        World.gameMap.isMulti = () => false;
        expect(splash(fair)).toBe(false);
    } finally {
        World.gameMap.isMulti = isMulti;
    }
});
