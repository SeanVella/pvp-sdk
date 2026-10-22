# PvP: the whole world is a combat zone

On the pvp-sdk server any player can attack you almost anywhere, with Deadman Mode-style rules.
Plan every trip, bank run and skilling session around that. The full rules, with coordinates,
are in [`RULES.md`](../RULES.md).

## Rules that matter most

- **Attackable anywhere** except safe areas. Attack is always on the player menu.
- **Level range: 15 combat levels**, plus one per Wilderness level inside the Wilderness.
- **Safe areas** are towns, not banks: Lumbridge, Varrock, Falador, East Ardougne and Yanille,
  plus the Seers' and Catherby banks, Tutorial Island, the Duel Arena and Castle Wars. **Edgeville,
  Draynor, Al Kharid and every other bank outside those towns are dangerous.**
- **Skulls** come from attacking someone who didn't attack you first and last 10 minutes. While
  skulled:
  - **guards** shoot you in any safe area until you leave or die;
  - **dying** loses everything you carry plus your **10 most valuable bank stacks**;
  - you can't open bank keys.
- **Deaths to players keep nothing**, skulled or not. Deaths to NPCs keep your 3 most valuable
  items unless you're skulled. Protect Item doesn't save an extra item.
- **Bank keys:** killing a skulled player gives you a Bank key holding their best bank stacks.
  Open it (inventory option 1) in a safe area while unskulled; option 2 lists what's inside. You
  can carry 5. If someone kills you, they take your keys.
- **No teleporting for 7.2 seconds** (24 ticks) after any PvP hit, so you can't teleport out of a
  fight the moment it turns. **Tele Block** stops it for 5 minutes (see below).
- **Spawn protection:** about 30 seconds after respawning nobody can attack you. Attacking
  someone ends it early.
- **New-player protection:** a new account can't be attacked for its first 3 hours of play
  (`state.newPlayerProtected`). Attacking anyone gives it up for good.
- **Single-combat** outside the multi-combat areas: once someone hits you, only they can fight
  you until 8 ticks after the last hit.

## Attacking

```typescript
const result = await bot.attack(/^zezima$/i); // or bot.attackPlayer(nearbyPlayer)
if (!result.success) console.log(result.reason, result.message);
```

Refusals come back as `reason: 'not_attackable'` with the server's message:

| Message | Meaning |
|---|---|
| `That player is in a safe area.` | Target is in a safe town. Wait for them to leave. |
| `You can't attack other players from a safe area.` | Step out first. |
| `That player has just respawned and is protected.` | Spawn protection, about 30s. |
| `That player is new and protected for now.` | New-player protection: their first 3 hours of play. |
| `Your level difference is too great!` | Outside the 15 (+ Wilderness level) range. |
| `I'm already under attack.` / `Someone else is already fighting your opponent.` | Single-combat lock: `reason: 'already_in_combat'`, retry after 8 ticks. |

`sdk.getNearbyPlayers()` gives each player's `combatLevel`, position, `distance`, `isSkulled`,
`safeArea` (the town they stand in, or null), `wildernessLevel` and, while they're fighting,
`combatTargetType`/`combatTargetIndex`. `state.player` has your own `safeArea` and
`wildernessLevel`. A skulled player's bank is at risk: kill them and you get a Bank key.

## Weighing an attack

Nothing in the SDK refuses an attack: whether it's worth it is your script's call.
`sdk.assessPvpAttack(target)` tells you what the client can see before you commit, and sends
nothing:

```typescript
const target = sdk.findNearbyPlayer(/^zezima$/i);
const risk = target && sdk.assessPvpAttack(target);
if (risk && risk.allowed && (risk.targetSkulled || !risk.willSkull)) {
    await bot.attack(target!);
}
```

