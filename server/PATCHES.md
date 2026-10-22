# Vendored-Tree Monkeypatch Checklist

`server/{engine,content,webclient}` are vendored copies of upstream LostCity (rev 289, upgraded
from 274 on 2026-10-09; branches `289` in each upstream repo).
Every local modification ("monkeypatch") is listed here with a verification step.
**Walk this checklist after every vendor sync/rebase** — history shows patches don't get
dropped wholesale, they get subtly severed (see "Cross-boundary invariants" below).

How the vendoring works: upstream clones with remotes live at `../repos/{engine,content,webclient}`;
each `vendor-289` branch = upstream tip + ONE squashed "rs-sdk local mods" commit (`vendor-274`
is kept as the previous era's backup). The systematic
audit (compare the mods commits between old and new vendor branches, file-level + added-line
survival) is described in the project memory; this file is the human-readable checklist.

---

## Engine (`server/engine/`)

### Protocol / custom packets
- [ ] **Global chat broadcast** — `MessagePublicHandler.ts` broadcasts public chat to all
      players outside the 14-tile overhead range via custom `MESSAGE_PUBLIC` packet
      (opcode **255**, variable length; still free after 289 reshuffled every opcode). Pieces: `ServerGameProt.ts` (opcode),
      `ServerGameProtRepository.ts` (binding), `codec/MessagePublicEncoder.ts` (p8 userhash +
      WordPack), `model/MessagePublic.ts`.
      Verify: `grep -n "MESSAGE_PUBLIC = new ServerGameProt(255" src/network/game/server/ServerGameProt.ts`
      **⚠ MUST pair with the webclient receive branch (see webclient section). An engine-side
      packet with no client handler causes a T1 LOGOUT on the receiving client.**

- [ ] **Custom opcodes vs upstream renumbering** — every revision bump reshuffles BOTH opcode
      tables (289 changed nearly every value). After a sync, confirm server opcode 255 and
      client opcode 243 are still unused in upstream's `ServerGameProt`/`ClientGameProt`
      (and webclient `ServerProt`/`ClientProt`), and that `ServerProtSizes[255] === -1`.

### Config / environment
- [ ] **`Environment.ts`** — flat back-compat aliases over 274's nested `WorldConfig`, plus
      `migrateFromLegacyEnv(loadWorldConfig(), process.env)` overlay so fly.io `[env]` vars win
      over `world.json`. Also `NODE_WS_ONDEMAND` **defaults true** (274 client streams assets
      over the game WS; false ⇒ stalls at ~60% "Connecting to update server").
- [ ] **`WorldConfig.ts`** — default `web.port = 8888` on all platforms; `xpRate = 25`.
- [ ] **400-char chat** — `WorldConfig.ts` default `node.maxMessageLength = 400` (classic 80).
      Paired pieces, all required: `wordenc/WordPack.ts` caps follow
      `Environment.node.maxMessageLength` (not hardcoded 80) AND clamps packed output to
      240 bytes (`truncateToByteBudget` — all chat frames carry a 1-byte length; 2-nibble
      chars would overflow it and corrupt the stream); `MessagePublicHandler.ts` /
      `MessagePrivateHandler.ts` use `Packet.alloc(1)` not `alloc(0)` (packed chat can be
      ~250 bytes; the 100-byte tier throws RangeError mid-cycle and kicks the player).
      Mirrors in webclient (see below) and SDK chunking (`sdk/index.ts` packedNibbles).
      Verify: `grep -n "maxMessageLength: 400" src/util/WorldConfig.ts && grep -n "alloc(1)" src/network/game/client/handler/MessagePublicHandler.ts`
- [ ] **`World.ts`** — connection timeouts relaxed for bot background tabs
      (`TIMEOUT_NO_CONNECTION` 5m / `TIMEOUT_NO_RESPONSE` 10m, gated by `NODE_DEBUG_SOCKET`).
- [ ] **`World.ts` tick drift cap** — `cycle()` clamps `nextTick` to at most 2 ticks of
      backlog before computing `drift`, so the world resumes normal pacing after sustained
      overload instead of sprinting through the whole backlog at max speed.
      Verify: `grep -n "start - this.tickRate \* 2" src/engine/World.ts`

### Old-client guidance (rs-sdk)
- [ ] **Outdated-client record** — `World.ts` login: on a revision mismatch, `noteOutdatedClient()`
      decodes the rest of the login block (identical across revisions) for the username and keeps
      `{revision, at}` in `World.outdatedClients` (30 min TTL); a correct-revision login clears it.
      Management port `/outdated-client?username=` exposes it (port 8898, not published by fly).
      Gateway `sdk_connect`: when the bot has no live client, it asks that endpoint and answers
      `sdk_error` naming the fix — old SDK checkouts print gateway errors, so this is the one hint
      that reaches people who haven't pulled. Public `/api/version` (`web/pages/api.ts`) returns
      `{revision}`; the lite runner (`session.ts`) checks it first and throws `OutdatedClientError`
      (a `LoginError` code 6) — runner/swarm exit **3** so supervisors stop restarting.
      Verify: `curl localhost:8888/api/version` and `curl 'localhost:8898/outdated-client?username=x'`.

### Database
- [ ] **Bun sqlite dialect** — `src/db/dialect/BunSqliteDialect*.ts` (3 files) + runtime chooser
      in `src/db/query.ts` (`typeof Bun !== 'undefined'` → bun:sqlite, else upstream's
      `node:sqlite`). Upstream is node-primary; **Bun does not implement `node:sqlite`** —
      without this the engine won't boot under bun.
- [ ] **SQLite WAL + busy_timeout** — `src/db/query.ts` runs
      `journal_mode=WAL; synchronous=NORMAL; busy_timeout=10000` on every connection.
      Each worker thread has its own connection; without WAL a logger write burst
      (telemetry compaction) blocked login queries and took prod logins down after the
      2026-08-03 deploy. Paired: LoggerServer first-compaction delay 15min
      (past the reconnect storm) + 10ms pause between compaction groups, and the
      gateway auth timeout is 15s (must outlast busy_timeout). WAL adds
      `db.sqlite-wal/-shm`; file-copy backups must checkpoint first.

### Web layer (mostly rs-sdk-only files, but `src/web.ts` is a 3-line shim — on conflict keep the shim)
- [ ] **Upstream web server is Fastify since 289** (`src/web.ts`, `@fastify/*` deps). We keep the
      Bun.serve shim and do NOT carry the fastify deps or `tsx` in `package.json`. Port anything
      new from upstream's `web.ts` by hand — 289 added `OnDemand.onClientClosed(client)` to the WS
      close handler, mirrored in `src/web/websocket.ts` (without it OnDemand's client map leaks).
- [ ] **`WSClientSocket.ts` keeps our API**: `new WSClientSocket()` + `init(socket, addr)` (the
      socket only exists after Bun's `open`), per-tick output batching (`beginBatch`/`endBatch`,
      `flush`, `discard`) and the **1s delayed close**. Upstream 289 moved to
      `constructor(socket, addr)` and immediate close (its 289 client drains buffered bytes after
      a remote close). `TcpClientSocket.close()` also keeps the 1s delay — reconnect closes the old
      socket before ownership moves, and `test/fixtures/reconnect-lifecycle.ts` asserts that close
      can't detach the replacement. On conflict keep ours.
- [ ] **`src/web/`** modular split: `websocket.ts` (`/gateway` WS proxy → gateway on :7780,
      `isAgentProxy`), `pages/api.ts` (`/api/exportCollision` — must read the in-engine TS
      routefinder, NOT the removed WASM; discovers mapsquares from maps **zip ∪ dir**;
      `/api/screenshot`), `pages/client.ts` (serves `view/bot.ejs` at `/` and `/bot`),
      `pages/hiscores.ts` + `src/web/hiscoresServer.ts` + `src/hiscores.ts` (custom hiscores;
      **profile query param XSS-sanitized**), `pages/screenshots.ts`, `pages/static.ts`.
- [ ] **World feed** (`src/web/worldfeed.ts`, rs-sdk-only): read-only `/worldfeed` WebSocket
      streaming live players/npcs for external 3D viewers (rs-world). Off unless `WORLD_FEED=true`
      (`WORLD_FEED_TOKEN`, `WORLD_FEED_MAX_CLIENTS`, `WORLD_FEED_IDLE_TIMEOUT_MS` in `Environment.ts`).
      Inactive clients expire after the configured timeout. Hooks: `isWorldFeed`
      branches in `websocket.ts` upgrade/open/message/close, and `cycleWorldFeed()` in
      `World.cycle()` between `processClientsOut()` and `processCleanup()` — it reads the per-tick
      info masks, `walkDir`/`runDir`/`tele`/`jump` and `lastTickX/Z`, so it must stay before cleanup.
      Verify: `grep -n "cycleWorldFeed()" src/engine/World.ts` and `bun test test/worldfeed.test.ts`.
- [ ] **`view/bot.ejs`** — the entire bot UI page (rs-sdk-only): reads `?bot=`/`?password=`
      (auto-login), **writes both back to the URL on login/field-change**, cache-busted
      `client.js?v=<%= cachebust %>` import, quick-login/create/skip-tutorial controls.
- [ ] **Login server** — `LoginServer.ts`: `sdk_auth` message handler (gateway auth path,
      username normalized to match engine); `LoginThread.ts`: **no auto-grant of dev
      staffmodlevel on non-production worlds** (public server safety).

### Gameplay / safety
- [ ] **XP curve** — `entity/Player.ts` `getExpByLevel` table: delta uses `level/10.0`
      (custom curve), table stored in ×10 "fine" units (`Math.floor(acc/4) * 10`), L99 =
      10,701,400. **Duplicated in webclient — keep in sync (see below).**
- [ ] **`PlayerLoading.ts`** — clamp loaded levels to base levels.
- [ ] **Anti-grief removals** — `MessagePrivateHandler.ts` / `ReportAbuseHandler.ts`: upstream's
      automated 2-day bans REMOVED (bots trip them).
- [ ] **Random events toggle** — `ScriptOpcode.ts` + `DebugOps.ts`: `MAP_RANDOM_EVENTS` opcode
      backed by `NODE_RANDOM_EVENTS` env (paired with content `engine.rs2`, see content section).
- [ ] **`[LOGOUT DEBUG]` instrumentation** — console.warn breadcrumbs in
      `NetworkPlayer.ts`, `IdleTimerHandler.ts`, `ClientCheatHandler.ts`, `PlayerOps.ts`,
      `World.ts` (and webclient `Client.ts`). Low-stakes but useful; fine to re-add lazily.
- [ ] **Lava Maze runite hiscores** — content `mining.rs2` (`get_ore_normal`) calls the
      `runite_mined(loc_coord)` command (declared in `engine.rs2`) whenever it gives runite
      ore; `RUNITE_MINED` opcode (10011) in `ScriptOpcode.ts`/`ScriptOpcodePointers.ts`, handler
      in `DebugOps.ts` counts only the two Lava Maze rocks (0_3059_3885, 0_3060_3884, from
      `m47_60.jm2`) → `World.notifyRuniteMined` → `runite_mine` relay cases in
      `LoggerThread.ts`/`LoggerClient.ts`/`LoggerServer.ts`, `runite_mine` table (both prisma
      schemas + `db/types.ts`), `/hiscores/runite` page in `web/pages/hiscores.ts`
      (registered in `web/index.ts` + `web/hiscoresServer.ts`). Depends on the logger
      pipeline (EASY_STARTUP or a standalone `bun run logger`) — events are silently
      dropped without it. Replaced King of the Hill (migration `20260926000000_runite_mine`
      drops `koth_capture`).
      Verify: `grep -n "runite_mined" ../content/scripts/skill_mining/scripts/mining.rs2 && grep -n "RUNITE_MINED" src/engine/script/handlers/DebugOps.ts`
- [ ] **Equipment hiscores sprites** — `LoginServer.ts` `outfitAppearance()` stores the worn
      outfit's resolved appearance slots (wearpos2/3 masking needs obj config) in
      `hiscore_outfit.appearance` (migration `20260926010000_hiscore_outfit_appearance`) on every
      outfit hiscore write; `/hiscores/outfit` shows a `/sprite/player` image for the top 10 and
      `/sprite/item` icons (no in-browser viewer bundle). Sprites come from `web/sprites/`
      (worker hosting webclient `src/viewer/ItemViewer.ts` `renderPlayerSprite`).
- [ ] **Hiscore playtime tiebreak** — `hiscore.playtime`/`hiscore_large.playtime` (migration
      `20260208000000_hiscore_playtime_and_outfit`); boards rank level desc, playtime asc.
      `LoginServer.ts` `updateHiscores()` stamps playtime only when a row's **level** changes
      (XP-only changes keep it), so it means "playtime when this level was reached" — restamping
      on every logout pushed maxed players down for continuing to play. Quest points (type 100,
      `updateQuestHiscore()`) follows the same rule.
      Verify: `grep -n "existing.level === totalLevel ? existing.playtime" src/server/login/LoginServer.ts`
- [ ] **Worker-thread crash hardening** — `src/server/InternalClient.ts` uses persistent
      `.on('close'/'error')` handlers instead of `.once()` (a second ws error after a
      successful open was an unhandled EventEmitter 'error' that killed the worker → every
      later `postMessage` threw mid-cycle → whole world shut down; this was the "engine
      dies ~40s into a bot session" local failure). `World.ts` constructor and `app.ts`
      easyStartup block attach 'error'/'exit' listeners to every Worker so the dying
      thread is named in the log.
- [ ] **Choice-dialog resume guard** — `handler/ResumePauseButtonHandler.ts` ignores a bare
      RESUME_PAUSEBUTTON while `player.resumeButtons` is non-empty (a pending `p_choice`
      would otherwise resolve from stale `last_com`, silently re-picking the player's last
      clicked option — bots re-declined the Al Kharid toll forever);
      `handler/IfButtonHandler.ts` clears `resumeButtons` when a registered option resumes
      the script. Verify: `HEADLESS=true bun sdk/test/alkharid-gate-choice-resume.ts`.


### Grand Exchange (rs-sdk)
- [ ] **Physical market** — `src/engine/market/{MarketStore,MarketCatalog,GrandExchange}.ts`,
      `GE_OPEN(coord)` opcode in `ScriptOpcode.ts` / `DebugOps.ts`, native `IfButtonHandler` and
      `ResumePCountDialogHandler` hooks. Paired content: `engine.rs2` command, dedicated
      `grand_exchange_booth`/`grand_exchange_teller` configs and triggers, `grand_exchange.if`,
      append-only interface/loc/npc packs and `interface.order`. Map `m49_53.jm2`
      reuses the west-wall bank table at 3180,3443 (original model, rotation and
      collision) and places the teller at 3181,3445. Disabling GE restores the
      original bank table. Ordinary bank booths remain banking-only.
      `World.processPlayers` calls `tickExchange` to push changed offers; preserve this
      with the visual offer form (there is no visible refresh button).
      Repack with `BUILD_VERIFY=false` after custom content changes.
- [ ] **Thumbnail search** — shared `ItemSearch.ts` aliases/fuzzy ranking; native search
      components with client codes 30400–30402, 30410–30421 and 30440–30451.
      `MARKET_SEARCH` client opcode **243**, length -1, must match engine
      `ClientGameProt`/repository/decoder/handler and webclient `ClientProt`.
      Payload: `pjstr(query)` then `p2(item)` (0 filters; positive selects a shown
      canonical ID). Max query 48 ASCII characters; server requires a physical
      session and matching current query/page. `Client.ts` keyboard and click hooks
      use `MarketSearchInput.ts`; lite component clicks resolve displayed IDs too.
      Rebuild standard and bot clients. No new server-to-client packet.
      Verify `item-search.test.ts`, `bot/MarketSearchInput.test.ts` and the integration.
- [ ] **Atomic recovery** — `Player.save()` checkpoints into the market ledger;
      `PlayerLoading.load()` prefers that snapshot over stale login-service saves.
      Placement/collection checkpoint all online players in the same SQLite transaction
      to cover items handed between players since an autosave. Preserve both hooks.
      `data/market.sqlite` (or `GE_DATABASE`) is authoritative durable data, including
      player checkpoints; back it up with the world, never independently delete/restore it.
- [ ] **Market web and SDK** — `web/pages/market.ts` registered in `web/index.ts`,
      `public/market.html`, `view/bot.ejs` Market link; `sdk/market.ts` and three
      `BotSDK.getMarket*` methods. API is GET-only and exposes no player identities.
      Verify: root `bun test server/engine/test/market.test.ts sdk/test/market-client.test.ts`,
      then `bun run test:market:integration` with built content. Full design/operations:
      `docs/grand-exchange.md`; API: `sdk/MARKET.md`.

### Custom content IDs
Upstream pack ids mirror each revision's cache: they don't grow within a revision (274's maxima were
unchanged across 77 upstream commits) but jump at every revision bump, and upstream also *names*
placeholder ids over time (`varp_357/358` became `boardgames_varbit3/4` in 289). Our configs either
sit in a **reserved range above any upstream revision** (never renumber) or at the pack tail
(renumber on every revision bump). The packers write gaps as empty entries.

Reserved (fixed since 289; upstream `377-wip` tops out at interface 18785 / varp 724):
- [ ] **Interfaces 40000+** — GE `grand_exchange` root **40000** … `grand_exchange_side:inv` **40495**
      (`interface.pack` + same ids appended to `interface.order`). Free: the interface format lists
      component ids explicitly, so the gap costs no bytes. Ids must stay below 65535 (the format's
      root marker). Add new custom interfaces after 40495.
- [ ] **Varps 1000+** — `pvp_death_mark` **1000**. Saves store varps by id, so a fixed id means no
      more save migrations. Cost: per-player `vars`/`varsString` arrays are sized to the max id.
      `PlayerLoading.load` still moves a value found at **358** (its 274 id) to `pvp_death_mark`;
      safe because 289's varp 358 is temp-scoped and never saved. Keep that shim until no pre-289
      saves remain (prod saves + `market.sqlite` checkpoints).
- [ ] Numeric reserved ids outside content: `sdk/actions.ts` `NEVER_AUTO_CLOSE` (40000) and
      `sdk/test/ge-actions.test.ts`. Engine code resolves GE components by name (`Component.getId`).

Tail-appended (renumber at each revision bump):
- [ ] `loc.pack` `grand_exchange_booth` **5116** (274: 4671). Not reserved high: the engine allocates a
      `LocType` per id, so 30000 would mean ~25k empty objects in prod heap.
- [ ] `npc.pack` `grand_exchange_teller` **1596** (274: 1359). Can't go high: 289's NPC_INFO sends the
      type in 11 bits (max 2047); 377 widens to 13 bits but has 3851 npcs, so it collides then anyway.
- [ ] `maps/m49_53.jm2` references both **numerically** (`0 44 51: 5116 10 1`, NPC section
      `0 45 53: 1596`) — update with the packs. Neither id is persisted anywhere.

Upgrade hazards:
- [ ] **Asset debugnames get renamed upstream** (289 renamed ~3.5k models, plus idk/seq/npc/interface
      names; ids stayed stable). Our configs reference names: `grand_exchange.loc` model
      `furniture_banktable` (274: `model_loc_590`), `grand_exchange.npc` `man_*`/`chat_male_head_shorthair`
      (274: `model_NNN_idk`). Map old→new through the id in `pack/model.pack`; the build fails loudly
      on a missing name.
- [ ] `Player.save()` also checkpoints into `data/market.sqlite` `accounts`, and `load()` prefers that
      row — a save-format experiment on a throwaway name leaves a row there; delete it after.
- [ ] `quest_mortton/.../razmire_keelgan.rs2` building store: our anti-buyback sell price **650**
      combined with upstream 289's 4% haggle fix → `~openshop(razmirebuildingstore, 650, 1050, 40, ...)`.

### Assets
- [ ] **`FileStream.write`** — update `packed[archive][file]` after changed writes, so
      same-pass version-list CRCs and `ondemand.zip` see the new map/model bytes.
      Verify `bun test server/engine/test/file-stream.test.ts` from the root.
- [ ] `public/img/skill/*` (19 files), `public/img/*`, favicons, hiscores images —
      restored after upstream website migrations deleted them. Verify pages render with images.
- [ ] `tools/pack/PackAll.ts` `packOnDemandZip()` — regenerates `data/pack/ondemand.zip`
      (snapshot of cache idx1–4) at the end of `packAll()`. Existed upstream in the 254 era,
      dropped in 274. Serves the hiscores ItemViewer at `/ondemand.zip`; without it, newly
      packed item models render as blank hiscores icons. Verify: after `bun run build`,
      `unzip -l data/pack/ondemand.zip` includes the highest model id in `content/pack/model.pack`.

---

## Webclient (`server/webclient/`)

### Lite client (wholly added — `src/lite/`, headless bot client; see `src/lite/README.md`)
- [ ] `src/lite/**` is rs-sdk-only and has no upstream counterpart — it should survive
      a sync untouched. It **consumes** vendored modules though (`config/*Type`,
      `dash3d/Client{Player,Npc,Obj}`, `dash3d/CollisionMap`, `io/{Packet,Isaac,JagFile,
      ClientStream,ServerProt,ClientProt}`, `wordfilter/*`), so a decode change upstream
      lands in both clients — which is the point.
      Verify: `bun src/lite/bench.ts 2` logs in and reports live sessions.
- [ ] **Lite protocol decoder duplicates `Client.ts` packet reads** (`src/lite/protocol/incoming.ts`,
      `entities.ts`, `zone.ts`) and the login handshake (`src/lite/net/GameConnection.ts`
      `CLIENT_VERSION`). Opcode renumbering flows through the shared `ServerProt`/`ClientProt`
      enums, but **layout changes don't**: diff upstream's `Client.ts` read paths every upgrade.
      289 changed `UPDATE_INV_FULL` size `g1`→`g2` and `UPDATE_INV_PARTIAL` slot `g1`→`gsmart`
      (ported). A mismatch desyncs the stream silently or kicks the bot.
- [ ] **`src/io/ClientStream.ts` `isClosed` getter** — 3 added lines exposing
      `dummy || remoteClosed`. The browser client learns a socket is dead by reading from
      it and taking the throw; the lite session loop only reads when `available > 0`,
      which a remotely-closed stream reports as 0 *forever* — so without this the loop
      spins on a dead socket and the session never ends. Consumed by
      `lite/net/GameConnection.isClosed` → `LiteClient.isInGame()`.
      Keep `dummy || remoteClosed` even though 289's `available` now reports buffered bytes after
      a remote close: a partial trailing packet would leave `available > 0` forever.
      Verify: `grep -n "get isClosed" src/io/ClientStream.ts src/lite/net/GameConnection.ts`
- [ ] **`src/client/LoopCycle.ts` + the `Client.loopCycle` accessor pair** — `loopCycle`
      moved out of Client into a one-field module, and `Client.ts` now exposes it as
      `static get/set loopCycle` over that box. Reason: `ClientPlayer.ts` read
      `Client.loopCycle` for one line in `getSequencedModel()`, and that import drags the
      whole 14k-line Client (plus Pix3D, MapView, WebAudio, localStorage) into anything
      touching a ClientPlayer — 212MB of imports for the headless client, vs 21MB after.
      The box stays browser-only state: the lite client keeps a `cycle` counter per
      `LiteClient`, since one counter shared by N bots in a process runs N× fast.
      On conflict: keep the accessor, re-point `ClientPlayer.ts` at `LoopCycle.value`.
      Verify: `grep -n "LoopCycle" src/dash3d/ClientPlayer.ts src/client/Client.ts`
      **⚠ `ClientPlayer.ts` must NOT import `#/client/Client.js`.** An upstream sync that
      restores that import silently re-bloats the lite client; it still runs, so nothing
      fails loudly. Cheap check:
      `bun -e 'import("./src/dash3d/ClientPlayer.js")'` must not need a DOM shim.

- [ ] **400-char chat (webclient half)** — `wordfilter/WordPack.ts` internal clamps raised to
      `MAX_CHARS = 512` (safety bound above the ~509 wire ceiling; the real cap is enforced
      at call sites from the server-configured value) plus the same 240-byte
      `truncateToByteBudget` as the engine copy. `lite/LiteClient.ts` default
      `maxMessageLength` is 400 (lite has no config-injection channel — keep in sync with
      the engine `WorldConfig` default). `lite/runner.ts` honors a `GATEWAY_URL` override
      (bot.env or process env) because SERVER doubles as game origin + gateway address and
      that breaks for `localhost:8888`.
      Verify: `grep -n "MAX_CHARS = 512" src/wordfilter/WordPack.ts && grep -n "?? 400" src/lite/LiteClient.ts`

### Bot bridge (wholly added — `src/bot/`, 8 files + `src/client/BotClient.ts`, `src/viewer/ItemViewer.ts`)
- [ ] `StateCollector.ts`, `BotOverlay.ts`, `ActionExecutor.ts`, `GatewayConnection.ts`,
      `OverlayUI.ts`, `formatters.ts`, `types.ts`, `index.ts`.
      Note: **gateway state messages come from `BotOverlay.sendState()`** (includes
      `allComponents`/`componentId`), not `StateCollector.collectDialogState` (basic fallback).
      `GatewayConnection` reads `?bot=`/`?password=` **at page load** for gateway registration.

- [ ] **`src/dash3d/LoopCycle.ts`** (rs-sdk-only) — the frame counter split out of Client;
      `Client.loopCycle` is now a static getter/setter over it and
      `ClientPlayer.ts` reads `LoopCycle.value` instead of importing Client. Required so
      the viewer bundle (which imports ClientPlayer for character sprites) doesn't
      drag the whole game client (and its node-only `open` dep) in and fail to build.

### Client.ts bot SDK surface (~1,450 added lines inside upstream's `src/client/Client.ts`)
- [ ] Bot methods: `autoLogin`, `getDialogOptions`/`getDialogText`/`getChatInterface`/
      `captureDialogToHistory`/`debugDialogComponents`, `findNpcByName`, `talkToNpc`,
      `interactNpc/Loc/Player`, `acceptCharacterDesign` (**must send IDK_SAVEDESIGN AND the
      CC_ACCEPT_DESIGN IF_BUTTON**), `setTargetedFramerate`, etc.
- [ ] **Walk-before-op**: `interactLoc`, `talkToNpc`, `interactNpc`, `interactPlayer` ALL call
      `tryMove(..., type=2)` before writing OPLOC/OPNPC/OPPLAYER. 274's
      `clientRoutefinder=true` means the SERVER DOES NOT PATHFIND to interaction targets —
      a missing tryMove = "I can't reach that!" from 2+ tiles.
- [ ] **`MESSAGE_PUBLIC` receive branch** (pairs with engine broadcast): `ptype ===
      ServerProt.MESSAGE_PUBLIC` → g8 userhash + `WordPack.unpack(psize - 8)` →
      `addChat(2, ...)`. Plus `src/io/ServerProt.ts`: `MESSAGE_PUBLIC = 255` and size-table
      entry `-1` at index 255.
      Verify: `grep -n "ServerProt.MESSAGE_PUBLIC" src/client/Client.ts` (a receive `if`, not
      just the enum).
- [ ] **`mapFlagUnsetCount`** — the `UNSET_MAP_FLAG` receive branch increments a counter
      beside `this.minimapFlagX = 0`. It is the only wire evidence that the server refused
      an op (every `Op*Handler` refusal answers with this packet and nothing else), and
      `bot/StateCollector.collectOpFeedback` turns it into `state.opFeedback`. Upstream
      just clears the flag, so a sync silently reverts it — and nothing fails, the signal
      merely goes quiet and bots go back to waiting out timeouts.
      **Pairs with `src/lite/protocol/incoming.ts`**, which must increment the same field.
      Verify: `grep -n "mapFlagUnsetCount" src/client/Client.ts src/lite/protocol/incoming.ts`
      (two files, one increment each), plus `bun test src/bot/StateCollector.test.ts`.
- [ ] **XP table** — `Client.ts` `levelExperience`: same `level/10.0` curve but **NO ×10**
      (client receives real xp; engine stores fine xp). Verify both formulas side-by-side after
      any sync touching `Player.ts` or `Client.ts`.
- [ ] **AFK logout extended** to 10 minutes (upstream 90s logs idle bots out).
- [ ] **Renamed-field adaptations** (274): `chatModalId`, `redrawChat`, `sideIcon`,
      `activeIcon`, `redrawSide`, `redrawIcons`, static `Client.loopCycle` — the bot bridge
      accesses some via `as any`, so **`bunx tsc --noEmit` does NOT catch all of these**;
      grep-audit `(client as any).X` accesses after a sync.

### Build / shell
- [ ] **`bundle.ts`** — `BUILD_MODE` standard/bot/both; **terser property mangling OFF**
      (mangling breaks bot.ejs/Puppeteer accessing client members by name).
- [ ] **`GameShell.ts`** — `deltime = 14` (≈30% faster client loop).
- [ ] **`MapView.ts`** — live player-position tracking (`playerPositions`,
      `shouldDrawPlayers`) for the `/mapview/` page; pairs with engine `/playerpositions`.
      Also replaces upstream's three-area map (`reloadMain/Dungeon/Extra`) with one unified map:
      `MAP_BANDS` stacks overworld (raw mapsquare rows 42–62), underground (142–161 → 63–82) and
      the high-z misc areas (69–77 → 83–91) without overlap; columns 29–56; bounds include one
      padding square per side because the loaders skip edge squares. On conflict keep ours. After
      a content sync, list `content/maps/m*_*.jm2` and confirm every square falls in a band and
      the column range (289 added Ape Atoll at rows 42–43 and its dungeon at 142–143).
- [ ] `src/3rdparty/tinymidipcm.js` tweak; `package.json` (bun scripts, deps).
- [ ] **Filename casing**: `src/io/JagFile.ts` (capital F) in webclient vs `src/io/Jagfile.ts`
      in engine. macOS hides case-only renames from git — after a sync run:
      `comm -23 <(git ls-files | sort) <(find . -type f -not -path './.git/*' | sed 's|^\./||' | sort)`
      (the 2 submodule gitlinks are expected hits).

---

## Content (`server/content/`)

- [ ] **`scripts/engine.rs2`** — `[command,map_random_events]` declaration (pairs with engine
      `MAP_RANDOM_EVENTS` opcode — both sides or scripts fail to compile).
- [ ] **`scripts/login_logout/login.rs2`** — random-event timer gated on `map_random_events`.
- [ ] **`scripts/macro events/scripts/macro_events.rs2`** — macro events disabled when off.
- [ ] **`scripts/shop/configs/shop.varp`** — `transmit=yes` on shop varps (bot shop state).
- [ ] **`scripts/minigames/game_managing_miscellania/scripts/managing_miscellania.rs2`** — coffers
      deposit clamps to `min(requested, coffer space, current coins held)` after the count dialog;
      withdraw rejects non-positive counts and checks the current coffer balance and inventory
      capacity before transferring money. Report and initial fix by kadeski ([PR #73](https://github.com/MaxBittker/rs-sdk/pull/73)).
      Reported upstream to LostCity; drop this patch once their 289 branch carries a fix.
      Verify: from the repo root, `bun test server/engine/test/miscellania-coffers.test.ts` (requires built engine content).
- [x] **README art** — moved out of the vendored tree to `docs/media/` (promo.gif, discord.svg,
      hiscores.svg, task_length.svg); nothing in `content/title/` is locally modified anymore.
- [ ] Smithing arrowheads + telegrab + nails fixes live in content history; they're additive
      and survive rebases, but re-run a smoke test if smithing/magic behaves oddly.

---

## PvP world (pvp-sdk fork)

The fork's game-mode changes, Deadman Mode-style (`docs/DEADMAN.md`). Upstream rs-sdk merges
(`git fetch upstream && git merge upstream/main`) touch the same vendored files, so walk this
list after every merge as well. Design and roadmap: `docs/PVP_PLAN.md`.

- [ ] **`scripts/pvp_world/`** (fork-only):
      - `pvp_world.constant`: `^pvp_combat_range` 15, `^pvp_protection_duration` 100,
        `^pvp_teleport_lock` 24, `^dmm_guard_interval` 2, `^dmm_max_keys` 5, `^dmm_key_stacks` 10,
        `^dmm_rules_version` 1.
      - `pvp_safe_zones.dbrow`: the guarded towns (Lumbridge, Varrock, Falador, East Ardougne,
        Yanille) and the Seers'/Catherby banks. **When a zone grows, raise `^dmm_rules_version`**,
        or players who logged out skulled on what is now town ground are killed by the guards
        the moment they log back in.
      - `pvp_world.varp`: `pvp_protection` (**1001**, transmitted), `pvp_combat_clock` (**1002**),
        `dmm_guard_hits` (**1003**), `dmm_rules_version` (**1004**, perm), `pvp_skull_ticks`
        (**1005**, transmitted: the skull's ticks left when last written, by `~pk_skull` and
        every ~50 ticks by `dmm_guard_check`; the bot client counts down from it), `pvp_newbie`
        (**1006**, perm, transmitted: new-player protection).
      - `pvp_world.rs2`: `~pvp_in_safe_zone` (that table + Tutorial Island + Duel Arena + Castle
        Wars), spawn protection, the `dmm_guard_check` softtimer, `~pvp_teleport_locked`,
        `~dmm_rules_login` (clears a skull saved under an older `^dmm_rules_version`).
      - `dmm_bank_keys.rs2/.inv/.obj`: bank raids, key transfer, the Bank key's Open/Check/Destroy.
- [ ] **Reserved ids for the bank keys** (saves store them by id, so never renumber):
      invs `dmm_key_1..5` **1000-1004** and `dmm_raid` **1005** in `inv.pack`; obj
      `dmm_bank_key` **10000** in `obj.pack` (upstream's objs end at 4088 in 289 and ~6.5k by
      377). The packers write the gaps as empty entries.
- [ ] **`skill_combat/scripts/pvp/pvp_combat.rs2` `~pvp_level_check`** — the whole world is a
      combat zone: refuses safe areas (attacker or target), a protected target, and gaps above
      `^pvp_combat_range` + wilderness level. **This proc is the only PvP gate** — the engine
      never checks that the Attack op is set (`OpPlayerHandler` todo), so menu changes are cosmetic.
- [ ] **`skill_combat/scripts/pvp/pk_skull.rs2`** — `set_pk_vars` ends spawn protection and
      stamps `pvp_combat_clock` on both players; `~pk_skull` starts and `~clear_pk_skull` stops
      the guard softtimer, and both write `pvp_skull_ticks`.
- [ ] **`player/scripts/death.rs2`** — reads the skull before anything clears it, then
      `~dmm_death_to_player`/`~dmm_death_to_npc` (keys and bank raid); `pvp_death_lose_items`
      keeps nothing; `player_death_lose_items` keeps 3 only when unskulled and ignores Protect
      Item; every death respawns at full health with spawn protection (upstream respawns pvp
      deaths at 1hp via `pvp_death_mark`, now unused there).
- [ ] **`skill_magic/scripts/spells/teleport.rs2` `~pre_tele_checks`** — the PvP teleport lock.
      Every teleport (spells, jewellery, quest items) goes through this proc.
- [ ] **`login_logout/login.rs2`** — `~dmm_sync_key_tokens` so Bank key objs match the keys held;
      `~dmm_rules_login` before `~set_pk_skull_login` (it must run first, or the restored skull
      starts the guards).
- [ ] **`engine/tools/pack/SourceSnapshot.ts`** — reads the running max mtime *after* awaiting
      each stat. Before, concurrent stats raced and an older file could overwrite a newer one,
      so a new config was sometimes left unregistered ("cannot be resolved to a game variable")
      until something else touched its pack. Upstream tooling bug; drop once fixed there.
- [ ] **Attack op everywhere** — `login_logout/login.rs2` always sets op 2 "Attack";
      `area_wilderness/scripts/wilderness.rs2` `wilderness_exit` no longer clears it;
      `game_castlewars` `castlewars_mapzoneexit` and `game_duelarena` `toggle_duel_challenge_off`
      restore it (the latter only outside the fight zones, so a duel keeps its "Fight" option).
      After a sync, grep for new `set_player_op(null, 2` callers.
- [ ] **World feed for rs-world** — `fly.toml` sets `WORLD_FEED=true`; `WORLD_FEED_TOKEN` is a
      Fly secret. `web/worldfeed.ts`: constant-time token check, and `feedNpcType` can send
      fork npcs (ids >= 1597) as base-game look-alikes for the upstream-hosted viewer
      (`WORLD_FEED_STAND_INS`, off in `fly.toml` because SeanVella/rs-world is built from our
      cache); add any new fork npc to `FEED_STAND_INS`. `web/index.ts`: the
      slow-request log masks `token=`/`password=` values.
- [ ] **Owner-only routes** (`docs/PVP_PLAN.md` "Owner access"). `OWNER_TOKEN` (a Fly secret;
      `Environment.ts`) unlocks them, as `Authorization: Bearer` or the cookie `POST /owner` sets.
      - `engine/src/web/owner.ts` (fork-only): the path list, the constant-time check, `/owner`.
      - `engine/src/web/index.ts`: 404 for owner-only paths at the top of `handleRequest`;
        `gatewayAuth()` forwards the owner token or the caller's `Authorization` to the
        gateway on the `/status`, `/status/:bot` and `/state|chat|say|dm` proxies.
      - `engine/src/web/hiscoresServer.ts`: the same gate on the standalone hiscores server.
      - `engine/src/web/pages/hiscores.ts`: no Equipment/Bank sidebar links.
      - `webclient/src/mapview/MapView.ts`: a non-OK `/playerpositions` draws no players.
      - `gateway/gateway.ts`: `OWNER_TOKEN`; `/` and `/status` list bots for the owner only
        (`/` stays a 200 banner, which the direct-gateway probe needs); `/status/:bot` keeps
        position and sessions for the owner or the bot's own password (checked only when sent,
        only for a connected bot; anyone with the login server off); the owner passes
        `authenticateHttpRequest` for any bot.
      - `sdk/index.ts` `checkBotStatus`: sends the bot's password, defaults missing fields.
      - `engine/tools/server/grant-bank-item.ts`: sends `OWNER_TOKEN` to `/playerpositions`.
      Verify: `bun test server/engine/test/owner.test.ts sdk/test/gateway-owner.test.ts`.
- [ ] **New-player protection** — opcode **10013** `PLAYTIME` (`playtime` / `.playtime`, handler
      in `handlers/DebugOps.ts`, declared in `engine.rs2`); `pvp_world.rs2` `~pvp_newbie_login`,
      `~.pvp_newbie_protected`, `~pvp_newbie_end`; `^pvp_newbie_protection` 36000 in
      `pvp_world.constant`. Hooks in upstream files: `login.rs2` (after `~dmm_rules_login`),
      `pvp_combat.rs2` `~pvp_level_check` (refuses a protected target), `pk_skull.rs2`
      `set_pk_vars` (attacking ends it). SDK: the refusal in `PVP_REFUSALS`,
      `state.newPlayerProtected` from varp 1006.
- [ ] **Safe deposit box** — `pvp_world/scripts/dmm_safe_box.rs2` and
      `pvp_world/interfaces/dmm_safe_box{,_side}.if` (fork-only, built from `bank_main.if` /
      `bank_side.if` without the note/rearrange buttons). Reserved ids: inv `dmm_safe_box`
      **1006** (`inv.pack`); interfaces **40496-40592** (`interface.pack` and `interface.order`;
      `dmm_safe_box` 40496, `:inv` 40589, `dmm_safe_box_side:inv` 40592, mirrored in
      `webclient/src/bot/types.ts` and `sdk/index.ts`). Upstream file:
      `interface_bank/scripts/banker.rs2` `talk_to_banker` offers it as option 2 (`p_choice3`),
      keeping the bank first because `bot.openBank()` clicks the first option. SDK:
      `state.safeBox`, `sendSafeBoxStore/Withdraw` (the trade code's `sendInvButton`),
      `bot.openSafeDepositBox/storeInSafeDepositBox/withdrawFromSafeDepositBox`. Verify: the
      fixture test, and `bun test sdk/test/safe-box.test.ts`.
- [ ] **Breaches and sigils** — `engine/pvp/Breaches.ts` (fork-only) and `World.cycleBreaches` /
      `World.onBreachGuardianKilled` (called from `NPC_DEL` in `handlers/NpcOps.ts` for
      `breach_guardian`); `web/pages/breach.ts` (`/api/breach`, routed in `web/index.ts`).
      Content (fork-only): `pvp_world/configs/breach.npc`, `dmm_sigils.obj`,
      `scripts/dmm_breaches.rs2`; varp `breach_points` **1007**; npcs `breach_guardian` **2046**,
      `breach_warden` **2047** (`npc.pack`; NPC ids must stay under **2048**: NPC info sends the
      type in 11 bits); objs **10001-10005** sigils (`obj.pack`); the warden's spawn in
      `maps/m50_50.jm2` (`0 25 20: 2047`). Sigil hooks in upstream files, each marked:
      `player_melee.rs2` and `pvp_melee.rs2` (fury), `pvp_combat.rs2` `[queue,pvp_damage]`
      (stone), `consume_effects.rs2` stat heal (feast); `pvp_world.rs2` (escape). Verify: `bun
      test server/engine/test/breaches.test.ts` and the fixture tests.
- [ ] **Seasons** — `util/Environment.ts`: `SEASON` (default 1) sets `node.profile` to
      `season-N` from season 2 on, unless `NODE_PROFILE` is set. `engine/market/MarketStore.ts`
      `marketDatabasePath()`: `market.season-N.sqlite` beside `GE_DATABASE` from season 2 on
      (the exchange checkpoints override saves, so they must start empty too).
      `web/pages/hiscores.ts`: pages default to the running profile instead of `'main'`; the PvP
      board names the season and links the earlier ones. Verify: `bun test
      server/engine/test/seasons.test.ts`.
- [ ] **PvP kills** (`docs/PVP_PLAN.md` item 3). Opcode **10012** `PVP_KILL` (`ScriptOpcode.ts`,
      `ScriptOpcodePointers.ts`, handler in `handlers/DebugOps.ts`), declared in
      `content/scripts/engine.rs2` and called in `player/scripts/death.rs2` before
      `~dmm_death_to_player`. `World.notifyPvpKill` values the risk and judges the kill with
      `engine/pvp/PvpKills.ts` (fork-only), posts `pvp_kill` through `LoggerThread`/
      `LoggerClient`/`LoggerServer`, and broadcasts counted kills. Table `pvp_kill` in both
      prisma schemas (migration `20261022000000_pvp_kill`) and `db/types.ts`. Page
      `handleHiscoresPvpPage` in `web/pages/hiscores.ts` (routed in `web/index.ts` and
      `hiscoresServer.ts`, linked from the sidebar). Verify: `bun test
      server/engine/test/pvp-kills.test.ts`.
- [ ] **Registration caps** — `engine/src/server/login/RegistrationLimiter.ts` (fork-only);
      `LoginServer.ts` caps both auto-registration paths (`player_login` answers 9, "Login
      limit exceeded"), and `sdk_auth` checks IP bans and records the IP the gateway now sends
      (`authenticateSDK(…, ip)` in `gateway.ts`). `REGISTRATIONS_PER_IP_PER_HOUR` /
      `REGISTRATIONS_PER_HOUR` in `Environment.ts`.
- [ ] **Fair play (player accounts)** — fork-only `engine/src/server/accounts/Players.ts`
      (players are keyed hashes of an owner-made invite code or a phone number, `player_bot`
      slots per season, claims, API keys, disabling, `mayLogIn`); the owner's invites page
      `/account/invites` is also in `web/owner.ts`'s owner-only list; `PLAYER_SIGNUP` picks
      invite (default) or phone; migration `20261022120000_player_invites` adds `note`,
      `first_sign_in` and `disabled` to `player`;
      `accounts/PhoneVerify.ts` (Twilio Verify, Turnstile) and `web/pages/account.ts`
      (`/account`, `/api/bots`, `/api/accounts`, routed at the top of `web/index.ts`). In
      `LoginServer.ts`, with `PLAYER_ACCOUNTS` (enforced only when `accountsReady()` in
      `Environment.ts`), both auto-registration paths are off and both login paths refuse an
      account with no slot this season: `player_login` answers 5 ("account disabled"), and
      `sdk_auth` explains. Tables `player` and `player_bot` are in both prisma schemas
      (migration `20261022100000_player_accounts`) and `db/types.ts`.
      `webclient/src/lite/runner.ts` turns "account disabled" into a claim hint when the
      server reports fair play. `bots/create-bot.ts` takes `PVP_SDK_KEY`/`--key=` and
      `--claim`. Verify: `bun test server/engine/test/player-accounts.test.ts`.
- [ ] **`fly.toml`: no 43594 service.** The login block is encrypted with the committed RSA key.
- [ ] **`bots/create-bot.ts --local`** — the `SERVER=localhost` rewrite matches `\r?\n`. The
      template is CRLF on a Windows checkout, and upstream's `'\n'` match silently left a bot
      dialling port 80. Upstream bug too; drop once fixed there.
- [ ] **`webclient/src/bot/StateCollector.ts` `hasSkullIcon`** — `state.isSkulled` reads bit 0
      (`^headicon_skull`) of our own head icons. Upstream reads varp 78 (`pk_skull`), which has
      no `transmit=yes`, so it always reported false. `collectNearbyPlayers` sets each player's
      `isSkulled` the same way (`NearbyPlayer` in both `bot/types.ts` and `sdk/types.ts`), and
      `sdk/formatter.ts` prints `SKULLED` / `[skulled]`. `collectSkullTicks` turns varp 1005
      into `state.skullTicksRemaining`. `sdk/pvp.ts` (fork-only) mirrors the safe areas,
      Wilderness and level range; `sdk/test/pvp-rules.test.ts` fails if the content tables move
      without it. `BotActions.attackPlayerEntity` attaches its warnings but never refuses. Verify: `cd server/webclient && bun test
      src/bot/StateCollector.test.ts`, and `bun test sdk/test/state-summary.test.ts`.
- [ ] **PvP kit: Tele Block** — fork-only `content/scripts/pvp_kit/scripts/tele_block.rs2`,
      `pvp_kit/configs/tele_block.{dbrow,seq,spotanim}` and the impact graphic in
      `content/models/pvp_kit/` (377-wip's animset 461, model 5799, seq 1822, spotanim 345), by
      `engine/tools/pvp/import377TeleBlock.ts`, which also draws the icon into tile 5 of
      `sprites/magicon2.png` and `magicoff2.png`. Upstream files touched: `magic.if` (the button
      and its hover panel at the end, components 40593-40602 in `interface.pack` and
      `interface.order`), `spells.constant` (`^tele_block = 105`), `teleport.rs2`
      (`~pre_tele_checks`), the four Wilderness levers (`wilderness_lever.rs2`,
      `king_black_dragon.rs2`), `login.rs2` and `death.rs2`. Varps 1008/1009 in
      `pvp_world.varp`. SDK: `teleBlockTicksRemaining` (StateCollector, both types files,
      formatter), `Spells.TELE_BLOCK`. Verify: `bun test server/engine/test/pvp-world.test.ts`.
- [ ] **PvP kit: abyssal whip and granite maul** (`docs/PVP_PLAN.md` item 6), ported from
      LostCity's Content repository, branch `377-wip` (MIT). Fork-only: `content/scripts/pvp_kit/`
      (objs, seqs, spotanims, the whip's style table and combat tab, wield requirements),
      `content/models/pvp_kit/`, `content/synth/pvp_kit/`, and `engine/tools/pvp/import377Weapons.ts`,
      which regenerates every binary there from a 377-wip checkout.
      **377 re-rigged the player** (117 skeleton groups to 289's 89, vertex labels renumbered), so
      377's player frames and worn models can't be copied: the tool re-encodes the 96 player
      frames against 289's own player base (groups 0-88 are the same bones; the whip's 377-only
      lash groups 90-102 are dropped, so the lash swings rigidly) and puts the worn models on
      289's held-weapon label 50 with no face labels. Any later 377 port (Barrows) needs the same.
      Ids, 377's wherever 289 leaves them free: obj **4151-4154** (whip, noted whip, maul, noted
      maul; saves store these), model 5409/5410/5412/5413/5415/5416, seq 1658-1669, spotanim
      340-341, interface `combat_whip` 12290-12335 (`interface.pack` and `interface.order`),
      animsets 409-410 (the special attack graphics, with their own skeletons), frames
      12467-12483 and 12501-12596. Not 377's: animset **1044** (the player frames; 377 keeps them
      in its anim_28, a different set in 289), frames **33568-33573** (377 reused
      7071/7073/7076/7078/7080/7082, which are still player frames in 289), synths **975-978**
      (377 has them at 1079-1082, but the 289 client's `JagFX` tables hold ids below 1000).
      Upstream files: `skill_combat/scripts/combat.rs2` (`weapon_whip` style table),
      `player_attackstyles.rs2` (both `update_weapon_category` switches) and
      `sprites/combaticons3.png` (377's two whip icons pasted into 289's empty tiles 13-14; 289's
      tiles 0-12 stay, since 377's versions differ slightly). At a 377 upgrade, delete
      `pvp_kit/` and these pack lines: 377 brings the originals.
      Special attacks: `pvp_kit/scripts/{pvm,pvp}_{abyssal_whip,granite_maul}.rs2` (the PvM pair
      adapted to 289's `~npc_max_dealt` and sound loop count). Upstream files:
      `player/player_special_attack.rs2` and `pvp/pvp_special_attack.rs2` jump to the maul's
      special before their attack-delay check (377's next-tick "instant" smash) and gain an
      `abyssal_whip` case (377's PvP dispatcher lacks it, so its whip PvP special never ran);
      `player/specwep.rs2` adds `[if_button,combat_whip:specbar]` and 377's "You're not fighting
      anything." guard on the blunt bar for the maul. Specials only run from
      `[opplayer2,_]`/`[applayer2,_]` after `~pvp_is_attackable`, so the PvP gate covers them.
      The whip's run energy drain is inert while `NODE_INFINITE_RUN` (`Environment.ts`, default
      true, not set in `fly.toml`) refills everyone's run energy every tick.
      Source: breach guardians only (owner, 2026-10-22): every damager rolls `WHIP_CHANCE` 1%,
      else `MAUL_CHANCE` 2% (`engine/pvp/Breaches.ts`, handed out in `World.onBreachGuardianKilled`).
      289 has no Slayer monsters, and no shop sells them.
      Bots: `webclient/src/bot/StateCollector.ts` `COMBAT_STYLE_TABLES[12290]` describes the whip
      tab's styles (keyed by interface id, so it must follow `combat_whip` if it ever moves).
- [ ] Verify: `bun test server/engine/test/pvp-world.test.ts sdk/test/pvp-targeting.test.ts`
      from the repo root (needs built content). Server refusal wording is mirrored in
      `sdk/actions-helpers.ts` `PVP_REFUSALS` and in `RULES.md` — change them together.

---

## Cross-boundary invariants (how things actually break)

These are the rules derived from every severed-wire bug found so far:

1. **A custom `ServerGameProt` packet MUST ship with its webclient `ptype` receive branch in
   the same commit.** Unhandled game packets hit the client's T1 path → **logout**. (Global
   chat shipped engine-only in `47af85ff7` and silently kicked every out-of-range player on
   chat for a month.) Gateway messages / bot actions / state fields degrade silently;
   game packets do not.
2. **XP curve is duplicated** engine `Player.ts` ↔ webclient `Client.ts` (units differ ×10).
   Change one ⇒ change both.
3. **`MAP_RANDOM_EVENTS`** is duplicated engine opcode ↔ content rs2 command.
4. **BotAction unions are duplicated** `sdk/types.ts` ↔ `server/webclient/src/bot/types.ts`,
   and every action needs an `ActionExecutor` case.
5. **Tests must not hardcode opcode numbers** — use `ClientProt.*`/`ServerProt.*` (289 broke 11
   literal-opcode assertions in `bot/ClientInteraction.test.ts`; hand-built packets in
   `lite/*.test.ts` also encode packet layouts).
6. **tsc is necessary but not sufficient**: run `bunx tsc --noEmit` in BOTH engine and
   webclient after every sync (esbuild bundles despite TS errors), but `as any` client-field
   accesses and bot.ejs `clientInstance.*` references are invisible to it — grep-audit those.

## Post-sync verification (5 minutes)

```bash
# typecheck both (esbuild hides TS errors)
(cd server/engine && bunx tsc --noEmit) && (cd server/webclient && bunx tsc --noEmit)

# case-only rename check (macOS hides these from git)
comm -23 <(git ls-files | sort) <(find . -type f -not -path './.git/*' | sed 's|^\./||' | sort)

# custom packet pairing
grep -n "MESSAGE_PUBLIC = new ServerGameProt(255" server/engine/src/network/game/server/ServerGameProt.ts
grep -n "ptype === ServerProt.MESSAGE_PUBLIC" server/webclient/src/client/Client.ts

# XP curve parity (compare by eye: same formula, engine has *10, client doesn't)
grep -A2 "Math.pow(2.0, level / 10.0)" server/engine/src/engine/entity/Player.ts server/webclient/src/client/Client.ts

# boot + live endpoints after deploy
curl -so /dev/null -w "%{http_code}\n" https://pvp-sdk.fly.dev/{playercount,hiscores,mapview/}

# custom IDs: reserved ranges still above upstream, tail-appended ones past upstream's max
grep -n "^40000=\|^1000=" server/content/pack/{interface,varp}.pack
grep -n "grand_exchange_booth\|grand_exchange_teller" server/content/pack/{loc,npc}.pack
tail -1 server/content/pack/{loc,npc}.pack

# end-to-end: login a bot, chop a tree 3+ tiles away (exercises walk-before-op),
# have a second distant bot chat (exercises MESSAGE_PUBLIC both directions),
# deposit at a bank + open the GE (exercises inventory packet layouts + custom ids)
```

If content map files changed: regenerate `sdk/collision-data.json` from the MEMBERS prod server:
`curl https://pvp-sdk.fly.dev/api/exportCollision > sdk/collision-data.json`
