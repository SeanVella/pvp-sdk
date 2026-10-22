// pvp-sdk: fair play (docs/FAIR_PLAY.md). /account is where a player proves they're one
// person (a texted code, behind Cloudflare Turnstile) and manages their BOTS_PER_PLAYER bots
// for the season; /api/bots is the same for bots/create-bot.ts, with the player's API key.
// The rules themselves live in server/accounts/Players.ts.
import RegistrationLimiter from '#/server/login/RegistrationLimiter.js';
import PlayerAccounts, { normalizePhone, phoneHash, PLAYER_COOKIE, readSession, sessionMaxAgeSeconds, signSession } from '#/server/accounts/Players.js';
import type { PhoneVerifier } from '#/server/accounts/PhoneVerify.js';

export type AccountDeps = {
    accounts: PlayerAccounts;
    verifier: PhoneVerifier | null;
    secret: string;
    /** Whether the login server enforces slots yet (PLAYER_ACCOUNTS). */
    enforced: boolean;
    turnstileSiteKey: string;
    turnstile: (token: string | null, ip: string | null) => Promise<boolean>;
    smsPerIpPerHour: number;
    smsPerDay: number;
    allowedPrefixes: string[];
    now?: () => number;
};

type Handler = (req: Request, url: URL, ip: string | null) => Promise<Response | null>;

const HOUR = 60 * 60 * 1000;

