# PvP: the whole world is a combat zone

On the pvp-sdk server any player can attack you almost anywhere, not just in the
Wilderness. Plan every trip, bank run and skilling session around that.

## Rules

- **Attackable anywhere** except safe areas. Attack is always on the player menu.
- **Level range: 15 combat levels**, plus one per Wilderness level inside the
  Wilderness (the shallower of the two players counts). Outside the range the
  server answers "Your level difference is too great!".
- **Safe areas** (nobody attacks into or out of them): every bank interior,
  Lumbridge castle and its courtyard (where everyone respawns), Tutorial Island,
  the Duel Arena compound and Castle Wars.
- **Spawn protection:** about 30 seconds (100 ticks) after respawning nobody can
  attack you. Attacking someone ends it early. Messages: "You are protected from
  other players for a short while." / "You are no longer protected from other players."
- **Death:** keep your 3 most valuable items (4 with Protect Item), none if you are
  skulled; the rest drops for the killer. You respawn in Lumbridge at full health.
- **Skull:** attacking someone who didn't attack you first skulls you for about 10
  minutes (2000 ticks). Skulled deaths keep nothing.
- **Single-combat** everywhere except the multi-combat areas (Falador, Barbarian
  Village, Al Kharid, much of the Wilderness, ...): once someone hits you, only they
  can fight you for 8 ticks, and you can't attack anyone else.
- **Logging out** is blocked for 10 seconds after combat.

## Attacking

```typescript
const result = await bot.attack(/^zezima$/i); // or bot.attackPlayer(nearbyPlayer)
if (!result.success) console.log(result.reason, result.message);
```

Refusals come back as `reason: 'not_attackable'` with the server's message:

| Message | Meaning |
|---|---|
| `That player is in a safe area.` | Target is in a bank, Lumbridge castle, etc. Wait for them to leave. |
| `You can't attack other players from a safe area.` | Step out first. |
| `That player has just respawned and is protected.` | Spawn protection, about 30s. |
| `Your level difference is too great!` | Outside the 15 (+ Wilderness level) range. |
| `I'm already under attack.` / `Someone else is already fighting your opponent.` | Single-combat lock: `reason: 'already_in_combat'`, retry after 8 ticks. |

`sdk.getNearbyPlayers()` gives each player's `combatLevel`, position, `distance`
and, while they are fighting, `combatTargetType`/`combatTargetIndex`. Check the
level gap before you commit to a target.

## Surviving

- Keep food in the inventory and eat early with `bot.eatFood()`, well before your
  hitpoints get close to an opponent's biggest hit.
- Protect Item (prayer level 25) keeps a fourth item.
- Bank often. Banks are safe, so the walk to and from them is where you'll be
  ambushed.
- Don't idle outside safe areas. An AFK bot is a free kill.
- Respawning gives you about 30 seconds of protection. Use it to get away from
  whoever killed you, or to reach a bank.
