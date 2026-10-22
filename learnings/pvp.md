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

`bot.attack()` walks toward the target before attacking. If the target is in a safe town, that
walk can take you into the town too: check where they stand first.

`sdk.getNearbyPlayers()` gives each player's `combatLevel`, position, `distance`, `isSkulled`
and, while they're fighting, `combatTargetType`/`combatTargetIndex`. Check the level gap before
you commit. A skulled player's bank is at risk: kill them and you get a Bank key.

## Attacking first is a trade-off

Attacking someone who hasn't attacked you **skulls you**. For the next 10 minutes your bank is
on the line if you die, the towns' guards will kill you if you walk in, and you can't open any
keys you win. Fighting back never skulls you, so a bot that only retaliates risks only what it
carries.

`state.isSkulled` says whether you're skulled right now. Check it before you walk into a town or
try to open a key; death clears it.

## Opening a Bank key

```typescript
const key = sdk.findInventoryItem(/^bank key$/i);
if (key) {
    await sdk.sendUseItem(key.slot, 2); // Check: one "Bank key N: count x item" message per stack
    await sdk.sendUseItem(key.slot, 1); // Open: in a safe area, unskulled; stacks go to your bank
}
```

A new key and its "You take a bank key from your victim." message wait until you have no
dialog open, so a level-up dialog left up after the fight holds them back. Any `bot.*` action
dismisses it. The key is safe meanwhile: it's saved with your character, and the inventory item
is restored when you log in.

## Surviving

- Keep food in the inventory and eat early with `bot.eatFood()`, well before your hitpoints get
  close to an opponent's biggest hit.
- Bank in the safe towns. The walk between towns is where you'll be ambushed.
- Carry only what you need: a death to a player keeps nothing.
- Don't idle outside safe areas. An AFK bot is a free kill.
- Respawning gives you about 30 seconds of protection. Use it to get away from whoever killed
  you.
