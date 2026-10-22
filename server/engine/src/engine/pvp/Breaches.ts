// pvp-sdk: breaches (Deadman-style scheduled boss events). A breach opens at fixed UTC
// times, every BREACH_INTERVAL_MINUTES, so players can plan for them: a breach guardian
// spawns at a random multi-combat site, announced BREACH_WARNING_MINUTES ahead, and
// leaves after BREACH_DURATION_MINUTES if nobody kills it. Its death pays everyone who
// damaged it in breach points and may hand out sigils (dmm_breaches.rs2). World.ts
// drives this file; nothing here touches the game state.

export type BreachSite = { name: string; x: number; z: number };

/** Multi-combat ground (content/maps/multiway.csv) outside every safe area. */
export const BREACH_SITES: readonly BreachSite[] = [
    { name: 'Barbarian Village', x: 3080, z: 3422 },
    { name: 'Al Kharid', x: 3293, z: 3177 },
    { name: "the Wizards' Tower", x: 3109, z: 3165 },
    { name: 'the gnome battlefield', x: 2510, z: 3246 },
    { name: "the Dark Warriors' Fortress (level 15 Wilderness)", x: 3030, z: 3632 },
    { name: 'the bandit camp (level 23 Wilderness)', x: 3039, z: 3700 }
];

/** One breach point per this much damage, up to MAX_POINTS a breach. */
export const DAMAGE_PER_POINT = 5;
export const MAX_POINTS = 50;
/** Contributors who dealt this share of the guardian's hitpoints may win a sigil. */
export const SIGIL_MIN_SHARE = 0.05;
export const SIGIL_CHANCE = 0.2;

export type BreachEvent =
    | { kind: 'warn'; site: BreachSite; opensAt: number }
    | { kind: 'open'; site: BreachSite; closesAt: number }
    | { kind: 'close'; site: BreachSite };

/**
 * Says what should happen now: a warning, an opening or a closing. Breaches open at
 * multiples of the interval since the Unix epoch (so every 3 hours = 00:00, 03:00, ...
 * UTC), whatever time the server started.
 */
export class BreachSchedule {
    private warnedFor = -1;
    private openedFor = -1;
    private open: { site: BreachSite; closesAt: number } | null = null;
    private nextSite: BreachSite | null = null;

    constructor(
        readonly intervalMs: number,
        readonly warningMs: number,
        readonly durationMs: number,
        private readonly pickSite: () => BreachSite
    ) {}

    nextOpening(now: number): number {
        return Math.ceil(now / this.intervalMs) * this.intervalMs;
    }

    tick(now: number): BreachEvent[] {
        const events: BreachEvent[] = [];
        if (this.open && now >= this.open.closesAt) {
            events.push({ kind: 'close', site: this.open.site });
            this.open = null;
        }
        // The opening slot we're in, or the next one.
        const slot = Math.floor(now / this.intervalMs) * this.intervalMs;
        const next = slot + this.intervalMs;
        if (now >= next - this.warningMs && this.warnedFor !== next) {
            this.warnedFor = next;
            this.nextSite = this.pickSite();
            events.push({ kind: 'warn', site: this.nextSite, opensAt: next });
        }
        // Open at the start of a slot, only if it was announced (not right after a restart).
        if (now >= slot && now < slot + this.durationMs && this.openedFor !== slot && this.warnedFor === slot && this.nextSite) {
            this.openedFor = slot;
            this.open = { site: this.nextSite, closesAt: slot + this.durationMs };
            events.push({ kind: 'open', site: this.nextSite, closesAt: this.open.closesAt });
            this.nextSite = null;
        }
        return events;
    }

    /** The guardian died before its time was up. */
    guardianKilled(): BreachSite | null {
        const site = this.open?.site ?? null;
        this.open = null;
        return site;
    }

    status(now: number): { nextOpensAt: number; announced: { site: string; opensAt: number } | null; open: { site: string; closesAt: number } | null } {
        const upcoming = this.nextOpening(now);
        return {
            nextOpensAt: upcoming,
            announced: this.nextSite && this.warnedFor === upcoming ? { site: this.nextSite.name, opensAt: upcoming } : null,
            open: this.open ? { site: this.open.site.name, closesAt: this.open.closesAt } : null
        };
    }
}

export type Contributor = { username: string; damage: number; fortune: boolean };
export type Payout = { username: string; points: number; sigil: boolean };

/**
 * What each contributor gets: a point per DAMAGE_PER_POINT damage (at least 1, at most
 * MAX_POINTS, half as many again with a sigil of fortune); the top damage dealer always
 * wins a sigil, and anyone else who dealt SIGIL_MIN_SHARE of its hitpoints wins one with
 * SIGIL_CHANCE.
 */
export function breachPayouts(contributors: Contributor[], guardianHp: number, random: () => number): Payout[] {
    const sorted = [...contributors].filter(c => c.damage > 0).sort((a, b) => b.damage - a.damage);
    return sorted.map((c, i) => {
        let points = Math.min(MAX_POINTS, Math.max(1, Math.floor(c.damage / DAMAGE_PER_POINT)));
        if (c.fortune) points = Math.floor((points * 3) / 2);
        const sigil = i === 0 || (c.damage >= guardianHp * SIGIL_MIN_SHARE && random() < SIGIL_CHANCE);
        return { username: c.username, points, sigil };
    });
}
