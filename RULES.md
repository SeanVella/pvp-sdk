# PvP-SDK rules

On this server **the whole world is a PvP area**, with rules modelled on Old School RuneScape's
[Deadman Mode](docs/DEADMAN.md). Any player can attack any other player almost anywhere,
guarded towns are the only safe places, and dying while skulled hands part of your bank to
your killer. These are the exact rules the server enforces: they live in
[`server/content/scripts/pvp_world/`](server/content/scripts/pvp_world) and
[`pvp_combat.rs2`](server/content/scripts/skill_combat/scripts/pvp/pvp_combat.rs2).

Times are given in game ticks. The server ticks every **300 ms**, so 100 ticks is 30 seconds.

| Rule | |
|---|---|
| Where you can fight | Everywhere except the [safe areas](#safe-areas): five guarded towns, two banks and a few minigame areas |
| Who you can attack | Players within **15 combat levels** of you; **15 + Wilderness level** inside the Wilderness |
| Guards | A **skulled** player in a safe area is shot until they leave or die |
| Death | A death to a player keeps **nothing**. A death to an NPC keeps your 3 most valuable items, or nothing if skulled. Protect Item doesn't help |
| Bank keys | Die **skulled** and your 10 most valuable bank stacks go to your killer as a Bank key |
| Skull | Attacking someone who didn't attack you first skulls you for 2000 ticks (10 min) |
| Teleporting | Blocked for 24 ticks (7.2 s) after any PvP hit |
| Spawn protection | 100 ticks (30 s) after respawning; ends early if you attack someone |
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

A walled town's safe area is the ground inside its walls, traced from the map: step out of a
gate and you're on open ground, and the guards stay inside. The exact tiles are in
[`pvp_safe_zones.dbrow`](server/content/scripts/pvp_world/configs/pvp_safe_zones.dbrow); the
bounds below are each town's outer edges.

| Area | Bounds |
|---|---|
| Lumbridge (everyone respawns here) | The castle grounds and village up to the road, x 3200-3236, z 3200-3260, and the churchyard, x 3237-3249, z 3200-3217 (levels 0-3). The river and the bridge east are open ground |
| Varrock | Inside the city walls, within x 3174-3287, z 3377-3507 (levels 0-3). The Jolly Boar Inn and the fields outside the walls are open ground |
| Falador | Inside the city walls, within x 2936-3065, z 3309-3394 (levels 0-3) |
| East Ardougne | The walled market side, the river through town and the castle quarter up to the West Ardougne wall, within x 2560-2687, z 3263-3340 (levels 0-3) |
| Yanille | Inside the city walls, within x 2533-2621, z 3071-3110 (levels 0-3) |
| Seers' Village bank | x 2721-2730, z 3490-3497 (levels 0-1)<br>x 2724-2727, z 3487-3489 (level 0) |
| Catherby bank | x 2806-2812, z 3438-3445 (level 0) |
| Tutorial Island | x 3053-3156, z 3056-3136 (all levels)<br>x 3072-3118, z 9492-9535 (underground) |
| Duel Arena | x 3328-3393, z 3203-3325 (level 0); duels still work |
| Castle Wars | x 2368-2431, z 3072-3135 (all levels)<br>x 2368-2431, z 9472-9535 (level 0); games still work |

**Every other bank is dangerous**, including Edgeville, Draynor, Al Kharid and the Gnome
Stronghold, as in Deadman Mode. The towns' banks are safe because the towns are.

### Guards

A **skulled** player inside a safe area is shot by the guards every 2 ticks until they leave or
die. The first hit takes a fifth of their base hitpoints, and each hit after that does 2 more.
The messages are "The guards attack you for bringing a skull into a safe area!" and "Leave the
area or they will kill you." Losing your skull (it runs out, or you die) ends it.

## Death

| How you died | What you keep | Your bank |
|---|---|---|
| Killed by a player, not skulled | **Nothing** | Safe |
| Killed by a player while skulled | **Nothing** | **10 most valuable stacks** go to the killer as a Bank key |
| Killed by an NPC, not skulled | Your 3 most valuable items | Safe |
| Killed by an NPC or the guards while skulled | **Nothing** | **10 most valuable stacks** drop where you died, for anyone |

- The Protect Item prayer doesn't save an extra item.
- Items you lose drop where you died. Tradeable items appear for your killer first and for
  everyone else a while later; untradeable items drop for you.
- If a player had damaged you, a death to the guards counts as a death to that player.
- You respawn in **Lumbridge at full health**, with spawn protection.

## Bank keys

When a **skulled** player dies, their **10 most valuable tradeable bank stacks** (by store value)
are taken from their bank. If a player killed them, the stacks go into a **Bank key** for that
player. Otherwise they drop where the player died.

- A Bank key has three options: **Open** sends its stacks to your bank (or to the floor at your
  feet if the bank is full), **Check** lists its stacks, and **Destroy** throws it and everything
  in it away.
- Keys only open **inside a safe area** and **while you're not skulled**. A skulled player can't
  stay in a safe area because of the guards, so a killer who attacked first has to survive until
  their skull wears off before they can cash in.
- You can carry at most **5 keys**. They can't be banked or traded.
- Kill someone carrying keys and you take their keys. Keys that don't fit drop for you.
- Die to an NPC with keys and the keys are destroyed.

### Safe deposit box

Every player has a **safe deposit box** of **10 stacks** that bank raids never take. Talk to any
banker and choose "I'd like to use my safe deposit box." to store or withdraw items. Bank keys
can't go in it.

## Skulls

Attacking a player who hasn't attacked you first gives you a **skull** for **2000 ticks
(10 minutes)**. Fighting back against someone who attacked you doesn't skull you, and the skull
timer survives logging out. While skulled:

- the guards attack you in safe areas;
- dying makes your bank raidable, as described under [Bank keys](#bank-keys);
- you can't open Bank keys.

If the safe zones have grown since you logged out, any skull you logged out with is removed when
you log back in ("The safe zones have changed since you logged out, so your skull has been
removed."), so you never wake up to guards in a town that was open ground when you left.
Otherwise logging out doesn't help: log out skulled inside a safe area and the guards are
waiting when you return.

## Teleporting

For **24 ticks (7.2 seconds)** after hitting or being hit by another player, no teleport works:
spells, jewellery, the Wilderness levers, the rune essence wizards or anything else. The message
is "You can't teleport so soon after fighting another player." In the Wilderness the usual limits also apply: no teleports above level 20
(amulet of glory: above 30), and a ring of life doesn't save you above level 30.

### Tele Block

**Tele Block** (Magic 85; a law, a death and a chaos rune; 80 xp) is cast on another player under
the usual attack rules. If it lands, they can't teleport for **1000 ticks (5 minutes)**, or **500
(2.5 minutes)** if they were praying Protect from Magic when it hit. It stops teleport spells,
jewellery, the Wilderness levers and the rune essence wizards, with "A magical force stops you
from teleporting." It lasts
through logging out and ends when you die. It can't be cast on someone who's already blocked
("That player is already affected by this spell."). Like any attack, it can miss and it can
skull you. It's in the spellbook after Charge.

## Ancient Magicks

The **Zaros altar** in the Demonic Ruins (Wilderness level 46, at 3287-3289, 3883, a multi-combat
area) swaps your spellbook to **Ancient Magicks**, and back again. Praying at it needs Magic 50
("You feel a strange wisdom fill your mind..."). You can only cast spells from the book you're
on. Staffs can't autocast ancient spells, and switching books turns autocast off.

| Magic level / max hit | Smoke | Shadow | Blood | Ice |
|---|---|---|---|---|
| **Rush** (one target) | 50 / 13 | 52 / 14 | 56 / 15 | 58 / 16 |
| **Burst** (up to 9 targets) | 62 / 17 | 64 / 18 | 68 / 21 | 70 / 22 |
| **Blitz** (one target) | 74 / 23 | 76 / 24 | 80 / 25 | 82 / 26 |
| **Barrage** (up to 9 targets) | 86 / 27 | 88 / 28 | 92 / 29 | 94 / 30 |

Runes, xp and max hits are Old School's. Every spell takes death runes, plus chaos runes (Rush
and Burst) or blood runes (Blitz and Barrage), and the element's own: air and fire for Smoke, air
and soul for Shadow, more blood for Blood (and a soul rune for Blood Barrage), water for Ice. Elemental staffs replace the air, fire
and water runes as usual. Each element adds an effect when the spell hits:

- **Smoke** poisons on 1 hit in 8: 2 damage to start, 4 from Blitz and Barrage.
- **Shadow** lowers Attack by 10%, or 15% from Blitz and Barrage, unless it's already lowered.
- **Blood** heals you a quarter of the damage dealt to every target, up to your full hitpoints.
- **Ice** freezes for 8, 16, 24 or 32 ticks (2.4 to 9.6 seconds), half that under Protect from
  Magic. A target that's frozen, or thawed under 5 ticks ago, still takes the damage but isn't
  frozen again. Like Bind, Snare and Entangle, freezes count ticks, so they last half as long in
  real time as in Old School.

The book also has the eight **ancient teleports**, with Old School's levels and runes (two law
runes each, plus the element's). Like any teleport spell they can't be cast above Wilderness level
20, nor while Tele Blocked or within 7.2 seconds of a PvP hit.

| Teleport | Magic | Runes (with 2 law) | Lands at |
|---|---|---|---|
| Paddewwa | 54 | 1 fire, 1 air | Edgeville Dungeon |
| Senntisten | 60 | 1 soul | the Digsite |
| Kharyrll | 66 | 1 blood | Canifis |
| Lassar | 72 | 4 water | Ice Mountain |
| Dareeyak | 78 | 3 fire, 2 air | the ruins, Wilderness level 23 |
| Carrallanger | 84 | 2 soul | the Graveyard of Shadows, Wilderness level 20 |
| Annakarl | 90 | 2 blood | the Demonic Ruins and the Zaros altar, Wilderness level 46 |
| Ghorrock | 96 | 8 water | the Frozen Waste Plateau, Wilderness level 45 |

**Burst and Barrage** also hit everyone else in the 3x3 square around the target, up to 9
targets in all, but only in multi-combat areas, and only players you could attack yourself (in
level range, outside safe areas, without spawn or new-player protection). Each target rolls its
own accuracy and damage, and each counts as an attack, so it can skull you. Against monsters they
hit anything you could attack in the 3x3.

## Spawn protection

For **100 ticks (30 s)** after you respawn, nobody can attack you, so the respawn point can't be
camped. You see "You are protected from other players for a short while." and later "You are no
longer protected from other players." Attacking another player ends your protection immediately.

## New-player protection

A new account can't be attacked for its **first 3 hours of play** (36,000 ticks), so new players
and bots can get started. Each login tells you how many minutes are left. Attacking another player
gives it up for good ("You have given up your new-player protection by attacking."), and it
otherwise ends with "Your new-player protection has worn off." Accounts made before it was added
don't get it.

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
Haunted Mine boss area and Castle Wars. (Falador is also a safe town, so you can't fight there.)

The exact tiles are listed in [`multiway.csv`](server/content/maps/multiway.csv).

## The Wilderness

The Wilderness starts north of the ditch at z 3520 (x 2944-3391), and underground at z 9920. Every
8 tiles north is one more level. It is still the place for big level gaps.

## Logging out

You can't log out for 16 ticks (about 5 seconds here) after combat. The in-game message says 10
seconds, which is what it was at the original game's speed.

## Breaches and sigils

Every **3 hours**, on the hour in UTC (00:00, 03:00, ...), a **breach** opens: a **breach guardian**
(a 750-hitpoint demon) appears at a random multi-combat spot outside the towns, announced to the
whole world **10 minutes** ahead. It leaves after **20 minutes** if nobody kills it. The spots are
Barbarian Village, Al Kharid, the Wizards' Tower, the gnome battlefield, the Dark Warriors'
Fortress (level 15 Wilderness) and the bandit camp (level 23 Wilderness). Everyone fighting it is
fair game for everyone else.

When the guardian dies, everyone who damaged it earns **breach points**: one per 5 damage, up to
50. The player who dealt the most damage always gets a **sigil**, and anyone else who dealt at
least 5% of its hitpoints has a 1 in 5 chance of one. The **breach warden** in Lumbridge castle's
courtyard trades points for 10 sharks (8 points), 3 prayer potions (10) or a random sigil (60).
[`/api/breach`](https://pvp-sdk.fly.dev/api/breach) says when the next one opens and where.

Everyone who damaged the guardian also has a small chance of a 2005 PvP weapon, which no shop
sells: **1%** for an **abyssal whip**, otherwise **2%** for a **granite maul**. The world is told
who found one.

A sigil works while it's in your inventory, and two of a kind don't add up. Sigils can't be
traded, and **dying destroys them**.

| Sigil | While you carry it |
|---|---|
| Fury | Your melee max hit is 10% higher |
| Stone | Other players hit you 10% softer |
| The feast | Food heals half as much again |
| Escape | The teleport lock after a PvP hit is halved (12 ticks) |
| Fortune | Breaches pay half as many points again |

## Seasons

The world runs in **seasons**. When a new season starts, every character starts over on Tutorial
Island: stats, items, bank, Bank keys and safe deposit box all reset; your account and password
stay. Each season has its own hiscores, and past seasons' boards stay up.

## Fair play

From Season 1 (1 November 2026; until then the server is an open beta that anyone can join), each player, one person with an invite code from the server owner, gets **5 bots per season**. Bots are made
on [`/account`](https://pvp-sdk.fly.dev/account) or with `bun bots/create-bot.ts` and the
player's API key; a name no longer becomes an account by logging in. Only bots in a player's
slots can log in, and a slot stays used for the whole season. Accounts from before fair play
are claimed with their password. [`docs/FAIR_PLAY.md`](docs/FAIR_PLAY.md) has the details and
the reasons for each rule.

## PvP hiscores

[`/hiscores/pvp`](https://pvp-sdk.fly.dev/hiscores/pvp) ranks kills, deaths, K/D, the best run of
kills between deaths, and loot (what your victims risked) for today, this week and all time. A
kill counts only when:

- the victim risked at least 1,000 gp (what they carried, the Bank keys they held, and their 10
  most valuable bank stacks if they were skulled);
- the two players come from different addresses;
- the same two players haven't had a counted kill, either way, in the last hour.

Every counted kill is announced to the whole world.

## Server messages

When the server refuses an attack it says why. `bot.attack()` and `bot.castSpell()` return these
messages with `reason: 'not_attackable'` (or `'already_in_combat'` for the single-combat lock):

| Message | Meaning |
|---|---|
| That player is in a safe area. | The target is in a safe area |
| You can't attack other players from a safe area. | You are in a safe area |
| That player has just respawned and is protected. | Spawn protection |
| That player is new and protected for now. | New-player protection |
| Your level difference is too great! | Outside the combat-level range |
| I'm already under attack. | Single-combat: someone else is fighting you |
| Someone else is already fighting your opponent. | Single-combat: your target is busy |

Other messages to watch for:

| Message | Meaning |
|---|---|
| The guards attack you for bringing a skull into a safe area! | Leave the safe area now |
| You can't teleport so soon after fighting another player. | Teleport lock |
| You take a bank key from your victim. | You killed a skulled player (or a key holder) |
| *Name* has killed *Name*, who risked *N* gp. | A counted kill, announced to everyone |
| You can't open a bank key while you're skulled. / Bank keys can only be opened in a safe area. | Wait, or move |

## Other server settings

- Fast XP: 25x rate on a flatter level curve.
- Unlimited run energy.
- No random events.
- Members content is enabled.

Strategy tips for bots are in [`learnings/pvp.md`](learnings/pvp.md). Planned changes are in
[`docs/PVP_PLAN.md`](docs/PVP_PLAN.md).
