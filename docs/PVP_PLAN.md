# PvP SDK: plan

A public, always-on server where **the whole world is PvP**, for AI coding agents (and the
people steering them) to write bots that fight, survive and profit. It is a fork of
[rs-sdk](https://github.com/MaxBittker/rs-sdk) and stays mergeable with it: the game-mode
changes live in a handful of content scripts, listed in `server/PATCHES.md` under "PvP world".

- Server: <https://pvp-sdk.fly.dev> (Fly app `pvp-sdk`, region `iad`)
- Repo: <https://github.com/SeanVella/pvp-sdk>, default branch `pvp-world` (`upstream` =
  MaxBittker/rs-sdk; merge `upstream/main` into `pvp-world` to sync)
- Player-facing rules: [`RULES.md`](../RULES.md)

## The rules (v1)

| | |
|---|---|
| **Where** | Anywhere except safe areas. Attack is on every player's menu. |
| **Who** | Anyone within **15 combat levels**. Inside the Wilderness each level widens that by one (15 + level, using the shallower of the two players), so deep Wilderness is still where big level gaps meet. |
| **Safe areas** | Banks (the `bank_zones` table), Lumbridge castle and courtyard (the respawn point), Tutorial Island, the Duel Arena compound and Castle Wars. Nobody attacks into or out of them. Duels and Castle Wars games keep their own rules between players inside them. |
| **Spawn protection** | 100 ticks (30s at the 300ms production tick) after respawning, nobody can attack you. Attacking someone ends it early. |
| **Death** | Unchanged RS rules: keep your 3 most valuable items (+1 with Protect Item), none when skulled; everything else drops for the killer. Respawn in Lumbridge **at full health** (upstream rs-sdk respawns PvP deaths at 1 HP; in an all-PvP world that meant long regen waits after every death). |
| **Skulls** | Attack someone who didn't attack you first and you're skulled for 2000 ticks (10 min). |
| **Multi-combat** | The original multi areas (Falador, Barbarian Village, Al Kharid, much of the Wilderness, ...). Everywhere else is single-combat: one opponent at a time, an 8-tick lock after each hit. |
| **Wilderness** | Teleport limits (level 20, glory 30) and the ditch warning are unchanged. |

All of it is decided in RuneScript. `~pvp_level_check` in
`server/content/scripts/skill_combat/scripts/pvp/pvp_combat.rs2` is the single gate for every
attack and combat spell outside the minigames, and `server/content/scripts/pvp_world/` holds the
tunables (`^pvp_combat_range`, `^pvp_protection_duration`, the safe-zone table). The engine
never checks that a player's Attack option is set, so the menu is cosmetic and the script
checks are the real protection.

Tests: `server/engine/test/pvp-world.test.ts` runs the compiled rules against in-memory
players (level ranges, safe areas, protection). `sdk/test/pvp-targeting.test.ts` checks that
the SDK reports every refusal as `not_attackable` instead of a silent no-op. The rules were
also verified end to end on a local engine with two lite-client bots: refusals in and out of
Lumbridge castle, an attack in the open, a fight to the death, a full-health respawn with
protection that blocks the killer, and protection running out.

### Decisions taken for v1 (cheap to change)

- **Range 15**, the Old School PvP-world convention. One constant.
- **Banks are safe.** Bots have to bank to function; unsafe banks would make every bank a
  killing floor. Remove the `bank_zones` line in `~pvp_in_safe_zone` to flip it.
- **Full-health respawn** plus 30s spawn protection instead of upstream's 1 HP respawn.
- **No login protection.** Logging out still waits out the usual 10s combat timer.
- **Machine:** shared-cpu-2x / 2 GB. Fly refuses performance VMs for this org until billing
  unlocks them; then `fly scale vm performance-1x --memory 2048 -a pvp-sdk`.
- **IPs:** shared IPv4 + IPv6 (free). The direct gateway on :7443 works over the shared IPv4
  (TLS/SNI). Only the raw Java-client port 43594 would need a dedicated IPv4 ($2/mo).

## Roadmap

### 1. PvP everywhere (branch `pvp-world`)

- [x] Fly app with a volume, daily snapshots and an always-on single machine. Two deploy
      fixes: `.dockerignore` moved to the repo root (Fly's builder ignored `ignorefile` and
      uploaded `.git` and host `node_modules`), and `.gitattributes` keeps the Dockerfile LF
      (a CRLF checkout made the entrypoint crash-loop).
- [x] World rules above, with compiled-script tests.
- [x] SDK: new refusal messages, docs, default server and direct gateway repointed to
      `pvp-sdk.fly.dev`; web UI links point at this repo. `bot.attack()` no longer reports a
      refused PvP attack as success just because the server turned us toward the target.
- [x] Fix upstream CI break (`NearbyPlayer` combat-target fields missing from the webclient type).
- [x] Deploy the rules to pvp-sdk.fly.dev and smoke-test with two bots there (safe-zone
      refusals and an attack in the open, through the direct gateway on :7443).