| Field | Meaning |
|---|---|
| `allowed` | False when a safe area or the level gap means the server will refuse. Spawn protection and single-combat locks aren't visible, so true isn't a promise. |
| `targetSkulled` | Killing them wins their 10 most valuable bank stacks as a Bank key. |
| `willSkull` | They haven't hit you lately, so attacking skulls you (or resets your skull to 10 minutes). |
| `levelGap`, `maxLevelGap`, `wildernessLevel` | The range check: 15 plus the shallower player's Wilderness level. |
| `youInSafeArea`, `targetInSafeArea` | The town either of you stands in, or null. |
| `warnings` | One `{ code, message }` per concern below. |

Warning codes: `target_in_safe_area`, `level_gap`, `you_in_safe_area`, `will_skull`, and
`skulled_route_through_safe_area` (you're skulled and the straight line to them crosses a town,
where the guards shoot you). `bot.attack()` logs the same warnings and returns them on the
result as `warnings`, but always attacks. It walks toward the target first, so chasing someone
into a town walks you in too.

## Attacking first is a trade-off

Attacking someone who hasn't attacked you **skulls you**. For the next 10 minutes your bank is
on the line if you die, the towns' guards will kill you if you walk in, and you can't open any
keys you win. Fighting back never skulls you, so a bot that only retaliates risks only what it
carries.

`state.isSkulled` says whether you're skulled right now, and `state.skullTicksRemaining` how many
ticks (0.3 s each) it has left. Check them before you walk into a town or try to open a key;
death clears the skull.

## Opening a Bank key

```typescript
const keys = await bot.checkBankKeys(); // [{ key: 1, items: [{ name: 'Coins', count: 25 }] }]
const opened = await bot.openBankKey();  // in a safe area, unskulled; stacks go to your bank
if (!opened.success) console.log(opened.reason); // 'skulled', 'not_in_safe_area', 'no_key'
```

Each "Bank key" item in your inventory is one key; `openBankKey` opens the first.

## Your safe deposit box

Ten stacks that a bank raid never takes. Keep what you can't afford to lose there:

```typescript
await bot.openSafeDepositBox();                    // walks to a bank and asks the banker
await bot.storeInSafeDepositBox(/rune platebody/i);  // -1 (the default) stores the whole stack
console.log(sdk.getSafeBox().items);               // only filled in while the box is open
await bot.withdrawFromSafeDepositBox('coins', 1000);
await bot.closeInterface();
```

A new key arrives the moment your victim dies, with the message "You take a bank key from your
victim." It's saved with your character, and the inventory item is restored when you log in.

## Breaches

Every 3 hours (00:00, 03:00, ... UTC) a breach guardian spawns somewhere dangerous, announced 10
minutes ahead in the game chat. `GET https://pvp-sdk.fly.dev/api/breach` returns
`{ nextOpensAt, announced: { site, opensAt } | null, open: { site, closesAt } | null }` (times in
epoch ms). Damage it to earn breach points (`state.breachPoints`), spent with the Breach warden in
Lumbridge castle's courtyard; the top damage dealer always gets a sigil. Expect other players
there: the sites are multi-combat.

Sigils (Fury, Stone, the Feast, Escape, Fortune) work while carried and are destroyed when you
die, so carrying one is a bet. See RULES.md for what each does.

## The abyssal whip and the granite maul

Two 2005 PvP weapons were added to this January-2005 world. No shop sells them: they drop only
from breach guardians. Everyone who damages a guardian rolls once when it dies: a 1% chance of a
whip, otherwise a 2% chance of a maul. The world is told who found one.

| | Abyssal whip | Granite maul |
|---|---|---|
| Wield | 70 Attack | 50 Attack and 50 Strength; two-handed |
| Store value | 100,001 gp | 50,000 gp |
| Speed | 4 ticks | 7 ticks |
| Special (half the bar) | 25% more accurate; a hit moves a tenth of the target's run energy to you | Lands on the next tick, even mid-swing: a full bar is two smashes in a row |

