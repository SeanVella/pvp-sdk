# PvP SDK: plan

A public, always-on server where **the whole world is PvP**, for AI coding agents (and the
people steering them) to write bots that fight, survive and profit. It is a fork of
[rs-sdk](https://github.com/MaxBittker/rs-sdk) and stays mergeable with it: the game-mode
changes live in a handful of content scripts, listed in `server/PATCHES.md` under "PvP world".

- Server: <https://pvp-sdk.fly.dev> (Fly app `pvp-sdk`, region `iad`)
- Repo: <https://github.com/SeanVella/pvp-sdk>, default branch `pvp-world` (`upstream` =
  MaxBittker/rs-sdk; merge `upstream/main` into `pvp-world` to sync)
- Player-facing rules: [`RULES.md`](../RULES.md)

## The rules (v2: Deadman Mode)

v2 models the rules on Old School RuneScape's Deadman Mode; [`DEADMAN.md`](DEADMAN.md) maps
every DMM mechanic to what we did with it.

| | |
|---|---|
| **Where** | Anywhere except safe areas. Attack is on every player's menu. |
| **Who** | Anyone within **15 combat levels**. Inside the Wilderness each level widens that by one (15 + level, using the shallower of the two players), so deep Wilderness is still where big level gaps meet. |
| **Safe areas** | DMM-style guarded towns: Lumbridge (the respawn point), Varrock, Falador, East Ardougne and Yanille, plus the Seers' and Catherby banks; also Tutorial Island, the Duel Arena compound and Castle Wars. Nobody attacks into or out of them. Banks elsewhere (Edgeville, Draynor, ...) are not safe. |
| **Guards** | A skulled player in a safe area is shot every 2 ticks: a fifth of their base hitpoints, then 2 more each hit, until they leave or die. |
| **Death** | A death to a player keeps nothing. A death to an NPC keeps the 3 most valuable items, or nothing when skulled. Protect Item adds nothing. Respawn in Lumbridge **at full health** with 100 ticks (30 s) of spawn protection, which attacking ends early. |
| **Bank keys** | Dying skulled moves the 10 most valuable tradeable bank stacks into a Bank key for the killer, or onto the floor if no player gets the credit. Keys open in a safe area while unskulled; at most 5 carried; killing a holder takes their keys. |
| **Skulls** | Attack someone who didn't attack you first and you're skulled for 2000 ticks (10 min). The timer survives logout, except that a skull saved before the safe zones last grew (`^dmm_rules_version`) is cleared at the next login. |
| **Teleport lock** | No teleports for 24 ticks (7.2 s) after any PvP hit, dealt or taken. |
| **Multi-combat** | The original multi areas (Falador, Barbarian Village, Al Kharid, much of the Wilderness, ...). Everywhere else is single-combat: one opponent at a time, an 8-tick lock after each hit. |
| **Wilderness** | Teleport limits (level 20, glory 30) and the ditch warning are unchanged. |

All of it is decided in RuneScript. `~pvp_level_check` in
`server/content/scripts/skill_combat/scripts/pvp/pvp_combat.rs2` is the single gate for every
attack and combat spell outside the minigames, and `server/content/scripts/pvp_world/` holds the
rest: tunables in `pvp_world.constant`, the safe towns, guards, teleport lock and bank keys. The
engine never checks that a player's Attack option is set, so the menu is cosmetic and the script
checks are the real protection.

Tests: `server/engine/test/pvp-world.test.ts` runs the compiled rules against in-memory players
(level ranges, safe towns, protection, guard damage, teleport lock, bank raids, key theft and
overflow, and the login skull migration through a real save round trip). `sdk/test/pvp-targeting.test.ts` checks that the SDK reports every refusal as
`not_attackable` instead of a silent no-op. End-to-end runs on a local engine with lite-client
bots covered refusals, a fight to the death, the full-health respawn with protection, and the
Deadman flow: skull, guards killing the skulled attacker, a key for the killer with the victim's
coins, and the key opened in town. The same Deadman flow was run on the live server after the
v2 deploy (2026-10-22).

### Decisions taken (cheap to change)

- **Range 15**, the Old School PvP-world convention, instead of DMM's fixed bracket worlds.
- **Safe towns, not banks** (v2, DMM). v1 made every bank safe; DMM keeps banks outside guarded
  towns dangerous.
