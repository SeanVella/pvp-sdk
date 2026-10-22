import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    PVP_COMBAT_RANGE, SAFE_ZONES, SKULL_DURATION_TICKS, WILDERNESS_ZONES,
    assessPvpAttack, decodeCoord, safeZoneAt, wildernessLevel, type PvpZone
} from '../pvp';
import type { NearbyPlayer } from '../types';

const scripts = join(import.meta.dir, '..', '..', 'server', 'content', 'scripts');
const read = (path: string) => readFileSync(join(scripts, path), 'utf8');

/** The coord pairs of a coord_pair_table dbrow, as the zones sdk/pvp.ts builds from them. */
function dbrowZones(path: string): Pick<PvpZone, 'minX' | 'maxX' | 'minZ' | 'maxZ' | 'minLevel' | 'maxLevel'>[] {
    return [...read(path).matchAll(/^data=coord_pair,(\S+),(\S+)$/gm)].map(([, from, to]) => {
        const a = decodeCoord(from!);
        const b = decodeCoord(to!);
        return { minX: a.x, maxX: b.x, minZ: a.z, maxZ: b.z, minLevel: a.level, maxLevel: b.level };
    });
}
const bounds = ({ minX, maxX, minZ, maxZ, minLevel, maxLevel }: PvpZone) => ({ minX, maxX, minZ, maxZ, minLevel, maxLevel });

describe('the SDK mirrors the server tables', () => {
    test('the guarded towns match pvp_safe_zones.dbrow', () => {
        const towns = SAFE_ZONES.filter(z => z.kind === 'town').map(bounds);
        expect(towns).toEqual(dbrowZones('pvp_world/configs/pvp_safe_zones.dbrow'));
    });

    test('the Duel Arena matches duel_arena_zones', () => {
        const arena = SAFE_ZONES.filter(z => z.name === 'Duel Arena').map(bounds);
        const table = read('minigames/game_duelarena/configs/duelarena.dbrow').split('[duel_arena_zones]')[1]!;
        const [, from, to] = /data=coord_pair,(\S+),(\S+)/.exec(table)!;
        const a = decodeCoord(from!);
        const b = decodeCoord(to!);
        expect(arena).toEqual([{ minX: a.x, maxX: b.x, minZ: a.z, maxZ: b.z, minLevel: a.level, maxLevel: b.level }]);
    });

    test('Tutorial Island matches ~in_tutorial_island', () => {
        const proc = read('tutorial/scripts/util.rs2').split('[proc,in_tutorial_island]')[1]!.split('\n[')[0]!;
        const pairs = [...proc.matchAll(/inzone\((\S+), (\S+), \$coord\)/g)].map(([, from, to]) => {
            const a = decodeCoord(from!);
            const b = decodeCoord(to!);
            return { minX: a.x, maxX: b.x, minZ: a.z, maxZ: b.z, minLevel: a.level, maxLevel: b.level };
        });
        expect(SAFE_ZONES.filter(z => z.kind === 'tutorial').map(bounds)).toEqual(pairs);
    });

    test('the Wilderness matches wilderness_zones.dbrow', () => {
        expect(WILDERNESS_ZONES.map(bounds)).toEqual(dbrowZones('areas/area_wilderness/configs/wilderness_zones.dbrow'));
    });

    test('the level range and skull length match the server constants', () => {
        expect(read('pvp_world/configs/pvp_world.constant')).toContain(`^pvp_combat_range = ${PVP_COMBAT_RANGE}`);
        expect(read('skill_combat/configs/pvp.constant')).toContain(`^pk_skull_duration = ${SKULL_DURATION_TICKS}`);
    });
});

