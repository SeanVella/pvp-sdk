// pvp-sdk: the server's PvP geography and rules, mirrored so bots can weigh an attack
// before they make it. The server decides every attack; nothing here refuses one.
//
// Sources (sdk/test/pvp-rules.test.ts checks the table-driven ones still match):
// - safe areas: ~pvp_in_safe_zone in server/content/scripts/pvp_world/scripts/pvp_world.rs2,
//   i.e. pvp_safe_zones.dbrow, ~in_tutorial_island, duel_arena_zones and Castle Wars
// - Wilderness levels: ~wilderness_level and wilderness_zones.dbrow
// - the level range: ~pvp_level_check and ^pvp_combat_range in pvp_world.constant
// - the skull: ~deserves_pk_skull and ^pk_skull_duration in skill_combat/scripts/pvp/

import type { BotWorldState, NearbyPlayer, PvpAttackAssessment, PvpWarning } from './types';

/** Combat levels two players may differ by outside the Wilderness. */
export const PVP_COMBAT_RANGE = 15;
/** How long an attack on someone who hadn't attacked you skulls you: 2000 ticks, 10 minutes. */
export const SKULL_DURATION_TICKS = 2000;

export interface PvpZone {
    name: string;
    /** Safe areas are `town`, `tutorial` or `minigame`; all are guarded the same way. */
    kind: 'town' | 'tutorial' | 'minigame' | 'wilderness';
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    minLevel: number;
    maxLevel: number;
}

/** Decodes a RuneScript coord literal, level_mapX_mapZ_localX_localZ. */
export function decodeCoord(literal: string): { level: number; x: number; z: number } {
    const [level, mx, mz, lx, lz] = literal.split('_').map(Number) as [number, number, number, number, number];
    return { level, x: mx * 64 + lx, z: mz * 64 + lz };
}

function zone(name: string, kind: PvpZone['kind'], from: string, to: string): PvpZone {
    const a = decodeCoord(from);
    const b = decodeCoord(to);
    return { name, kind, minX: a.x, maxX: b.x, minZ: a.z, maxZ: b.z, minLevel: a.level, maxLevel: b.level };
}