- **Bank keys take 10 stacks**, valued at store price (DMM used 28, then 10; it valued by GE
  price, which this game doesn't have).
- **Full-health respawn** plus 30s spawn protection instead of upstream's 1 HP respawn.
- **Skull stays 10 minutes**, with no stacking, and the single-combat lock stays at 8 ticks (DMM
  varied 5-30 min and 16-24 ticks). Both are one constant each.
- **No XP loss on death.** Classic DMM had it; DMM since 2023 doesn't.
- **No login protection.** Logging out still waits out the usual combat timer.
- **Skull and XP rules stay** (owner, 2026-10-22): no Deadman skull tuning, no XP loss.
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
- [x] v2 Deadman Mode rules: guarded towns, guards, lose-everything PvP deaths, bank keys and
      the teleport lock ([`DEADMAN.md`](DEADMAN.md)). Fixed a race in the pack tool's
      `SourceSnapshot` that sometimes left new configs unregistered until something else changed.
- [ ] `bun run test` on Windows: 13 webclient tests fail with `document is not defined`
      (`graphics/Jpeg.ts` loads before the DOM shim when every file shares one process).
      Pre-existing upstream, and the same files pass on their own; check CI on Linux before
      changing test setup.

### 2. Fair play and public-server hardening (before announcing)

- [x] **Hide live positions** (owner-only, see "Owner access" below): `/playerpositions`,
      `/playertraces`, the gateway's bot list (`/`, `/status`), and the position and sessions
      in `/status/:bot`, which players still get for their own bot with its password.
- [x] **Hide carried risk** (owner-only): `/hiscores/outfit` and `/hiscores/bank`, and their
      sidebar links are gone.
- [x] **Close `/api/screenshot`** and `/screenshots` (owner-only).
- [ ] **Throttle account creation.** Done: every auto-registration (game login and the
      gateway's `sdk_auth`) is capped per IP and overall (`REGISTRATIONS_PER_IP_PER_HOUR` 10,
      `REGISTRATIONS_PER_HOUR` 200), and `sdk_auth` now checks IP bans. Still open: the same
      name/password rules on the gateway path, `BANNED_USERNAME_WORDS`, and login rate limits
      on their own env flag instead of `NODE_PRODUCTION` (which also removes the tutorial skip
      bots rely on).
- [x] **Fair play: 5 bots per player per season** ([`FAIR_PLAY.md`](FAIR_PLAY.md)). A player
      is one person with an invite code the owner makes on `/account/invites` (the owner's choice
      on 2026-10-22, after Twilio's compliance profile held up phone sign-up). Phone sign-up is
      still built in, behind `PLAYER_SIGNUP=phone`. The server makes each account in a slot
      (`/account`, or `create-bot.ts` with `PVP_SDK_KEY`), slots never come back within a
      season, old accounts are claimed with their password, the owner can disable a player, and
      unslotted logins are refused. **Owner to do:** make invites (yourself first), then set
      `PLAYER_ACCOUNTS = "true"` and deploy. Still open: owner-only flags for bots of different
      players sharing an address, one-way trades and farmed kills.
      With fair play on, the registration caps above no longer apply: nothing registers itself.
- [ ] Lower `MAX_PLAYERS_PER_IP` (100 today) to slow alt farms. This is a trade-off, since
      agent developers legitimately run fleets.
- [ ] `LOGGER_SERVER=true` so PvP loot events and abuse reports are kept (watch DB growth).
- [ ] Decide `NODE_DEBUG=true`: it disables idle logout, so AFK bots stay in the world as targets.
- [ ] Staff: make moderators at `staffmodlevel` 2 via SQLite on the volume. Never 3+ (item
      spawning works on any world).
- [x] The RSA private key is committed, so plain-TCP port 43594 exposed passwords: that Fly
      service is gone. Every web and bot client already rides TLS. (The Java applet page,
      served only with `NODE_DEBUG`, can't connect any more.)
- [ ] Performance VM once unlocked; alerting on machine restarts.

### 3. PvP telemetry and leaderboards

- [x] `pvp_kill` event: the `pvp_kill` command in `death.rs2` (before the loot moves) → opcode
      10012 → `World.notifyPvpKill` → logger relay → `pvp_kill` table (both prisma schemas) →
      `/hiscores/pvp` with kills, deaths, K/D, best streak and loot (what the victims risked:
      carried, keys held, and the 10 best bank stacks when skulled) for today / this week /
      all time. Every death to a player is stored; `counted` marks the ones that score.
- [x] Anti-farming (`engine/pvp/PvpKills.ts`): a kill counts only when the two players' IPs
      differ, the victim risked at least `PVP_KILL_MIN_RISK` gp (1000), and the same pair
      hasn't had a counted kill either way in the last hour (in memory, so a restart forgets).
- [x] Kill feed: a world message for each counted kill. Still open: world-feed events for
      spectators (rs-world), and a public JSON feed for bots.

### 4. SDK for PvP agents

- [ ] State: other players' HP, head icons (skull, overhead prayers), worn equipment and
      animation; our own slot (to tell who is attacking us), multi-combat flag, wilderness
      level, spawn protection (`pvp_protection` varp, already transmitted), special-attack
      energy. (Done: `isSkulled` reads the skull head-icon bit; it used to read varp 78,
      which the server never transmits.)
- [ ] Actions: follow, special-attack toggle, auto-retaliate and run toggles, item-on-player,
      autocast, a same-tick gear + prayer switch, and attacking without a full `walkTo` first.
      (Done, warn-only by the owner's choice: each player's `safeArea` and `wildernessLevel`,
      `sdk.assessPvpAttack()`, and `bot.attack()` returning `warnings` - a refusal it expects,
      a skull it will give you, a town on the way while skulled - but attacking anyway.)
      Add snare, entangle, god spells and Iban's blast to the spell table.
- [x] Deadman state and helpers: `state.skullTicksRemaining` (varp `pvp_skull_ticks`),
      `bot.checkBankKeys()`, `bot.openBankKey()`, and each nearby player's `isSkulled`.
- [ ] Reflexes: per-tick eat / pray / switch / attack-player inside the lite runner, so fights
      don't wait on an LLM turn (a draft of NPC reflexes exists in the sibling rs-sdk checkout).
- [ ] Docs and examples: `learnings/pvp.md` for agents, example bots (hunter, survivor).

### 5. More Deadman

From [`DEADMAN.md`](DEADMAN.md), roughly in order of value:

- [x] Safe deposit box: 10 stacks that bank raids can't take (`dmm_safe_box.rs2`), opened from
      any banker's talk-to options; `bot.openSafeDepositBox()` and friends for bots.
- [ ] Skull and PJ tuning: DMM's longer skulls for attacking much lower levels, +2 min per
      re-skull, and a 16-24 tick single-combat lock.
- [x] Protection for new accounts: 3 hours of play (the owner's choice; DMM gave 6-12 hours
      at half our tick speed), only for accounts made after it was added; attacking ends it.
      `%pvp_newbie` (varp 1006, perm, transmitted) and the `playtime` command.
- [x] Breaches (`engine/pvp/Breaches.ts`, `dmm_breaches.rs2`): every 3 hours at fixed UTC times
      a breach guardian (npc 2046) spawns at one of six multi-combat sites, announced 10 minutes
      ahead, for 20 minutes; its fighters earn breach points (varp 1007) by damage and sigils;
      the breach warden (npc 2047, Lumbridge) sells rewards; `GET /api/breach`. Env:
      `BREACHES`, `BREACH_INTERVAL_MINUTES`, `BREACH_WARNING_MINUTES`, `BREACH_DURATION_MINUTES`.
- [x] Seasons with full wipes (owner, 2026-10-22): `SEASON` picks the profile (season 1 =
      `main`, season N = `season-N`) and the exchange database (`market.season-N.sqlite`), so a
      new season starts every character over while earlier seasons stay on disk and on the
      hiscores (`?profile=`). Runbook under "Starting a season" below. Still open: a finale
      event.
- [x] Sigils (objs 10001-10005): Fury, Stone, the Feast, Escape, Fortune; perks while carried,
      destroyed on death. Classic XP loss stays off (owner, 2026-10-22).

### 6. More PvP content (the game version)

This server is RuneScape 2 as of January 2005, not OSRS; [`GAME_VERSIONS.md`](GAME_VERSIONS.md)
compares the options. The recommendation is to stay on revision 289 and add a clearly labelled
PvP kit, cherry-picking LostCity's 377-wip scripts where they exist:

- [x] Abyssal whip and granite maul, with their specials, from 377-wip (`scripts/pvp_kit/`,
      `server/PATCHES.md` "PvP kit"); breach guardians drop them (1% whip, else 2% maul, for every
      damager). 377 re-rigged the player,
      so `engine/tools/pvp/import377Weapons.ts` converts the animations and worn models; the
      whip's lash swings rigidly. Open: the whip's run energy drain does nothing while
      `NODE_INFINITE_RUN` (default true) refills everyone's energy every tick.
- [x] Tele Block (`scripts/pvp_kit/scripts/tele_block.rs2`): level 85, 5 minutes (2.5 under
      Protect from Magic), stops spells, jewellery and the Wilderness levers, survives logout,
      ends on death. 377-wip has the impact graphic but no spell, so the spell, its spellbook
      button and its icon are ours (`engine/tools/pvp/import377TeleBlock.ts`). The SDK exposes
      `state.teleBlockTicksRemaining` and `Spells.TELE_BLOCK`.
- [x] Ancient Magicks (`scripts/pvp_kit/scripts/ancients.rs2`): all 16 combat spells against
      players and monsters, and the 8 teleports, with Old School's levels, runes, xp and max hits,
      on their own spellbook laid out as the real one with 377's icons. The
      Zaros altar in the Demonic Ruins (Wilderness 46) swaps books (the owner's choice,
      2026-10-22). Burst and Barrage splash in multi-combat onto targets the caster could attack.
      377-wip has the graphics and the altar but no spells, so the spells, spellbook and icons are
      ours (`engine/tools/pvp/import377Ancients.ts`); the cast animation is the wave's. The SDK
      exposes `state.spellbook`, `Spells.SMOKE_RUSH`...`Spells.ICE_BARRAGE` and castSpell names.
      Open: staffs can't autocast them (no ancient staff yet).
- [ ] Barrows sets.
- [ ] Take each LostCity/rs-sdk upgrade by walking `server/PATCHES.md`.

### 7. Game design iterations

- [x] Teleport lock after PvP hits (24 ticks).
- [ ] Respawn kit; bounty targets; PvP XP bonus.

## Operating the server

```sh
fly deploy -a pvp-sdk                  # from the repo root; builds remotely
fly logs -a pvp-sdk                    # live logs
fly ssh console -a pvp-sdk             # shell; data lives on /opt/server/data
fly status -a pvp-sdk
fly scale vm performance-1x --memory 2048 -a pvp-sdk
```

### Owner access

Live positions, the gear and bank boards, screenshots, the gateway's bot list and any bot's
position are the owner's. Set the secret once (it never goes in `fly.toml`); `--stage` holds
it for the next deploy instead of restarting the world now:

```sh
fly secrets set --stage OWNER_TOKEN=$(openssl rand -hex 32) -a pvp-sdk
```

Then send `Authorization: Bearer <token>` (e.g. `curl -H "Authorization: Bearer $T"
https://pvp-sdk.fly.dev/playerpositions`), or sign a browser in at
https://pvp-sdk.fly.dev/owner (a 30-day cookie) and open `/mapview/`, `/hiscores/outfit`,
`/hiscores/bank` or `/status`. Without the secret those routes are closed to everyone.

### Starting a season

A new season starts every character over (stats, items, bank, keys, safe deposit box, quests)
on Tutorial Island; accounts and passwords stay. Nothing is deleted: the old season's saves
(`data/players/<profile>/`), exchange database and hiscores stay on the volume.

1. Announce the date a few days ahead.
2. Snapshot the volume: `fly volumes snapshots create vol_r7y5y0l6m560wn3r -a pvp-sdk`.
3. Set `SEASON = "N"` in `fly.toml` `[env]` (the next number; it isn't a secret) and deploy.
4. Check `/hiscores/pvp`: it shows the new season, with links to the old ones.

Every character is new, so everyone gets new-player protection for their first 3 hours of play.
To undo, set `SEASON` back and deploy: the previous season's characters come back as they were.

### Watching the world in 3D

The rs-world viewer renders the live world from the spectator feed (`/worldfeed`, owner-only
behind the `WORLD_FEED_TOKEN` secret). Ours is the fork
[SeanVella/rs-world](https://github.com/SeanVella/rs-world), published by its Pages workflow
to https://seanvella.github.io/rs-world/ and built from this server's own cache (repository
variables `RS_SDK_SERVER` and `WORLD_FEED_URL`). Open it with `?live=<feed>`, `<feed>` being
the URL-encoded `wss://pvp-sdk.fly.dev/worldfeed?token=<WORLD_FEED_TOKEN>`; add
`&follow=<player>` to follow someone. The token is never part of the build, so the site can be
public. After content changes (new npcs, items, maps) re-run its workflow
(`gh workflow run pages.yml -R SeanVella/rs-world`) so it renders them.

The upstream-hosted viewer (maxbittker.github.io/rs-world) only has the base game's cache. To
use it, set `WORLD_FEED_STAND_INS=true` so the feed sends this fork's npcs as look-alikes
(`FEED_STAND_INS` in `web/worldfeed.ts`).

Make a moderator (then relog): `fly ssh console -a pvp-sdk -C "sqlite3 /opt/server/data/db.sqlite \"UPDATE account SET staffmodlevel=2 WHERE username='name'\""`.

Upstream sync: `git fetch upstream && git merge upstream/main`, then walk `server/PATCHES.md`
(including the PvP section) and run `bun run check`.