describe('safe areas and Wilderness levels', () => {
    test('towns are safe and the land between them is not', () => {
        expect(safeZoneAt(3222, 3218)?.name).toBe('Lumbridge');
        expect(safeZoneAt(3212, 3428)?.name).toBe('Varrock');
        expect(safeZoneAt(3229, 3272)).toBeNull(); // the field north of Lumbridge
        expect(safeZoneAt(3094, 3493)).toBeNull(); // Edgeville bank is dangerous
        expect(safeZoneAt(3100, 3100)?.name).toBe('Tutorial Island');
    });

    test('a zone only covers its own planes', () => {
        expect(safeZoneAt(2809, 3440, 0)?.name).toBe('Catherby bank');
        expect(safeZoneAt(2809, 3440, 1)).toBeNull();
    });

    test('the Wilderness level rises by one every 8 tiles north', () => {
        expect(wildernessLevel(3100, 3519)).toBe(0);
        expect(wildernessLevel(3100, 3520)).toBe(1);
        expect(wildernessLevel(3100, 3527)).toBe(1);
        expect(wildernessLevel(3100, 3528)).toBe(2);
        expect(wildernessLevel(3100, 3600)).toBe(11);
        expect(wildernessLevel(3100, 9920, 0)).toBe(1); // Edgeville Dungeon
    });
});

describe('assessPvpAttack', () => {
    function world(me: { x: number; z: number; combatLevel?: number }, opts: { skulled?: boolean; hitBy?: number } = {}) {
        return {
            player: { worldX: me.x, worldZ: me.z, level: 0, combatLevel: me.combatLevel ?? 40 },
            isSkulled: opts.skulled ?? false,
            combatEvents: opts.hitBy === undefined ? [] : [
                { tick: 1, type: 'damage_taken', damage: 2, sourceType: 'other_player', sourceIndex: opts.hitBy, targetType: 'player', targetIndex: -1 }
            ]
        } as any;
    }
    function rival(x: number, z: number, extra: Partial<NearbyPlayer> = {}): NearbyPlayer {
        return { kind: 'player', index: 7, name: 'Zezima', combatLevel: 45, x, z, distance: 3, ...extra };
    }
    const codes = (a: ReturnType<typeof assessPvpAttack>) => a.warnings.map(w => w.code);

    test('an even fight in the open only warns about the skull', () => {
        const a = assessPvpAttack(world({ x: 3229, z: 3272 }), rival(3231, 3272));
        expect(a).toMatchObject({ allowed: true, levelGap: 5, maxLevelGap: 15, willSkull: true, targetSkulled: false });
        expect(codes(a)).toEqual(['will_skull']);
    });

    test('a target in town is refused', () => {
        const a = assessPvpAttack(world({ x: 3229, z: 3262 }), rival(3229, 3258));
        expect(a.allowed).toBe(false);
        expect(a.targetInSafeArea).toBe('Lumbridge');
        expect(codes(a)).toContain('target_in_safe_area');
    });

    test('the level range widens in the Wilderness', () => {
        const open = assessPvpAttack(world({ x: 3229, z: 3272, combatLevel: 40 }), rival(3231, 3272, { combatLevel: 70 }));
        expect(open).toMatchObject({ allowed: false, levelGap: 30, maxLevelGap: 15 });
        expect(codes(open)).toContain('level_gap');

        // Both at least Wilderness level 16 (z 3640): 15 + 16 covers a gap of 30.
        const deep = assessPvpAttack(world({ x: 3100, z: 3641, combatLevel: 40 }), rival(3102, 3641, { combatLevel: 70 }));
        expect(deep).toMatchObject({ allowed: true, wildernessLevel: 16, maxLevelGap: 31 });
    });

    test('fighting back does not skull you', () => {
        const a = assessPvpAttack(world({ x: 3229, z: 3272 }, { hitBy: 7 }), rival(3231, 3272));
        expect(a.willSkull).toBe(false);
        expect(codes(a)).toEqual([]);
    });

    test('a skulled attacker is warned when the way to the target crosses a town', () => {
        // From north of Lumbridge to the field south of it, straight through the town.
        const a = assessPvpAttack(world({ x: 3220, z: 3265 }, { skulled: true, hitBy: 7 }), rival(3220, 3195));
        expect(codes(a)).toEqual(['skulled_route_through_safe_area']);
        expect(a.warnings[0]!.message).toContain('Lumbridge');
    });

    test('reports a skulled target, whose bank is on the line', () => {
        expect(assessPvpAttack(world({ x: 3229, z: 3272 }), rival(3231, 3272, { isSkulled: true })).targetSkulled).toBe(true);
    });
});
