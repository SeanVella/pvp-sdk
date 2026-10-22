// pvp-sdk: caps how fast accounts appear. Accounts register themselves on their first
// login (game client or SDK), so without a cap anyone could mint throwaway characters by
// the thousand - in a PvP world, bait, alts and key-farming victims.
export default class RegistrationLimiter {
    private readonly byIp = new Map<string, number[]>();
    private all: number[] = [];

    /** 0 turns a cap off. Logins whose IP isn't known share the '' bucket. */
    constructor(
        private readonly perIp: number,
        private readonly total: number,
        private readonly windowMs: number = 60 * 60 * 1000,
        private readonly now: () => number = Date.now
    ) {}

    /** Records a registration from `ip` and returns true, or returns false at a cap. */
    tryRegister(ip: string): boolean {
        const now = this.now();
        const since = now - this.windowMs;
        this.all = this.all.filter(t => t > since);
        const mine = (this.byIp.get(ip) ?? []).filter(t => t > since);

        if ((this.total > 0 && this.all.length >= this.total) || (this.perIp > 0 && mine.length >= this.perIp)) {
            this.byIp.set(ip, mine);
            return false;
        }

        mine.push(now);
        this.all.push(now);
        this.byIp.set(ip, mine);
        if (this.byIp.size > 10_000) this.prune(since);
        return true;
    }

    /** Takes back the latest registration from `ip`, for one that didn't happen after all. */
    release(ip: string): void {
        const last = this.byIp.get(ip)?.pop();
        if (last === undefined) return;
        const i = this.all.lastIndexOf(last);
        if (i !== -1) this.all.splice(i, 1);
    }

    private prune(since: number): void {
        for (const [ip, times] of this.byIp) {
            if (!times.some(t => t > since)) this.byIp.delete(ip);
        }
    }
}