/** Every area where nobody attacks or is attacked, and the guards shoot skulled players. */
export const SAFE_ZONES: readonly PvpZone[] = [
    // pvp_safe_zones.dbrow, in its order
    zone('Lumbridge', 'town', '0_50_50_0_0', '3_50_50_36_60'),
    zone('Lumbridge', 'town', '0_50_50_37_0', '3_50_50_49_17'),
    zone('Varrock', 'town', '0_49_52_54_54', '3_50_54_62_36'),
    zone('Varrock', 'town', '0_49_53_38_7', '3_51_53_3_57'),
    zone('Varrock', 'town', '0_49_52_46_54', '3_51_53_19_12'),
    zone('Varrock', 'town', '0_49_54_58_37', '3_50_54_51_45'),
    zone('Varrock', 'town', '0_50_52_53_52', '3_51_53_8_44'),
    zone('Varrock', 'town', '0_50_52_3_53', '3_50_54_30_50'),
    zone('Varrock', 'town', '0_49_53_51_58', '3_51_54_3_14'),
    zone('Varrock', 'town', '0_51_52_11_49', '3_51_52_23_63'),
    zone('Varrock', 'town', '0_49_53_45_58', '3_51_54_3_0'),
    zone('Varrock', 'town', '0_50_52_53_52', '3_51_53_17_14'),
    zone('Varrock', 'town', '0_49_54_61_46', '3_50_54_31_49'),
    zone('Varrock', 'town', '0_49_53_39_51', '3_51_53_5_58'),
    zone('Varrock', 'town', '0_49_53_38_15', '3_51_53_9_28'),
    zone('Varrock', 'town', '0_49_54_55_37', '3_50_54_51_42'),
    zone('Varrock', 'town', '0_50_52_3_50', '3_50_54_6_51'),
    zone('Falador', 'town', '0_45_52_56_1', '3_47_52_51_60'),
    zone('Falador', 'town', '0_45_51_61_47', '3_46_53_43_0'),
    zone('Falador', 'town', '0_45_51_59_58', '3_47_52_4_63'),
    zone('Falador', 'town', '0_45_52_56_40', '3_47_52_57_57'),
    zone('Falador', 'town', '0_46_51_12_46', '3_46_53_41_2'),
    zone('Falador', 'town', '0_45_51_61_52', '3_46_53_51_0'),
    zone('Falador', 'town', '0_45_51_59_63', '3_47_52_12_63'),
    zone('Falador', 'town', '0_46_53_52_0', '3_47_53_1_1'),
    zone('Falador', 'town', '0_47_52_39_36', '3_47_52_53_61'),
    zone('Falador', 'town', '0_45_51_56_56', '3_46_52_55_61'),
    zone('Falador', 'town', '0_45_52_56_61', '3_47_52_31_61'),
    zone('Falador', 'town', '0_46_51_19_45', '3_46_53_40_2'),
    zone('Falador', 'town', '0_45_53_63_1', '3_46_53_41_1'),
    zone('East Ardougne', 'town', '0_40_51_39_0', '3_41_52_58_6'),
    zone('East Ardougne', 'town', '0_40_50_0_63', '3_40_52_34_12'),
    zone('East Ardougne', 'town', '0_40_52_40_7', '3_41_52_45_11'),
    zone('East Ardougne', 'town', '0_40_51_36_1', '3_41_51_61_54'),
    zone('East Ardougne', 'town', '0_40_51_39_53', '3_41_52_63_1'),
    zone('East Ardougne', 'town', '0_40_51_0_1', '3_41_51_61_29'),
    zone('East Ardougne', 'town', '0_40_51_0_35', '3_41_51_62_54'),
    zone('Yanille', 'town', '0_39_48_45_1', '3_40_48_53_37'),
    zone('Yanille', 'town', '0_39_48_41_3', '3_40_48_61_28'),
    zone('Yanille', 'town', '0_39_48_45_38', '3_40_48_49_38'),
    zone('Yanille', 'town', '0_39_48_37_11', '3_40_48_58_29'),
    zone('Yanille', 'town', '0_39_48_41_30', '3_40_48_53_36'),
    zone('Yanille', 'town', '0_40_47_22_63', '3_40_48_30_38'),
    zone('Yanille', 'town', '0_39_48_45_1', '3_40_48_60_28'),
    zone("Seers' Village bank", 'town', '0_42_54_33_34', '1_42_54_42_41'),
    zone("Seers' Village bank", 'town', '0_42_54_36_31', '0_42_54_39_33'),
    zone('Catherby bank', 'town', '0_43_53_54_46', '0_43_53_60_53'),
    // ~in_tutorial_island
    zone('Tutorial Island', 'tutorial', '0_47_47_45_48', '3_49_49_20_0'),
    zone('Tutorial Island', 'tutorial', '0_48_148_0_20', '3_48_148_46_63'),
    // duel_arena_zones
    zone('Duel Arena', 'minigame', '0_52_50_0_3', '0_53_51_1_61'),
    // ~in_castlewars_game and ~in_castlewars_waitingroom
    zone('Castle Wars', 'minigame', '0_37_48_0_0', '3_37_48_63_63'),
    zone('Castle Wars', 'minigame', '0_37_148_0_0', '0_37_148_63_63')
];

/** wilderness_zones.dbrow: the level is 1 at the zone's south edge, plus 1 every 8 tiles north. */
export const WILDERNESS_ZONES: readonly PvpZone[] = [
    zone('Wilderness', 'wilderness', '0_46_55_0_0', '3_52_99_63_63'),
    zone('Wilderness (Edgeville Dungeon)', 'wilderness', '0_46_155_0_0', '0_52_199_63_63')
];

function contains(z: PvpZone, x: number, zc: number, level: number): boolean {
    return x >= z.minX && x <= z.maxX && zc >= z.minZ && zc <= z.maxZ && level >= z.minLevel && level <= z.maxLevel;
}