export function createAccountRoutes(deps: AccountDeps): Handler {
    const now = deps.now ?? Date.now;
    // Each text costs money: per address, per number and per day.
    const smsByIp = new RegistrationLimiter(deps.smsPerIpPerHour, 0, HOUR, now);
    const smsByPhone = new RegistrationLimiter(3, 0, HOUR, now);
    const smsDaily = new RegistrationLimiter(0, deps.smsPerDay, 24 * HOUR, now);
    // Code and password guesses: Twilio stops a code after 5 tries; this stops the rest.
    const guesses = new RegistrationLimiter(20, 0, HOUR, now);

    const configured = deps.verifier !== null && deps.secret !== '';

    async function signedInPlayer(req: Request): Promise<number | null> {
        const cookie = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${PLAYER_COOKIE}=([^;]+)`));
        return cookie ? readSession(decodeURIComponent(cookie[1]!), deps.secret, now()) : null;
    }

    async function apiPlayer(req: Request): Promise<number | null> {
        const auth = req.headers.get('authorization');
        return auth?.startsWith('Bearer ') ? deps.accounts.playerForApiKey(auth.slice(7).trim()) : null;
    }

    async function dashboard(playerId: number, notice: string = ''): Promise<Response> {
        const bots = await deps.accounts.bots(playerId);
        const { season, botsPerPlayer } = deps.accounts;
        const rows = bots.length
            ? bots.map(b => `<tr><td>${esc(b.username)}</td><td>${esc(b.created.slice(0, 10))}</td><td>` +
                  `<form method="post" action="/account/reset"><input type="hidden" name="name" value="${esc(b.username)}"><button>New password</button></form></td></tr>`).join('')
            : '<tr><td colspan="3">No bots yet.</td></tr>';
        const full = bots.length >= botsPerPlayer;
        return page(`Your bots - season ${season}`, `
${notice}
<h1>Your bots: season ${season}</h1>
<p>${bots.length} of ${botsPerPlayer} slots used. A slot stays used for the whole season, so pick names you'll keep.</p>
${deps.enforced ? '' : '<p class="note">Fair play isn\'t switched on yet: any account can still log in. Claim your bots now so they keep working when it is.</p>'}
<table><tr><th>Bot</th><th>Added</th><th></th></tr>${rows}</table>
${full ? '' : `
<h2>Create a bot</h2>
<form method="post" action="/account/bots"><label>Name (1-12 letters or digits) <input name="name" required maxlength="12" pattern="[A-Za-z0-9]{1,12}"></label> <button>Create</button></form>
<h2>Claim a bot you already have</h2>
<p>Accounts made before fair play only log in once they're in someone's slots. The password in its <code>bot.env</code> proves it's yours.</p>
<form method="post" action="/account/claim"><label>Name <input name="name" required maxlength="12"></label> <label>Password <input name="password" type="password" required></label> <button>Claim</button></form>`}
<h2>API key</h2>
<p>For <code>bun bots/create-bot.ts</code>: put <code>PVP_SDK_KEY=&lt;key&gt;</code> in the project's <code>.env</code> and it creates bots (or claims existing ones with <code>--claim</code>) in your slots. A new key replaces the old one.</p>
<form method="post" action="/account/key"><button>Create a new key</button></form>
<form method="post" action="/account/signout" class="out"><button>Sign out</button></form>`);
    }

    function signInPage(error: string = ''): Response {
        if (!configured) {
            return page('Sign up', '<h1>Sign up</h1><p>Sign-up isn\'t set up on this server yet.</p>', {}, 503);
        }
        return page('Sign in', `
<h1>Your bots</h1>
<p>Every player gets ${deps.accounts.botsPerPlayer} bots a season. To make sure each player is one person, sign in with a mobile number: we text you a code.
We keep only a one-way hash of the number, never the number itself. <a href="https://github.com/SeanVella/pvp-sdk/blob/pvp-world/docs/FAIR_PLAY.md">Why we ask</a></p>
${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/account/sms">
<label>Mobile number, with country code <input name="phone" type="tel" autocomplete="tel" placeholder="+356 9912 3456" required autofocus></label>
${deps.turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${esc(deps.turnstileSiteKey)}"></div>` : ''}
<button>Text me a code</button>
</form>`, { turnstile: deps.turnstileSiteKey !== '' });
    }

    function codePage(phone: string, error: string = ''): Response {
        return page('Enter your code', `
<h1>Enter your code</h1>
<p>We texted a code to ${esc(phone.slice(0, 4))}&hellip;${esc(phone.slice(-2))}. It expires in 10 minutes.</p>
${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/account/verify">
<input type="hidden" name="phone" value="${esc(phone)}">
<label>Code <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4,10}" required autofocus></label>
<button>Sign in</button>
</form>
<p><a href="/account">Use a different number</a></p>`);
    }

    function shownOnce(title: string, intro: string, secret: string, hint: string): Response {
        return page(title, `<h1>${esc(title)}</h1><p>${intro}</p><p class="note">Save it now: it won't be shown again.</p><pre>${esc(secret)}</pre><p>${hint}</p><p><a href="/account">Back to your bots</a></p>`);
    }

    function botEnv(username: string, password: string, host: string): string {
        return `BOT_USERNAME=${username}\nPASSWORD=${password}\nSERVER=${host}\nSHOW_CHAT=true\nTELEMETRY=true`;
    }

    return async (req, url, ip) => {
        const path = url.pathname.replace(/\/+$/, '') || '/';
        const isPage = path === '/account' || path.startsWith('/account/');
        const isApi = path === '/api/bots' || path === '/api/bots/claim' || path === '/api/accounts';
        if (!isPage && !isApi) return null;

        if (path === '/api/accounts') {
            return json({ enabled: deps.enforced, configured, season: deps.accounts.season, botsPerPlayer: deps.accounts.botsPerPlayer, signup: '/account' });
        }

        // Forms only from our own pages (the session cookie is SameSite=Strict as well).
        const origin = req.headers.get('origin');
        if (req.method === 'POST' && origin && origin !== 'null' && new URL(origin).host !== url.host) {
            return new Response('Cross-site request refused.', { status: 403 });
        }

        if (isApi) {
            if (!configured) return json({ error: 'Sign-up isn\'t set up on this server yet.' }, 503);
            const playerId = await apiPlayer(req);
            if (playerId === null) return json({ error: `Missing or unknown API key. Get one at ${url.origin}/account` }, 401);
            if (req.method === 'GET' && path === '/api/bots') {
                return json({ season: deps.accounts.season, limit: deps.accounts.botsPerPlayer, bots: await deps.accounts.bots(playerId) });
            }
            if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
            const body = (await req.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
            const name = typeof body.username === 'string' ? body.username : '';
            if (path === '/api/bots') {
                const made = await deps.accounts.createBot(playerId, name, ip);
                return made.ok ? json({ username: made.username, password: made.password }) : json({ error: made.error }, 409);
            }
            if (!guesses.tryRegister(`player:${playerId}`)) return json({ error: 'Too many attempts; try again in an hour.' }, 429);
            const claimed = await deps.accounts.claimBot(playerId, name, typeof body.password === 'string' ? body.password : '');
            return claimed.ok ? json({ username: claimed.username }) : json({ error: claimed.error }, 409);
        }

        const playerId = configured ? await signedInPlayer(req) : null;

        if (req.method === 'GET') {
            if (path !== '/account') return redirect('/account');
            return playerId === null ? signInPage() : dashboard(playerId);
        }
        if (req.method !== 'POST' || !configured) return signInPage();
        const form = await req.formData().catch(() => null);
        const field = (name: string) => {
            const value = form?.get(name);
            return typeof value === 'string' ? value.trim() : '';
        };

        if (path === '/account/sms') {
            const phone = normalizePhone(field('phone'));
            if (!phone) return signInPage('Enter the full number with its country code, starting with +.');
            if (deps.allowedPrefixes.length && !deps.allowedPrefixes.some(p => phone.startsWith(p))) {
                return signInPage("Sign-up isn't open to that country's numbers.");
            }
            if (!(await deps.turnstile(field('cf-turnstile-response') || null, ip))) return signInPage('The human check failed. Try again.');
            const key = ip ?? 'unknown';
            if (!smsByIp.tryRegister(key) || !smsByPhone.tryRegister(phoneHash(phone, deps.secret))) {
                return signInPage('Too many codes requested. Try again in an hour.');
            }
            if (!smsDaily.tryRegister('')) return signInPage('Sign-up is busy today. Try again tomorrow.');
            const sent = await deps.verifier!.send(phone);
            return sent.ok ? codePage(phone) : signInPage(sent.error);
        }

        if (path === '/account/verify') {
            const phone = normalizePhone(field('phone'));
            if (!phone) return signInPage();
            if (!guesses.tryRegister(`ip:${ip ?? 'unknown'}`)) return codePage(phone, 'Too many attempts. Try again in an hour.');
            if (!(await deps.verifier!.check(phone, field('code')))) return codePage(phone, "That code didn't work. Check it, or go back for a new one.");
            const id = await deps.accounts.playerForPhone(phoneHash(phone, deps.secret));
            const secure = url.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https' ? '; Secure' : '';
            return redirect('/account', `${PLAYER_COOKIE}=${encodeURIComponent(signSession(id, deps.secret, now()))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionMaxAgeSeconds()}${secure}`);
        }

        if (path === '/account/signout') {
            return redirect('/account', `${PLAYER_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
        }

        if (playerId === null) return signInPage();

        if (path === '/account/bots') {
            const made = await deps.accounts.createBot(playerId, field('name'), ip);
            if (!made.ok) return dashboard(playerId, `<p class="error">${esc(made.error)}</p>`);
            return shownOnce(`Bot ${made.username} created`, 'Its <code>bot.env</code>:', botEnv(made.username, made.password, url.host),
                `Save it as <code>bots/${esc(made.username)}/bot.env</code>. (With your API key, <code>bun bots/create-bot.ts</code> does all of this for you.)`);
        }
        if (path === '/account/claim') {
            if (!guesses.tryRegister(`player:${playerId}`)) return dashboard(playerId, '<p class="error">Too many attempts; try again in an hour.</p>');
            const claimed = await deps.accounts.claimBot(playerId, field('name'), field('password'));
            return dashboard(playerId, claimed.ok ? `<p class="ok">${esc(claimed.username)} is now one of your bots.</p>` : `<p class="error">${esc(claimed.error)}</p>`);
        }
        if (path === '/account/reset') {
            const reset = await deps.accounts.resetPassword(playerId, field('name'));
            if (!reset.ok) return dashboard(playerId, `<p class="error">${esc(reset.error)}</p>`);
            return shownOnce(`New password for ${reset.username}`, 'The old password stops working now. Its new <code>bot.env</code>:',
                botEnv(reset.username, reset.password, url.host), `Replace <code>bots/${esc(reset.username)}/bot.env</code> with it.`);
        }
        if (path === '/account/key') {
            const key = await deps.accounts.newApiKey(playerId);
            return shownOnce('Your API key', 'Your previous key, if you had one, no longer works.', `PVP_SDK_KEY=${key}`,
                'Add that line to the <code>.env</code> file in the project folder (it\'s gitignored), then <code>bun bots/create-bot.ts &lt;name&gt;</code> creates bots in your slots.');
        }
        return redirect('/account');
    };
}

function esc(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function json(body: unknown, status: number = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function redirect(location: string, cookie?: string): Response {
    const headers: Record<string, string> = { Location: location, 'Cache-Control': 'no-store' };
    if (cookie) headers['Set-Cookie'] = cookie;
    return new Response(null, { status: 303, headers });
}

function page(title: string, body: string, opts: { turnstile?: boolean } = {}, status: number = 200): Response {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${opts.turnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
<style>
:root { color-scheme: light dark; --bg: #f6f4ef; --fg: #1d1b18; --muted: #6b665c; --line: #d9d4c8; --accent: #8a5a00; --err: #a3261b; --ok: #2d6a2d; }
@media (prefers-color-scheme: dark) { :root { --bg: #171614; --fg: #ece8df; --muted: #a39d90; --line: #3a3732; --accent: #e0a842; --err: #ff7b6e; --ok: #7fc97f; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
main { max-width: 640px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 1.5rem; margin: 0 0 12px; } h2 { font-size: 1.1rem; margin: 28px 0 8px; }
a { color: var(--accent); } code, pre { font-family: ui-monospace, monospace; font-size: 0.9em; }
pre { background: color-mix(in srgb, var(--fg) 6%, transparent); border: 1px solid var(--line); padding: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
label { display: block; margin: 8px 0; } input { font: inherit; padding: 6px 8px; border: 1px solid var(--line); border-radius: 4px; background: transparent; color: inherit; max-width: 100%; }
button { font: inherit; padding: 6px 14px; border: 1px solid var(--accent); border-radius: 4px; background: transparent; color: var(--accent); cursor: pointer; }
table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--line); } td form { margin: 0; }
.note { color: var(--muted); } .error { color: var(--err); } .ok { color: var(--ok); } .out { margin-top: 32px; } .cf-turnstile { margin: 12px 0; }
</style></head><body><main>${body}</main></body></html>`;
    return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
