// pvp-sdk: PvP kill tracking for /hiscores/pvp and the kill feed. death.rs2 calls the
// pvp_kill command before the loot moves (PVP_KILL in DebugOps.ts); this file values
// what the victim risked, decides whether the kill counts, and turns kill rows into
// leaderboards. Nothing here touches the game state.

/** Bank stacks a skulled death raids, as ^dmm_key_stacks in pvp_world.constant. */
export const RAIDED_STACKS = 10;
/** A kill counts only if the victim risked at least this much (store value, gp); the
 * PVP_KILL_MIN_RISK env var overrides it. */
export const MIN_RISK_GP = 1000;
/** The same two players' kills on each other count once per this long, either way. */
export const PAIR_COOLDOWN_MS = 60 * 60 * 1000;

export type Stack = { id: number; count: number };
export type CostOf = (id: number) => { cost: number; tradeable: boolean } | null;

const stackValue = (cost: CostOf, s: Stack) => {
    const type = cost(s.id);
    return type && type.tradeable ? Math.max(type.cost, 1) * s.count : 0;
};

/**
 * Everything the killer stands to gain: what the victim carries and wears, the Bank
 * keys they hold, and - when skulled - their most valuable tradeable bank stacks.
 */
export function riskedValue(cost: CostOf, carried: Stack[], keys: Stack[], bank: Stack[], skulled: boolean): number {
    let total = 0;
    for (const s of carried) total += stackValue(cost, s);
    for (const s of keys) total += stackValue(cost, s);
    if (skulled) {
        const top = bank.map(s => stackValue(cost, s)).filter(v => v > 0).sort((a, b) => b - a).slice(0, RAIDED_STACKS);
        for (const v of top) total += v;
    }
    return Math.min(total, 2_147_483_647);
}

/** An address two players can be compared by, or null: loopback means a local stack,
 * where every client shares one address. */
export function comparableIp(ip: string | null | undefined): string | null {
    if (!ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('::ffff:127.')) return null;
    return ip;
}

export type KillVerdict = { counted: true; reason: null } | { counted: false; reason: 'same_ip' | 'repeat_pair' | 'no_risk' };

/**
 * Anti-farming: a kill counts only when the two players come from different addresses,
 * the victim risked something, and the same pair hasn't had a counted kill (either way)
 * within PAIR_COOLDOWN_MS. Pairs live in memory, so a restart forgets them.
 */
export class KillJudge {
    private readonly lastCounted = new Map<string, number>();

    constructor(private readonly cooldownMs = PAIR_COOLDOWN_MS, private readonly minRisk = MIN_RISK_GP) {}

    judge(killer: string, victim: string, killerIp: string | null, victimIp: string | null, value: number, now: number): KillVerdict {
        if (killerIp && victimIp && killerIp === victimIp) return { counted: false, reason: 'same_ip' };
        if (value < this.minRisk) return { counted: false, reason: 'no_risk' };
        const pair = [killer, victim].sort().join('\u0000');
        const last = this.lastCounted.get(pair);
        if (last !== undefined && now - last < this.cooldownMs) return { counted: false, reason: 'repeat_pair' };
        this.lastCounted.set(pair, now);
        if (this.lastCounted.size > 50_000) {
            for (const [key, at] of this.lastCounted) if (now - at >= this.cooldownMs) this.lastCounted.delete(key);
        }
        return { counted: true, reason: null };
    }
}

export type KillRow = { timestamp: number; killer: string; victim: string; value: number };
export type PvpBoardRow = { username: string; kills: number; deaths: number; bestStreak: number; loot: number };

/**
 * One leaderboard from counted kill rows: kills, deaths, best streak (kills between
 * deaths) and the value of what their victims risked. Sorted by kills, then loot.
 */
export function pvpBoard(rows: KillRow[], hidden: (name: string) => boolean, size: number): PvpBoardRow[] {
    const stats = new Map<string, PvpBoardRow & { streak: number }>();
    const of = (name: string) => {
        let s = stats.get(name);
        if (!s) stats.set(name, (s = { username: name, kills: 0, deaths: 0, bestStreak: 0, loot: 0, streak: 0 }));
        return s;
    };
    for (const row of [...rows].sort((a, b) => a.timestamp - b.timestamp)) {
        const k = of(row.killer);
        k.kills++;
        k.loot += row.value;
        k.streak++;
        k.bestStreak = Math.max(k.bestStreak, k.streak);
        const v = of(row.victim);
        v.deaths++;
        v.streak = 0;
    }
    return [...stats.values()]
        .filter(s => s.kills > 0 && !hidden(s.username))
        .sort((a, b) => b.kills - a.kills || b.loot - a.loot || a.username.localeCompare(b.username))
        .slice(0, size)
        .map(({ streak: _streak, ...row }) => row);
}