/** The safe area at a tile, or null. Level is the plane, 0 for the ground. */
export function safeZoneAt(x: number, z: number, level = 0): PvpZone | null {
    return SAFE_ZONES.find(s => contains(s, x, z, level)) ?? null;
}

export function isInSafeArea(x: number, z: number, level = 0): boolean {
    return safeZoneAt(x, z, level) !== null;
}

/** The Wilderness level at a tile, 0 outside it. */
export function wildernessLevel(x: number, z: number, level = 0): number {
    const w = WILDERNESS_ZONES.find(s => contains(s, x, z, level));
    return w ? Math.floor((z - w.minZ) / 8) + 1 : 0;
}

/**
 * Weigh an attack on another player without making it: everything the client can tell
 * about whether the server will allow it and what it will cost you. Pure: reads `state`.
 */
export function assessPvpAttack(state: BotWorldState, target: NearbyPlayer): PvpAttackAssessment {
    const me = state.player;
    const level = me?.level ?? 0;
    const myX = me?.worldX ?? 0;
    const myZ = me?.worldZ ?? 0;
    const youZone = me ? safeZoneAt(myX, myZ, level) : null;
    // Nearby players don't publish their plane; they're almost always on ours.
    const targetZone = safeZoneAt(target.x, target.z, level);
    const wild = Math.min(wildernessLevel(myX, myZ, level), wildernessLevel(target.x, target.z, level));
    const levelGap = Math.abs((me?.combatLevel ?? 0) - target.combatLevel);
    const maxLevelGap = PVP_COMBAT_RANGE + wild;
    const youSkulled = state.isSkulled === true;
    const targetSkulled = target.isSkulled === true;
    const hitByTarget = state.combatEvents.some(e =>
        e.type === 'damage_taken' && e.sourceType === 'other_player' && e.sourceIndex === target.index);
    const willSkull = !hitByTarget;

    const warnings: PvpWarning[] = [];
    if (targetZone) {
        warnings.push({ code: 'target_in_safe_area', message: `${target.name} is in ${targetZone.name}, a safe area: the server will refuse.` });
    }
    if (levelGap > maxLevelGap) {
        warnings.push({
            code: 'level_gap',
            message: `Combat level gap ${levelGap} is over ${maxLevelGap} (${PVP_COMBAT_RANGE}${wild > 0 ? ` + Wilderness ${wild}` : ''}): the server will refuse.`
        });
    }
    if (youZone) {
        warnings.push({ code: 'you_in_safe_area', message: `You're in ${youZone.name}, a safe area: the attack is refused until you step out.` });
    }
    if (willSkull) {
        warnings.push({
            code: 'will_skull',
            message: youSkulled
                ? `${target.name} hasn't hit you lately, so this resets your skull to 10 minutes.`
                : `${target.name} hasn't hit you lately, so this likely skulls you for 10 minutes: town guards shoot you, and dying costs your 10 most valuable bank stacks.`
        });
    }
    if (youSkulled && !youZone && me) {
        const crossed = firstSafeZoneOnLine(myX, myZ, target.x, target.z, level);
        if (crossed) {
            warnings.push({
                code: 'skulled_route_through_safe_area',
                message: `You're skulled and the way to ${target.name} crosses ${crossed.name}, where the guards will shoot you.`
            });
        }
    }

    return {
        target: target.name,
        allowed: !targetZone && levelGap <= maxLevelGap,
        warnings,
        levelGap,
        maxLevelGap,
        wildernessLevel: wild,
        youInSafeArea: youZone?.name ?? null,
        targetInSafeArea: targetZone?.name ?? null,
        youSkulled,
        targetSkulled,
        willSkull
    };
}

/** The first safe area a straight walk from one tile to another enters, tile by tile. */
function firstSafeZoneOnLine(x0: number, z0: number, x1: number, z1: number, level: number): PvpZone | null {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
    for (let i = 1; i <= steps; i++) {
        const x = Math.round(x0 + ((x1 - x0) * i) / steps);
        const z = Math.round(z0 + ((z1 - z0) * i) / steps);
        const hit = safeZoneAt(x, z, level);
        if (hit) return hit;
    }
    return null;
}
