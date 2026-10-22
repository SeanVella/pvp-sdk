// Spell component ids (from server/content/pack/interface.pack).
// These are what sdk.sendSpellOnTarget / sendSpellOnItem and bot.castSpell
// take as the spell argument, e.g.:
//   await sdk.sendSpellOnItem(item.slot, Spells.HIGH_ALCHEMY);
//   await bot.castSpell('goblin', Spells.WIND_STRIKE);
export const Spells = {
    // Combat spells
    WIND_STRIKE: 1152,
    // pvp-sdk: PvP kit. Level 85, a law, death and chaos rune; players only. A hit stops the
    // target teleporting for 5 minutes (2.5 under Protect from Magic).
    TELE_BLOCK: 40593,
    // pvp-sdk: Ancient Magicks, castable only on the ancient spellbook (state.spellbook), which the
    // Zaros altar at the Demonic Ruins (Wilderness level 46) switches to from Magic 50. Death runes
    // plus chaos or blood (and air/fire/water/soul); Burst and Barrage also hit up to 8 more targets
    // next to the first in multi-combat. Smoke poisons, Shadow lowers Attack, Blood heals you a
    // quarter of the damage and Ice freezes. Staffs can't autocast them.
    SMOKE_RUSH: 40604,
    SHADOW_RUSH: 40616,
    BLOOD_RUSH: 40628,
    ICE_RUSH: 40638,
    SMOKE_BURST: 40648,
    SHADOW_BURST: 40660,
    BLOOD_BURST: 40672,
    ICE_BURST: 40682,
    SMOKE_BLITZ: 40692,
    SHADOW_BLITZ: 40704,
    BLOOD_BLITZ: 40716,
    ICE_BLITZ: 40724,
    SMOKE_BARRAGE: 40734,
    SHADOW_BARRAGE: 40746,
    BLOOD_BARRAGE: 40758,
    ICE_BARRAGE: 40768,
    CONFUSE: 1153,
    WATER_STRIKE: 1154,
    ENCHANT_LVL1: 1155, // Sapphire
    EARTH_STRIKE: 1156,
    WEAKEN: 1157,
    FIRE_STRIKE: 1158,
    WIND_BOLT: 1160,
    CURSE: 1161,
    LOW_ALCHEMY: 1162,
    WATER_BOLT: 1163,
    VARROCK_TELEPORT: 1164,
    ENCHANT_LVL2: 1165, // Emerald
    EARTH_BOLT: 1166,
    LUMBRIDGE_TELEPORT: 1167,
    FIRE_BOLT: 1169,
    FALADOR_TELEPORT: 1170,
    WIND_BLAST: 1172,
    SUPERHEAT: 1173, // Requires Magic 43 AND Smithing level for the bar
    CAMELOT_TELEPORT: 1174,
    WATER_BLAST: 1175,
    ENCHANT_LVL3: 1176, // Ruby
    EARTH_BLAST: 1177,
    HIGH_ALCHEMY: 1178,
    ENCHANT_LVL4: 1180, // Diamond
    FIRE_BLAST: 1181,
    WIND_WAVE: 1183,
    WATER_WAVE: 1185,
    ENCHANT_LVL5: 1187, // Dragonstone
    EARTH_WAVE: 1188,
    FIRE_WAVE: 1189,
    BIND: 1572,
} as const;

export type SpellName = keyof typeof Spells;
