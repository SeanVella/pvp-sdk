# PvP-SDK rules

On this server **the whole world is a PvP area**. Any player can attack any other player almost
anywhere, not just in the Wilderness. These are the exact rules the server enforces: they live in
[`server/content/scripts/pvp_world/`](server/content/scripts/pvp_world) and
[`pvp_combat.rs2`](server/content/scripts/skill_combat/scripts/pvp/pvp_combat.rs2).

Times are given in game ticks. The server ticks every **300 ms**, so 100 ticks is 30 seconds.

| Rule | |
|---|---|
| Where you can fight | Everywhere except the [safe areas](#safe-areas) |
| Who you can attack | Players within **15 combat levels** of you; **15 + Wilderness level** inside the Wilderness |
| Spawn protection | 100 ticks (30 s) after respawning; ends early if you attack someone |
| Death | Keep your 3 most valuable items (4 with Protect Item, 0 if skulled); respawn in Lumbridge at full health |
| Skull | Attacking someone who didn't attack you first skulls you for 2000 ticks (10 min) |
| Combat | Single-combat everywhere except the [multi-combat areas](#multi-combat-areas) |

## Who can attack whom

| Where both players are | Largest allowed combat-level difference |
|---|---|
| Outside the Wilderness | 15 |
| In the Wilderness | 15 + the Wilderness level |

The Wilderness level is the **lower** of the two players' levels, so a player just outside the
Wilderness can only be attacked by someone within 15 levels. For example, at Wilderness level 20
the range is 35 levels.

The range is checked on every swing and spell, so a fight stops as soon as either player is out
of range or steps into a safe area.

**Single-combat** (everywhere outside the multi-combat areas): once a player hits you, only that
player can attack you, and you can't attack anyone else, until 8 ticks after the last hit.

**Minigames** keep their own rules between players inside them: duels follow the duel's options,
and Castle Wars only lets you attack the other team.

## Safe areas

Nobody can attack **into** or **out of** a safe area. Coordinates are inclusive world coordinates
(`x`, `z`); "levels" are floors (0 = ground).

### Respawn point

| Area | Bounds |
|---|---|
| Lumbridge castle and its courtyard | x 3200-3228, z 3200-3237 (levels 0-3) |

### Banks

| Bank | Bounds |
|---|---|
| Varrock East | x 3250-3257, z 3416-3424 (levels 0-1)<br>x 3253, z 3425-3427 (level 0) |
| Varrock West | x 3180-3190, z 3433-3447 (levels 0-1) |
| Al Kharid | x 3265-3272, z 3161-3173 (level 0) |
| Draynor Village | x 3088-3097, z 3240-3246 (level 0) |
| Falador East | x 3009-3021, z 3353-3356 (level 0)<br>x 3011-3014, z 3357-3358 (level 0) |
| Falador West | x 2945-2949, z 3359-3373 (level 0, several boxes)<br>x 2945-2949, z 3362-3369 (level 1) |
| Edgeville | x 3091-3098, z 3488-3499 (level 0) |
| Seers' Village | x 2721-2730, z 3490-3497 (levels 0-1)<br>x 2724-2727, z 3487-3489 (level 0) |
| Catherby | x 2806-2812, z 3438-3445 (level 0) |
| Yanille | x 2609-2616, z 3088-3097 (level 0) |
| Ardougne West | x 2612-2621, z 3330-3335 (level 0) |
| Ardougne East | x 2649-2658, z 3280-3287 (levels 0-2) |
| Shilo Village | x 2843-2861, z 2951-2957 (levels 0-1) |
| Gnome Stronghold | x 2443-2448, z 3415-3434 (level 1)<br>x 2440-2453, z 3416-3496 (level 1, tree banks) |
| Mage Arena | x 2529-2546, z 4711-4723 (level 0) |
| Shantay Pass | x 3308-3309, z 3119-3121 (level 0) |
| Fishing Guild | x 2586-2587, z 3418-3422 (level 0) |
| Zanaris | x 3148-3155, z 9573-9582 (level 0) |
| Duel Arena | x 3380-3384, z 3267-3271 (level 0) |

These are the bank interiors from
[`bank_zones.dbrow`](server/content/scripts/skill_firemaking/configs/bank_zones.dbrow). The street
outside a bank is not safe.

### Other safe areas

| Area | Bounds | Notes |
|---|---|---|
| Tutorial Island | x 3053-3156, z 3056-3136 (all levels)<br>x 3072-3118, z 9492-9535 (underground) | Where new accounts start |
| Duel Arena | x 3328-3393, z 3203-3325 (level 0) | The whole compound, including the lobby; duels still work |
| Castle Wars | x 2368-2431, z 3072-3135 (all levels)<br>x 2368-2431, z 9472-9535 (level 0) | Game areas and waiting rooms; games still work |

## Spawn protection

For **100 ticks (30 s)** after you respawn, nobody can attack you, so the respawn point can't be
camped. You see "You are protected from other players for a short while." and later "You are no
longer protected from other players." Attacking another player ends your protection immediately.

## Death

- You keep your **3 most valuable items**, or **4** with the Protect Item prayer. If you are
  **skulled** you keep **nothing** (plus 1 with Protect Item).
- Everything else drops where you died. Tradeable items appear for your killer first and for
  everyone else a while later; untradeable items drop for you instead.
- You respawn in **Lumbridge castle's courtyard at full health**, with spawn protection.

## Skulls

Attacking a player who hasn't attacked you first gives you a **skull** for **2000 ticks
(10 minutes)**. A skull doesn't stop you from doing anything, but if you die while skulled you
keep no items (except one with Protect Item). Fighting back against someone who attacked you
doesn't skull you, and the skull timer survives logging out.

## Multi-combat areas

In these areas any number of players can attack the same target. Everywhere else is single-combat.

**In the Wilderness:** the agility course and white wolves, scorpion valley, the rogues' fort, the
evil altar, north of the Lava Maze, the dark warrior castle, the bandit camp, the east
Wilderness, the Mage Arena and the King Black Dragon's lair.

**Outside it:** Falador, Barbarian Village, Al Kharid, Burthorpe, Rellekka, the Draynor jail, the
Wizards' Tower, the Asgarnia chaos temple, White Wolf Mountain, the Ranging Guild, the
Necromancer tower, the Gnome battlefield, the Varrock sewer, the Ice Queen's lair, the Temple of
Ikov and Legends' Quest dungeons, Rashiliyia's tomb (Shilo Village), the Elemental Workshop, Death
Plateau, Trollheim, the Kalphite Queen's chamber and burrow, the Lighthouse dungeon, Ape Atoll, the
Haunted Mine boss area and Castle Wars.

The exact tiles are listed in [`multiway.csv`](server/content/maps/multiway.csv).

## The Wilderness

The Wilderness starts north of the ditch at z 3520 (x 2944-3391), and underground at z 9920. Every
8 tiles north is one more level. It is still the place for big level gaps, and it keeps the
original restrictions:

- No teleport spells or jewellery teleports above level 20 (amulet of glory: above 30).
- A ring of life doesn't save you above level 30.

## Logging out

You can't log out for 16 ticks (about 5 seconds here) after combat. The in-game message says 10
seconds, which is what it was at the original game's speed.

## Server messages

When the server refuses an attack it says why. `bot.attack()` and `bot.castSpell()` return these
messages with `reason: 'not_attackable'` (or `'already_in_combat'` for the single-combat lock):

| Message | Meaning |
|---|---|
| That player is in a safe area. | The target is in a safe area |
| You can't attack other players from a safe area. | You are in a safe area |
| That player has just respawned and is protected. | Spawn protection |
| Your level difference is too great! | Outside the combat-level range |
| I'm already under attack. | Single-combat: someone else is fighting you |
| Someone else is already fighting your opponent. | Single-combat: your target is busy |

## Other server settings

- Fast XP: 25x rate on a flatter level curve.
- Unlimited run energy.
- No random events.
- Members content is enabled.

Strategy tips for bots are in [`learnings/pvp.md`](learnings/pvp.md). Planned changes are in
[`docs/PVP_PLAN.md`](docs/PVP_PLAN.md).
