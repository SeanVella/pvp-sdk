# Deadman Mode on PvP-SDK

Old School RuneScape's **Deadman Mode** (DMM) is the closest official game to what this server
is: PvP everywhere, guarded towns, and banks that can be raided. This page sums up how DMM
works across its versions and how each mechanic maps onto our late-2004 game (revision 289).
The player-facing rules are in [`RULES.md`](../RULES.md).

Research done October 2026 from official Jagex news posts and the OSRS Wiki. Version tags:

| Tag | Version | When |
|---|---|---|
| P15 | Permanent Deadman Mode (world 345 today) | Oct 2015 onward |
| SEAS | Seasonal tournaments | Mar 2016 to May 2020 |
| R21 | Deadman: Reborn | Aug to Sep 2021 |
| AP23 | Deadman: Apocalypse | Aug to Sep 2023 |
| AR24 | Deadman: Armageddon | Jul to Aug 2024 |
| AN26 | Deadman: Annihilation | Jan to Feb 2026 |

## What we adopted

| DMM mechanic | DMM version | Here |
|---|---|---|
| PvP everywhere except guarded towns | all | Yes. Lumbridge, Varrock, Falador, East Ardougne and Yanille are safe towns, plus the Seers' and Catherby banks (R21's list, minus places that don't exist in 2004). Edgeville and other banks outside towns are not safe, as in AP23. Tutorial Island, the Duel Arena and Castle Wars stay safe. |
| Guards punish skulled players in safe zones | P15 onward | Yes. A skulled player in a safe area is shot every 2 ticks: the first hit takes a fifth of their base hitpoints and every hit after it 2 more (R21's numbers, at DMM's real-time pace on our 300 ms tick). |
| A death to a player keeps nothing; Protect Item is useless | P15, AN26 | Yes. Unskulled deaths to NPCs still keep the 3 most valuable items. |
| Dying skulled is a full PvP-grade death, even to an NPC | P15 | Yes. |
| Bank keys: dying skulled hands your top bank stacks to your killer | P15 to AR24 | Yes: the 10 most valuable tradeable stacks by store value (the Apr 2016 to AR24 count). The killer gets a **Bank key**. It opens only in a safe area while unskulled, can't be banked or traded, and you can carry at most 5. Killing a key holder takes their keys. If no player gets the credit, the raided stacks fall to the floor for anyone. |
| Teleport and logout delays after PvP | P15 onward | Teleports yes: 24 ticks (7.2 s) after any PvP hit, matching R21's 7.2 s. Logout keeps the normal 16-tick combat lock. |
| Combat brackets | R21 onward (P15 had no limit) | Kept our sliding 15-level range (+1 per Wilderness level) instead of fixed bracket worlds. |
| Fast XP | all | Already 25x on a flatter curve; DMM uses 5-25x. |

## Adapted or deferred

| DMM mechanic | Why not yet | Plan |
|---|---|---|
| Safe deposit box (10 raid-proof items) | Needs an interface | Use a perm inv and reuse the bank interface layout |
| Skull timers: 30 min (P15), 15 min +2 per re-skull (2016), 5 min (R21+); 30 min for attacking someone 30+ levels lower | Ours stays 10 min (2000 ticks) | Make the duration and stacking constants, then tune |
| PJ timer (16 to 24 ticks in modern DMM) | Ours is the standard 8-tick single-combat lock | One constant in `~pvp_in_combat_check` |
| XP loss on death with 5 protected skills (P15/SEAS) | Modern DMM dropped it for brackets | Possible later: needs two small engine commands to read and set XP |
| New-account protection (6 to 12 h, P15/SEAS) | Needs a playtime command | Engine command for playtime, then a protection window |
| Breaches: scheduled boss events with point rewards (AP23+) | Event system | Schedule existing bosses such as the King Black Dragon and Kalphite Queen |
| Sigils: perks like Leagues relics (R21+) | Large content system | A small set of combat sigils later |
| Seasons, hiscore qualification and a battle-royale finale | Operational | Season wipes plus PvP leaderboards (roadmap item 3) |
| Risk skulls showing carried wealth (AN26) | Rev 289 has only one skull icon | Publish carried risk to the SDK instead |
| Bank PINs | Added to RS in Sep 2005 | Not planned |

Some DMM mechanics depend on content added after our revision: Ancient Magicks freezes (the
P15/SEAS guards Ice Barrage), Tele Block, Vengeance, Barrows (AN26's hit-cap exemption), the
Grand Exchange's prices (we use store value; Jagex uses alch value for some checks), POHs and
instances. See [`GAME_VERSIONS.md`](GAME_VERSIONS.md) for how we could get some of them.

## How it's built

- `server/content/scripts/pvp_world/`: safe towns (`pvp_safe_zones.dbrow`), guards and the
  teleport lock (`pvp_world.rs2`), bank keys (`dmm_bank_keys.rs2`, `.inv`, `.obj`), tunables
  (`pvp_world.constant`).
- Key storage: five saved inventories per player (`dmm_key_1` to `dmm_key_5`, ids 1000-1004);
  the Bank key items in the backpack only mirror them, so items can't be duplicated by
  dropping, banking or dying with a key.
- Tests: `server/engine/test/pvp-world.test.ts` covers raids, key theft, overflow, guard damage
  and the teleport lock against the compiled scripts. An end-to-end run on a local engine went:
  attack, skull, guards kill the attacker in Lumbridge, killer gets a key with the victim's
  coins, key opened in town.

## Sources

- Deadman Mode launch: <https://secure.runescape.com/m=news/deadman-mode?oldschool=1>
- Bank key and guard tweaks, Nov 2015: <https://secure.runescape.com/m=news/skilling-pets--deadman-tweaks?oldschool=1>,
  <https://secure.runescape.com/m=news/monster-examine--deadman?oldschool=1>
- Keys cut to 10 stacks, Apr 2016: <https://secure.runescape.com/m=news/deadman-changes--implings?oldschool=1>
- The future of Deadman Mode: <https://secure.runescape.com/m=news/the-future-of-deadman-mode?oldschool=1>
- Deadman: Reborn: <https://secure.runescape.com/m=news/deadman-reborn?oldschool=1>
- Deadman: Apocalypse: <https://secure.runescape.com/m=news/everything-you-need-to-know-for-deadman-apocalypse?oldschool=1>
- Deadman: Annihilation: <https://secure.runescape.com/m=news/a=97/deadman-annihilation---everything-you-need-to-know?oldschool=1>
- World 345 changes, Mar 2025: <https://secure.runescape.com/m=news/permanent-deadman-world-345-improvements?oldschool=1>
- OSRS Wiki: <https://oldschool.runescape.wiki/w/Deadman_Mode>, <https://oldschool.runescape.wiki/w/Bank_key>,
  <https://oldschool.runescape.wiki/w/Guard_(Deadman_Mode)>
