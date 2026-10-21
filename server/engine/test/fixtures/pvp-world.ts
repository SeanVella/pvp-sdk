import { expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Runs the compiled pvp-sdk world rules (pvp_world.rs2, ~pvp_level_check) from the built
// pack against in-memory players: who can attack whom, where, and spawn protection.
const output = process.env.PVP_WORLD_TEST_OUTPUT!;
const cache = resolve('data/pack');

mkdirSync(`${output}/data/config`, { recursive: true });
copyFileSync(resolve('data/config/private.pem'), `${output}/data/config/private.pem`);
process.chdir(output);
class TestWorker extends EventEmitter { postMessage() {} }
mock.module('worker_threads', () => ({ Worker: TestWorker }));
await import('../../src/engine/World.js');
const { default: VarPlayerType } = await import('../../src/cache/config/VarPlayerType.js');
const { default: DbTableType } = await import('../../src/cache/config/DbTableType.js');
const { default: DbRowType } = await import('../../src/cache/config/DbRowType.js');
const { default: DbTableIndex } = await import('../../src/cache/config/DbTableIndex.js');
const { default: ScriptProvider } = await import('../../src/engine/script/ScriptProvider.js');
const { default: ScriptRunner } = await import('../../src/engine/script/ScriptRunner.js');
const { default: ScriptState } = await import('../../src/engine/script/ScriptState.js');
const { default: ScriptPointer } = await import('../../src/engine/script/ScriptPointer.js');
const { NetworkPlayer } = await import('../../src/engine/entity/NetworkPlayer.js');
const { PlayerStat } = await import('../../src/engine/entity/PlayerStat.js');
const { default: NullClientSocket } = await import('../../src/server/NullClientSocket.js');
VarPlayerType.load(cache);
DbTableType.load(cache);
DbRowType.load(cache);
DbTableIndex.init();
expect(ScriptProvider.load(cache)).toBeGreaterThan(0);

type TestPlayer = InstanceType<typeof NetworkPlayer> & { messages: string[] };
const protection = VarPlayerType.getId('pvp_protection');

// Every melee stat (and hitpoints) at `stats` gives combat level floor(1.15 * stats).
function player(name: string, stats: number, x: number, z: number, level = 0): TestPlayer {
    const p = new NetworkPlayer(name, 0n, 0n, new NullClientSocket()) as TestPlayer;
    for (const stat of [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.HITPOINTS]) {
        p.baseLevels[stat] = stats;
        p.levels[stat] = stats;
    }
    p.x = x;
    p.z = z;
    p.level = level;
    p.messages = [];
    p.messageGame = (msg: string) => void p.messages.push(msg);
    return p;
}

function run(name: string, self: TestPlayer, target: TestPlayer | null = null): ScriptState {
    const script = ScriptProvider.getByName(name);
    expect(script).toBeDefined();
    const state = ScriptRunner.init(script!, self, target);
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

// Open ground north-east of Lumbridge castle: no bank, safe zone or wilderness.
const FIELD = { x: 3232, z: 3242 };
const LUMBRIDGE_SPAWN = { x: 3221, z: 3218 };
const VARROCK_WEST_BANK = { x: 3185, z: 3440 };
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

test('nobody fights in or out of safe areas', () => {
    const cases: [string, { x: number; z: number }][] = [
        ['lumbridge spawn', LUMBRIDGE_SPAWN],
        ['varrock west bank', VARROCK_WEST_BANK],
        ['tutorial island', TUTORIAL_ISLAND],
        ['duel arena lobby', DUEL_ARENA_LOBBY]
    ];
    for (const [, safe] of cases) {
        const inside = player('inside', 10, safe.x, safe.z);
        const outside = player('outside', 10, FIELD.x, FIELD.z);
        const into = attack(outside, inside);
        expect(into.allowed).toBe(false);
        expect(into.messages).toEqual(['That player is in a safe area.']);
        const outOf = attack(inside, outside);
        expect(outOf.allowed).toBe(false);
        expect(outOf.messages).toEqual(["You can't attack other players from a safe area."]);
    }
});

test('spawn protection blocks attacks until it ends or the protected player attacks', () => {
    const attacker = player('attacker', 10, FIELD.x, FIELD.z);
    const respawned = player('respawned', 10, FIELD.x + 1, FIELD.z);
    run('[proc,pvp_protection_start]', respawned);
    expect(respawned.vars[protection]).toBe(1);
    const blocked = attack(attacker, respawned);
    expect(blocked.allowed).toBe(false);
    expect(blocked.messages).toEqual(['That player has just respawned and is protected.']);

    // The protected player may still attack; doing so (set_pk_vars) ends the protection.
    expect(attack(respawned, attacker).allowed).toBe(true);
    run('[proc,set_pk_vars]', respawned, attacker);
    expect(respawned.vars[protection]).toBe(0);
    expect(respawned.messages).toContain('You are no longer protected from other players.');
    expect(attack(attacker, respawned).allowed).toBe(true);
});
