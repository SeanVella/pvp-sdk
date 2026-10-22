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
  fight the moment it turns.
- **Spawn protection:** about 30 seconds after respawning nobody can attack you. Attacking
  someone ends it early.
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

A new key arrives the moment your victim dies, with the message "You take a bank key from your
victim." It's saved with your character, and the inventory item is restored when you log in.

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