- [ ] **Add a payment method to the Fly account** (<https://fly.io/trial>). The org is on the
      trial: Fly stops machines after 5 minutes ("Trial machine stopping") and refuses
      performance VMs, so the world can't stay up until then.
- [x] `pvp-world` is the repo's default branch, with the full rules in `RULES.md`.
- [ ] `bun run test` on Windows: 13 webclient tests fail with `document is not defined`
      (`graphics/Jpeg.ts` loads before the DOM shim when every file shares one process).
      Pre-existing upstream, and the same files pass on their own; check CI on Linux before
      changing test setup.

### 2. Fair play and public-server hardening (before announcing)

- [ ] **Hide live positions.** `/playerpositions` (every player's name and coordinates, every
      second; feeds `/mapview`), `/playertraces` and the gateway's unauthenticated
      `/status/:bot` (any bot's live coordinates) are free targeting data in a PvP world. Put
      them behind an env flag that defaults off here.
- [ ] **Hide carried risk.** `/hiscores/outfit` shows everyone's worn gear and value;
      `/hiscores/bank` has item search over every bank. Disable or delay both.
- [ ] **Close `/api/screenshot`** (unauthenticated writes, served back publicly).
- [ ] **Throttle account creation.** Any unused name logs in and becomes an account, including
      through the gateway's HTTP API, with no rate limit, no IP-ban check on `sdk_auth` and no
      password rules there. Add per-IP limits and the same name/password rules on every path;
      set `BANNED_USERNAME_WORDS`; give login rate limits their own env flag instead of
      `NODE_PRODUCTION` (which also removes the tutorial skip bots rely on).
- [ ] Lower `MAX_PLAYERS_PER_IP` (100 today) to slow alt farms. This is a trade-off, since
      agent developers legitimately run fleets.
- [ ] `LOGGER_SERVER=true` so PvP loot events and abuse reports are kept (watch DB growth).
- [ ] Decide `NODE_DEBUG=true`: it disables idle logout, so AFK bots stay in the world as targets.
- [ ] Staff: make moderators at `staffmodlevel` 2 via SQLite on the volume. Never 3+ (item
      spawning works on any world).
- [ ] The RSA private key is committed and port 43594 is plain TCP: rotate the key (client
      modulus too) or drop that service. Web and bot traffic already rides TLS.
- [ ] Performance VM once unlocked; alerting on machine restarts.

### 3. PvP telemetry and leaderboards

- [ ] `pvp_kill` event, cloned from the runite leaderboard pipeline: content command in
      `death.rs2` (victim = active player, killer = `findhero`) → engine opcode 10012 → logger
      relay → `pvp_kill` table (both prisma schemas) → `/hiscores/pvp` with kills, deaths, K/D,
      best streak and loot value over 24h / 7d / all time.
- [ ] Anti-farming: count a kill only when killer and victim IPs differ, the same pair hasn't
      traded kills recently, and the victim risked something.
- [ ] Kill feed: world message and world-feed events for spectators (rs-world).

### 4. SDK for PvP agents

- [ ] State: other players' HP, head icons (skull, overhead prayers), worn equipment and
      animation; our own slot (to tell who is attacking us), multi-combat flag, wilderness
      level, spawn protection (`pvp_protection` varp, already transmitted), special-attack
      energy. Fix `isSkulled`: it reads varp 78, which the server never transmits; use the
      skull head-icon bit.
- [ ] Actions: follow, special-attack toggle, auto-retaliate and run toggles, item-on-player,
      autocast, a same-tick gear + prayer switch, and attacking without a full `walkTo` first.
      Safe-zone awareness: `bot.attack()` walks toward the target before attacking, so chasing
      someone into a bank walks you into the bank too; publish whether each player stands in a
      safe area and refuse client-side.
      Add snare, entangle, god spells and Iban's blast to the spell table.
- [ ] Reflexes: per-tick eat / pray / switch / attack-player inside the lite runner, so fights
      don't wait on an LLM turn (a draft of NPC reflexes exists in the sibling rs-sdk checkout).
- [ ] Docs and examples: `learnings/pvp.md` for agents, example bots (hunter, survivor).

### 5. Game design iterations

- [ ] Combat lock: no safe-area entry, teleport or logout for ~10s after PvP damage, so a
      fight can't be dodged by stepping into a bank.
- [ ] Teleport rules outside the Wilderness; respawn kit; bounty targets; PvP XP bonus.

## Operating the server

```sh
fly deploy -a pvp-sdk                  # from the repo root; builds remotely
fly logs -a pvp-sdk                    # live logs
fly ssh console -a pvp-sdk             # shell; data lives on /opt/server/data
fly status -a pvp-sdk
fly scale vm performance-1x --memory 2048 -a pvp-sdk
```

Make a moderator (then relog): `fly ssh console -a pvp-sdk -C "sqlite3 /opt/server/data/db.sqlite \"UPDATE account SET staffmodlevel=2 WHERE username='name'\""`.

Upstream sync: `git fetch upstream && git merge upstream/main`, then walk `server/PATCHES.md`
(including the PvP section) and run `bun run check`.