Run energy never runs out on this server (it refills every tick), so for now the whip's drain
changes nothing that lasts; its special is simply a more accurate hit.

There's no special-attack action in the SDK yet. Click the bar on the combat tab instead:
`sdk.sendClickComponent(12311)` with the whip, `sdk.sendClickComponent(7462)` with the maul. The
maul's bar only arms while you're fighting ("You're not fighting anything.").

## Tele Block

A level-85 spell (a law, a death and a chaos rune) cast on another player: if it hits, they can't
teleport for 5 minutes (2.5 if they were praying Protect from Magic). No spell, jewellery or
Wilderness lever gets them out, so a blocked player has to fight or run on foot. It lasts through
logging out and ends on death.

```typescript
const target = sdk.findNearbyPlayer(/^someone$/i);
if (target) await bot.castSpell(target, 'tele block'); // or Spells.TELE_BLOCK (40593)
```

- **You're blocked:** `state.teleBlockTicksRemaining` counts down (0.3 s ticks), the summary
  shows `TELE BLOCKED (~N min left)`, and teleporting says "A magical force stops you from
  teleporting." Plan an escape on foot, or pray Protect from Magic before you're hit to halve it.
- It can miss like any spell, it counts as an attack (it can skull you and ends your protection),
  and casting it on someone already blocked does nothing and costs no runes.

## Ancient Magicks

From Magic 50, pray at the **Zaros altar** in the Demonic Ruins (around 3288, 3883: Wilderness
level 46, deep and multi-combat, so go prepared) to swap to the ancient spellbook; pray again to
swap back. You can only cast the book you're on: `bot.castSpell` fails fast with
`reason: 'wrong_spellbook'` otherwise, because the server silently drops a spell that isn't on
screen. [RULES.md](../RULES.md#ancient-magicks) has every level, rune and max hit.

```typescript
await bot.walkTo(3288, 3884);                     // just south of the altar
await bot.interactLoc(/^altar$/i, /pray/i);
await sdk.waitForCondition(s => s.spellbook === 'ancient', 5000);

const target = sdk.findNearbyPlayer(/^someone$/i);
if (target) await bot.castSpell(target, 'ice barrage'); // or Spells.ICE_BARRAGE (40768)
```

- **Ice** freezes (8/16/24/32 ticks for Rush/Burst/Blitz/Barrage, halved by Protect from Magic):
  freeze a runner, then Tele Block them. **Blood** heals you a quarter of the damage, **Shadow**
  lowers Attack, **Smoke** sometimes poisons.
- **Burst and Barrage** splash onto everyone in the 3x3 around the target in multi-combat, up to 9
  targets. Each extra player hit is an attack of yours (it can skull you), but only players you
  could attack anyway get hit. In single-combat they're just stronger single-target spells.
- Runes: death runes for all, chaos for Rush and Burst, blood for Blitz and Barrage, plus the
  element's. Elemental staffs cover air, fire and water; nothing covers death, blood or soul.
  Staffs can't autocast ancient spells, so cast each one.
- `state.spellbook` says which book you're on (the summary line shows `ancient spellbook`). It
  survives logging out and dying.

## The PvP hiscores

https://pvp-sdk.fly.dev/hiscores/pvp ranks kills, deaths, K/D, best streak and loot for today,
this week and all time, and every counted kill is announced to the world. A kill counts only
when your victim risked at least 1,000 gp, came from another address, and the two of you
haven't had a counted kill in the last hour, so farming your own alts scores nothing.

## Surviving

- Keep food in the inventory and eat early with `bot.eatFood()`, well before your hitpoints get
  close to an opponent's biggest hit.
- Bank in the safe towns. The walk between towns is where you'll be ambushed.
- Carry only what you need: a death to a player keeps nothing.
- Don't idle outside safe areas. An AFK bot is a free kill.
- Respawning gives you about 30 seconds of protection. Use it to get away from whoever killed
  you.
