import { tryParseBoolean, tryParseInt } from '#/util/TryParse.js';
import { loadWorldConfig, migrateFromLegacyEnv } from '#/util/WorldConfig.js';

// rs-sdk: 274 reads nested config from data/config/world.json only; it does NOT
// consult process.env. Deployments (fly.io [env], Docker -e, etc.) set the legacy
// flat env vars (WEB_PORT, LOGIN_SERVER, NODE_MEMBERS, ...), so overlay process.env
// on top of the loaded config — env vars win, absent keys fall back to world.json /
// defaults. Locally (no such vars set) this is a no-op.
const config = migrateFromLegacyEnv(loadWorldConfig(), process.env as Record<string, string>);

// pvp-sdk: seasons (docs/PVP_PLAN.md "Seasons"). Season 1 is the original world, on profile
// 'main'. Each later season starts every character over on its own profile, season-N
// (saves, hiscores, PvP kills are all keyed by profile), with its own exchange database
// (marketDatabasePath). Earlier seasons stay on disk, viewable on the hiscores with
// ?profile=; setting SEASON back brings one back. An explicit NODE_PROFILE wins.
const SEASON = Math.max(1, tryParseInt(process.env.SEASON, 1));
if (SEASON >= 2 && !process.env.NODE_PROFILE) {
    config.node.profile = `season-${SEASON}`;
}

export default {
    runtime: {
        maxNpcs: 16383
    },
    ...config,

    // ---------------------------------------------------------------------------
    // rs-sdk back-compat + custom config.
    // 274 moved server config into the nested WorldConfig object (Environment.web.port,
    // Environment.node.xpRate, ...). The rs-sdk bot framework (src/web/, hiscores,
    // login security) was written against the older flat Environment.* names, so we
    // expose flat aliases that map onto the nested config, plus a handful of
    // rs-sdk-only keys read straight from the environment.
    // ---------------------------------------------------------------------------

    // flat aliases -> 274 nested config
    WEB_PORT: config.web.port,
    WEB_MANAGEMENT_PORT: config.web.managementPort,
    WEBSITE_REGISTRATION: config.website.registration,
    NODE_ID: config.node.id,
    NODE_PORT: config.node.port,
    NODE_MEMBERS: config.node.members,
    NODE_PRODUCTION: config.node.production,
    NODE_DEBUG: config.node.debug,
    NODE_HOP_TIME: config.node.hopTime,

    // Restart the engine after changing this flag; no cache rebuild is required.
    GE_ENABLED: tryParseBoolean(process.env.GE_ENABLED, true),

    // rs-sdk-only keys (not part of upstream WorldConfig)
    WEB_SOCKET_TOKEN_PROTECTION: tryParseBoolean(process.env.WEB_SOCKET_TOKEN_PROTECTION, false),
    NODE_DEBUG_SOCKET: tryParseBoolean(process.env.NODE_DEBUG_SOCKET, false),
    // rs-sdk: default ON for 274. The 274 web client fetches on-demand assets over the
    // game WebSocket; with this off the engine terminates that socket and the client
    // stalls at ~60% ("Connecting to update server"). Required for the bot client to load.
    NODE_WS_ONDEMAND: tryParseBoolean(process.env.NODE_WS_ONDEMAND, true),
    NODE_INFINITE_RUN: tryParseBoolean(process.env.NODE_INFINITE_RUN, true),
    // When false, WordEnc.filter stops censoring chat (bad words, domains, TLDs)
    // but still normalizes casing. Also injected into the browser client via
    // bot.ejs/client.ejs so its local WordFilter matches; the lite client has no
    // config channel and reads PROFANITY_FILTER from bot.env instead.
    NODE_PROFANITY_FILTER: tryParseBoolean(process.env.NODE_PROFANITY_FILTER, true),
    NODE_RANDOM_EVENTS: tryParseBoolean(process.env.NODE_RANDOM_EVENTS, false),
    NODE_TICKRATE: tryParseInt(process.env.NODE_TICKRATE, 400),
    HISCORES_WEB_PORT: tryParseInt(process.env.HISCORES_WEB_PORT, 8889),
    // Read-only spectator feed of live players/npcs on ws /worldfeed (web/worldfeed.ts).
    // Off by default; set WORLD_FEED_TOKEN to require ?token= on connect.
    WORLD_FEED: tryParseBoolean(process.env.WORLD_FEED, false),
    WORLD_FEED_TOKEN: process.env.WORLD_FEED_TOKEN || '',
    // pvp-sdk: send this fork's npcs as base-game look-alikes (web/worldfeed.ts feedNpcType)
    WORLD_FEED_STAND_INS: tryParseBoolean(process.env.WORLD_FEED_STAND_INS, true),
    WORLD_FEED_MAX_CLIENTS: tryParseInt(process.env.WORLD_FEED_MAX_CLIENTS, 128),
    // Clients must send activity (the viewer sends a ping every 30s) to keep their slot.
    WORLD_FEED_IDLE_TIMEOUT_MS: tryParseInt(process.env.WORLD_FEED_IDLE_TIMEOUT_MS, 120_000),
    HISCORES_HIDDEN_NAMES: (process.env.HISCORES_HIDDEN_NAMES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    BANNED_USERNAME_WORDS: (process.env.BANNED_USERNAME_WORDS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),

    // pvp-sdk: the server owner's secret (a Fly secret, never fly.toml). It unlocks the
    // routes that would let players hunt each other - live positions, everyone's gear
    // and banks - and screenshots (web/owner.ts). Unset, those routes are closed to all.
    OWNER_TOKEN: process.env.OWNER_TOKEN || '',
    // pvp-sdk: accounts register themselves on first login; cap how fast (0 = no cap).
    REGISTRATIONS_PER_IP_PER_HOUR: tryParseInt(process.env.REGISTRATIONS_PER_IP_PER_HOUR, 10),
    REGISTRATIONS_PER_HOUR: tryParseInt(process.env.REGISTRATIONS_PER_HOUR, 200),
    // pvp-sdk: a kill counts toward /hiscores/pvp only if the victim risked this much (gp)
    PVP_KILL_MIN_RISK: tryParseInt(process.env.PVP_KILL_MIN_RISK, 1000),
    // pvp-sdk: breaches (engine/pvp/Breaches.ts) open every BREACH_INTERVAL_MINUTES at
    // fixed UTC times, announced BREACH_WARNING_MINUTES ahead, for BREACH_DURATION_MINUTES.
    BREACHES: tryParseBoolean(process.env.BREACHES, true),
    BREACH_INTERVAL_MINUTES: tryParseInt(process.env.BREACH_INTERVAL_MINUTES, 180),
    BREACH_WARNING_MINUTES: tryParseInt(process.env.BREACH_WARNING_MINUTES, 10),
    BREACH_DURATION_MINUTES: tryParseInt(process.env.BREACH_DURATION_MINUTES, 20),
    SEASON
};
