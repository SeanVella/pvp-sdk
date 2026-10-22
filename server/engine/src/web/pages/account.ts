// pvp-sdk: fair play (docs/FAIR_PLAY.md). /account is where a player proves they're one
// person (the invite code the owner gave them, or with PLAYER_SIGNUP=phone a texted code behind
// Cloudflare Turnstile) and manages their BOTS_PER_PLAYER bots for the season; /api/bots is the
// same for bots/create-bot.ts, with the player's API key. /account/invites is the owner's.
// The rules themselves live in server/accounts/Players.ts. The pages are styled like the
// game's own stone interfaces (design: https://claude.ai/artifact/UXrJX9VdoyDQeatdoC9Qi4).
import RegistrationLimiter from '#/server/login/RegistrationLimiter.js';
import PlayerAccounts, { normalizePhone, phoneHash, PLAYER_COOKIE, readSession, sessionMaxAgeSeconds, signSession } from '#/server/accounts/Players.js';
import type { BotSlot, PlayerRow } from '#/server/accounts/Players.js';
import type { PhoneVerifier } from '#/server/accounts/PhoneVerify.js';

export type AccountDeps = {
    accounts: PlayerAccounts;
    /** How players prove they're one person: an invite code from the owner, or a texted code. */
    signup: 'invite' | 'phone';
    /** The server owner (web/owner.ts), who makes the invites. */
    isOwner: (req: Request) => boolean;
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
const WHY_URL = 'https://github.com/SeanVella/pvp-sdk/blob/pvp-world/docs/FAIR_PLAY.md';
const RULES_URL = 'https://github.com/SeanVella/pvp-sdk/blob/pvp-world/RULES.md';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function createAccountRoutes(deps: AccountDeps): Handler {
    const now = deps.now ?? Date.now;
    // Each text costs money: per address, per number and per day. A send the SMS provider
    // refused cost nothing and gives its places back.
    const smsByIp = new RegistrationLimiter(deps.smsPerIpPerHour, 0, HOUR, now);
    const smsByPhone = new RegistrationLimiter(3, 0, HOUR, now);
    const smsDaily = new RegistrationLimiter(0, deps.smsPerDay, 24 * HOUR, now);
    // Code and password guesses: Twilio stops a code after 5 tries; this stops the rest.
    const guesses = new RegistrationLimiter(20, 0, HOUR, now);

    const configured = deps.secret !== '' && (deps.signup === 'invite' || deps.verifier !== null);
    const { season, botsPerPlayer } = deps.accounts;
    const layout = (title: string, body: string, opts: { turnstile?: boolean; status?: number } = {}) => page(title, body, season, botsPerPlayer, opts);

    async function signedInPlayer(req: Request): Promise<number | null> {
        const cookie = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${PLAYER_COOKIE}=([^;]+)`));
        const id = cookie ? readSession(decodeURIComponent(cookie[1]!), deps.secret, now()) : null;
        // a player the owner disabled is signed out everywhere
        return id !== null && (await deps.accounts.isActive(id)) ? id : null;
    }

    async function apiPlayer(req: Request): Promise<number | null> {
        const auth = req.headers.get('authorization');
        return auth?.startsWith('Bearer ') ? deps.accounts.playerForApiKey(auth.slice(7).trim()) : null;
    }

    async function dashboard(playerId: number, notice: string = ''): Promise<Response> {
        const bots = await deps.accounts.bots(playerId);
        const full = bots.length >= botsPerPlayer;
        const slots = Array.from({ length: botsPerPlayer }, (_, i) => slot(bots[i]));
        return layout(`Your bots: season ${season}`, `
${notice}
<div class="split"><p class="m0"><b class="y">${bots.length}</b> of <b class="y">${botsPerPlayer}</b> slots used</p>
<p class="m0 small muted">A slot stays used all season, so pick names you'll keep.</p></div>
${deps.enforced ? '' : '<p class="alert note">Fair play isn\'t switched on yet: any account can still log in. Claim your bots now so they keep working when it is.</p>'}
<div class="slots">${slots.join('')}</div>
${full ? '' : `
<section class="sect"><h2>Create a bot</h2>
<form method="post" action="/account/bots" class="row">
<label class="grow">Name (1-12 letters or digits)<input name="name" required maxlength="12" pattern="[A-Za-z0-9]{1,12}" autocomplete="off"></label>
<button class="btn">Create</button>
</form></section>
<section class="sect"><h2>Claim a bot you already have</h2>
<p class="m0 small muted">Accounts made before fair play only log in once they're in someone's slots. The password in its <code>bot.env</code> proves it's yours.</p>
<form method="post" action="/account/claim" class="row">
<label class="grow">Name<input name="name" required maxlength="12" autocomplete="off"></label>
<label class="grow">Password<input name="password" type="password" required autocomplete="off"></label>
<button class="btn">Claim</button>
</form></section>`}
<section class="sect"><h2>API key</h2>
<p class="m0 small muted">For <code>bun bots/create-bot.ts</code>: put <code>PVP_SDK_KEY=&lt;key&gt;</code> in the project's <code>.env</code> and it makes bots in your slots, or claims old ones with <code>--claim</code>. A new key replaces the old one.</p>
<div class="split">
<form method="post" action="/account/key" class="m0"><button class="btn">Create a new key</button></form>
<form method="post" action="/account/signout" class="m0"><button class="btn quiet">Sign out</button></form>
</div></section>`);
    }

    function signInPage(error: string = ''): Response {
        if (!configured) {
            return layout('Your bots', '<p class="m0">Sign-up isn\'t set up on this server yet.</p>', { status: 503 });
        }
        if (deps.signup === 'invite') {
            return layout('Your bots', `
<p class="m0">Every player gets <b class="y">${botsPerPlayer} bots</b> a season. To keep that fair, the server owner gives each player one invite code. Ask them for yours.</p>
<p class="m0 muted">Your code is also how you sign in later, so keep it somewhere safe. <a href="${WHY_URL}">Why?</a></p>
${error ? `<p class="alert error" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/account/invite" class="stack">
<label>Invite code<input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="PVP-XXXX-XXXX-XXXX-XXXX" required autofocus class="wide"></label>
<div><button class="btn">Sign in</button></div>
</form>`);
        }
        return layout('Your bots', `
<p class="m0">Every player gets <b class="y">${botsPerPlayer} bots</b> a season. To make sure each player is one person, sign in with a mobile number and we'll text you a code.</p>
<p class="m0 muted">We keep only a one-way hash of your number, never the number itself. <a href="${WHY_URL}">Why we ask</a></p>
${error ? `<p class="alert error" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/account/sms" class="stack">
<label>Mobile number, with country code<input name="phone" type="tel" autocomplete="tel" placeholder="+356 9912 3456" required autofocus class="wide"></label>
${deps.turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${esc(deps.turnstileSiteKey)}" data-theme="dark"></div>` : ''}
<div><button class="btn">Text me a code</button></div>
</form>`, { turnstile: deps.turnstileSiteKey !== '' });
    }

    function codePage(phone: string, error: string = ''): Response {
        return layout('Enter your code', `
<p class="m0">We texted a code to <b class="w">${esc(phone.slice(0, 4))}&hellip;${esc(phone.slice(-2))}</b>. It expires in <b class="y">10 minutes</b>.</p>
${error ? `<p class="alert error" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/account/verify" class="stack">
<input type="hidden" name="phone" value="${esc(phone)}">
<label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4,10}" required autofocus class="code" placeholder="123456"></label>
<div class="row"><button class="btn">Sign in</button><a href="/account">Use a different number</a></div>
</form>`);
    }

    function shownOnce(title: string, intro: string, secret: string, hint: string, back: [string, string] = ['/account', 'Back to your bots']): Response {
        return layout(title, `
<p class="m0">${intro}</p>
<p class="m0 y" role="alert">Save it now: it won't be shown again.</p>
<div class="scroll"><pre id="secret">${esc(secret)}</pre></div>
<div class="row"><button type="button" class="btn" onclick="navigator.clipboard.writeText(document.getElementById('secret').textContent).then(() => { this.textContent = 'Copied'; })">Copy</button>
<a href="${back[0]}">${back[1]}</a></div>
${hint ? `<p class="m0 small muted">${hint}</p>` : ''}`);
    }

    function invitesPage(players: PlayerRow[]): Response {
        const rows = players.length
            ? players.map(p => `<tr><td>${p.note ? esc(p.note) : '<span class="faint">(no note)</span>'}</td><td>${esc(shortDate(p.created))}</td>` +
                  `<td>${p.firstSignIn ? esc(shortDate(p.firstSignIn)) : '<span class="faint">not yet</span>'}</td><td>${p.bots} / ${botsPerPlayer}</td>` +
                  `<td>${p.disabled ? '<span class="err">disabled</span>' : 'active'}</td><td class="acts">` +
                  `<form method="post" action="/account/invites/reissue" class="m0"><input type="hidden" name="id" value="${p.id}"><button class="btn small">New code</button></form>` +
                  `<form method="post" action="/account/invites/${p.disabled ? 'enable' : 'disable'}" class="m0"><input type="hidden" name="id" value="${p.id}"><button class="btn small quiet">${p.disabled ? 'Enable' : 'Disable'}</button></form>` +
                  '</td></tr>').join('')
            : '<tr><td colspan="6" class="faint">No players yet.</td></tr>';
        return layout('Invites', `
<p class="m0">Each invite is one player, with ${botsPerPlayer} bots a season. Give one code to one person. Disabling a player stops all their bots from logging in.</p>
${deps.enforced ? '' : '<p class="alert note">Fair play isn\'t switched on yet (PLAYER_ACCOUNTS): any account can still log in.</p>'}
<form method="post" action="/account/invites" class="row">
<label class="grow">Who is it for? (a note only you see)<input name="note" maxlength="100" autocomplete="off" placeholder="e.g. Alex from Discord"></label>
<button class="btn">Make an invite</button>
</form>
<div class="table"><table><tr><th>Player</th><th>Invited</th><th>First sign-in</th><th>Bots</th><th>Status</th><th></th></tr>${rows}</table></div>`);
    }

    function inviteShown(title: string, code: string, host: string): Response {
        return shownOnce(title, "Send this to them. Only a hash of the code is kept, so it can't be shown again; make a new code if it's lost.",
            `You're invited to PvP-SDK.\nSign in at https://${host}/account with this code:\n${code}\nKeep it: it's also how you sign in later.`,
            '', ['/account/invites', 'Back to invites']);
    }

    function signIn(playerId: number, req: Request, url: URL): Response {
        const secure = url.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https' ? '; Secure' : '';
        return redirect('/account', `${PLAYER_COOKIE}=${encodeURIComponent(signSession(playerId, deps.secret, now()))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionMaxAgeSeconds()}${secure}`);
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
            return json({ enabled: deps.enforced, configured, season, botsPerPlayer, signup: '/account' });
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
                return json({ season, limit: botsPerPlayer, bots: await deps.accounts.bots(playerId) });
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

        if (path === '/account/invites' || path.startsWith('/account/invites/')) {
            // the owner's; everyone else sees nothing here (web/owner.ts)
            if (!deps.isOwner(req)) return new Response(null, { status: 404 });
            if (!configured) return layout('Invites', '<p class="m0">Set ACCOUNTS_SECRET first (docs/FAIR_PLAY.md).</p>', { status: 503 });
            if (req.method === 'GET') return invitesPage(await deps.accounts.players());
            const ownerForm = await req.formData().catch(() => null);
            const value = (name: string) => {
                const v = ownerForm?.get(name);
                return typeof v === 'string' ? v.trim() : '';
            };
            if (path === '/account/invites') {
                const made = await deps.accounts.createInvite(value('note'), deps.secret);
                return inviteShown('New invite', made.code, url.host);
            }
            const id = Number(value('id'));
            if (!value('id') || !Number.isSafeInteger(id)) return redirect('/account/invites');
            if (path === '/account/invites/reissue') {
                const code = await deps.accounts.reissueInvite(id, deps.secret);
                return code ? inviteShown('New code', code, url.host) : redirect('/account/invites');
            }
            if (path === '/account/invites/disable' || path === '/account/invites/enable') {
                await deps.accounts.setDisabled(id, path.endsWith('disable'));
            }
            return redirect('/account/invites');
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

        if (path === '/account/invite' && deps.signup === 'invite') {
            if (!guesses.tryRegister(`ip:${ip ?? 'unknown'}`)) return signInPage('Too many attempts. Try again in an hour.');
            const id = await deps.accounts.playerForInvite(field('code'), deps.secret);
            if (id === null) return signInPage("That code didn't work. Check it with the server owner.");
            return signIn(id, req, url);
        }

        if ((path === '/account/sms' || path === '/account/verify') && deps.signup !== 'phone') return signInPage();

        if (path === '/account/sms') {
            const phone = normalizePhone(field('phone'));
            if (!phone) return signInPage('Enter the full number with its country code, starting with +.');
            if (deps.allowedPrefixes.length && !deps.allowedPrefixes.some(p => phone.startsWith(p))) {
                return signInPage("Sign-up isn't open to that country's numbers.");
            }
            if (!(await deps.turnstile(field('cf-turnstile-response') || null, ip))) return signInPage('The human check failed. Try again.');
            const ipKey = ip ?? 'unknown';
            const phoneKey = phoneHash(phone, deps.secret);
            if (!smsByIp.tryRegister(ipKey)) return signInPage('Too many codes requested. Try again in an hour.');
            if (!smsByPhone.tryRegister(phoneKey)) {
                smsByIp.release(ipKey);
                return signInPage('Too many codes requested. Try again in an hour.');
            }
            if (!smsDaily.tryRegister('')) {
                smsByIp.release(ipKey);
                smsByPhone.release(phoneKey);
                return signInPage('Sign-up is busy today. Try again tomorrow.');
            }
            const sent = await deps.verifier!.send(phone);
            if (sent.ok) return codePage(phone);
            smsByIp.release(ipKey);
            smsByPhone.release(phoneKey);
            smsDaily.release('');
            return signInPage(sent.error);
        }

        if (path === '/account/verify') {
            const phone = normalizePhone(field('phone'));
            if (!phone) return signInPage();
            if (!guesses.tryRegister(`ip:${ip ?? 'unknown'}`)) return codePage(phone, 'Too many attempts. Try again in an hour.');
            if (!(await deps.verifier!.check(phone, field('code')))) return codePage(phone, "That code didn't work. Check it, or go back for a new one.");
            const id = await deps.accounts.playerForPhone(phoneHash(phone, deps.secret));
            if (id === null) return signInPage('That player has been disabled.');
            return signIn(id, req, url);
        }

        if (path === '/account/signout') {
            return redirect('/account', `${PLAYER_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
        }

        if (playerId === null) return signInPage();

        if (path === '/account/bots') {
            const made = await deps.accounts.createBot(playerId, field('name'), ip);
            if (!made.ok) return dashboard(playerId, `<p class="alert error" role="alert">${esc(made.error)}</p>`);
            return shownOnce(`Bot ${made.username} created`, 'Its <code>bot.env</code>:', botEnv(made.username, made.password, url.host),
                `Save it as <code>bots/${esc(made.username)}/bot.env</code>. With your API key, <code>bun bots/create-bot.ts</code> does all of this for you.`);
        }
        if (path === '/account/claim') {
            if (!guesses.tryRegister(`player:${playerId}`)) return dashboard(playerId, '<p class="alert error" role="alert">Too many attempts; try again in an hour.</p>');
            const claimed = await deps.accounts.claimBot(playerId, field('name'), field('password'));
            return dashboard(playerId, claimed.ok
                ? `<p class="alert ok" role="status">${esc(claimed.username)} is now one of your bots.</p>`
                : `<p class="alert error" role="alert">${esc(claimed.error)}</p>`);
        }
        if (path === '/account/reset') {
            const reset = await deps.accounts.resetPassword(playerId, field('name'));
            if (!reset.ok) return dashboard(playerId, `<p class="alert error" role="alert">${esc(reset.error)}</p>`);
            return shownOnce(`New password for ${reset.username}`, 'The old password stops working now. Its new <code>bot.env</code>:',
                botEnv(reset.username, reset.password, url.host), `Replace <code>bots/${esc(reset.username)}/bot.env</code> with it.`);
        }
        if (path === '/account/key') {
            const key = await deps.accounts.newApiKey(playerId);
            return shownOnce('Your API key', 'Your previous key, if you had one, no longer works.', `PVP_SDK_KEY=${key}`,
                'Add that line to the <code>.env</code> file in the project folder (it\'s gitignored), then <code>bun bots/create-bot.ts &lt;name&gt;</code> makes bots in your slots.');
        }
        return redirect('/account');
    };
}

/** One inventory-style slot: a bot with its "new password" button, or an empty space. */
function slot(bot: BotSlot | undefined): string {
    if (!bot) return '<div class="slot empty">Empty slot</div>';
    return `<div class="slot filled">
<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#ffff00" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M14.5 3.5 20.5 3.5 20.5 9.5 9 21 3 15Z"/><path d="M6 12 12 18"/><path d="M3 21 5.5 18.5"/></svg>
<span class="w name">${esc(bot.username)}</span>
<span class="tiny muted">Added ${esc(shortDate(bot.created))}</span>
<form method="post" action="/account/reset" class="m0"><input type="hidden" name="name" value="${esc(bot.username)}"><button class="btn small">New password</button></form>
</div>`;
}

/** "2026-10-22 11:26:01" -> "22 Oct" */
function shortDate(created: string): string {
    const m = created.match(/^\d{4}-(\d{2})-(\d{2})/);
    return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1] ?? ''}`.trim() : created;
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

// Stone panels with bevelled edges, orange text with a black shadow, yellow for numbers,
// parchment for secrets: the look of the game's own interfaces, in plain CSS.
const STYLE = `
:root { color-scheme: dark; --stone: #3e3529; --stone-dark: #2b241c; --edge: #14110d; --hi: #6e604c; --hi-btn: #7a6a55; --btn: #4a3f33; --well: #1a1611;
  --orange: #ff981f; --yellow: #ffff00; --text: #ece3cf; --muted: #c9b896; --faint: #a8987c; --err: #ff7a5c; --ok: #9fe07a; }
body { margin: 0; min-height: 100vh; background-color: #17130f; background-image: linear-gradient(#0d0b09 2px, transparent 2px), linear-gradient(90deg, #0d0b09 2px, transparent 2px); background-size: 72px 36px;
  font: 17px/1.55 system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: var(--text); }
.wrap { max-width: 760px; margin: 0 auto; padding: 28px 16px 64px; display: flex; flex-direction: column; gap: 22px; }
a { color: var(--yellow); } a:hover { color: #fff; }
.top, .foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 8px 24px; }
.mark { font-family: 'IM Fell English SC', Georgia, serif; font-size: 38px; color: var(--orange); text-decoration: none; text-shadow: 2px 2px 0 #000; }
.mark:hover { color: var(--yellow); }
nav { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 15px; }
.foot { font-size: 15px; color: var(--faint); }
.panel { background: var(--stone); border: 2px solid var(--edge); box-shadow: inset 2px 2px 0 var(--hi), inset -2px -2px 0 var(--stone-dark), 0 0 0 2px #5d5447, 0 18px 48px rgba(0,0,0,0.65); }
.bar { background: var(--stone-dark); border-bottom: 2px solid var(--edge); box-shadow: inset 0 -1px 0 var(--btn); padding: 12px 20px; text-align: center; }
h1, h2 { font-family: 'IM Fell English SC', Georgia, serif; font-weight: 400; color: var(--orange); text-shadow: 2px 2px 0 #000; }
h1 { margin: 0; font-size: 32px; } h2 { margin: 0; font-size: 24px; }
.body { padding: 24px 28px 30px; display: flex; flex-direction: column; gap: 18px; }
.m0 { margin: 0; } .y { color: var(--yellow); font-weight: 600; } .w { color: #fff; font-weight: 600; } .muted { color: var(--muted); } .faint { color: var(--faint); }
.small { font-size: 15px; } .tiny { font-size: 13px; }
code { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 0.85em; color: #fff; }
label { display: flex; flex-direction: column; gap: 8px; color: var(--orange); font-weight: 600; font-size: 15px; }
input { box-sizing: border-box; width: 100%; padding: 10px 12px; font: 400 17px system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #fff; background: var(--well);
  border: 2px solid var(--edge); box-shadow: inset 2px 2px 0 #0a0806, inset -1px -1px 0 var(--btn); outline: none; }
input:focus { border-color: var(--orange); }
input.wide { max-width: 420px; font-size: 18px; }
input.code { width: 220px; font-size: 26px; letter-spacing: 6px; text-align: center; font-variant-numeric: tabular-nums; color: var(--yellow); }
.btn { min-height: 46px; padding: 10px 24px; font: 600 16px system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: var(--orange); text-shadow: 1px 1px 0 #000; background: var(--btn);
  border: 2px solid var(--edge); box-shadow: inset 2px 2px 0 var(--hi-btn), inset -2px -2px 0 var(--stone-dark); cursor: pointer; }
.btn:hover { color: var(--yellow); } .btn:active { box-shadow: inset 2px 2px 0 var(--stone-dark), inset -2px -2px 0 var(--hi-btn); }
.btn:focus-visible { outline: 2px solid var(--yellow); outline-offset: 2px; }
.btn.small { min-height: 44px; padding: 6px 10px; font-size: 14px; }
.btn.quiet { color: var(--muted); background: var(--stone-dark); box-shadow: inset 1px 1px 0 var(--btn); font-weight: 400; font-size: 15px; }
.stack { display: flex; flex-direction: column; gap: 16px; margin: 4px 0 0; }
.row { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: flex-end; margin: 0; }
.row > a { align-self: center; font-size: 15px; }
.grow { flex: 1 1 220px; }
.split { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px 16px; }
.alert { margin: 0; padding: 10px 14px; border: 2px solid var(--edge); }
.alert.error { background: #2a1712; box-shadow: inset 1px 1px 0 #5a2a20; color: var(--err); }
.alert.ok { background: #1d2414; box-shadow: inset 1px 1px 0 #3d5a26; color: var(--ok); }
.alert.note { background: var(--stone-dark); box-shadow: inset 1px 1px 0 var(--btn); color: var(--muted); }
.slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 10px; padding: 10px; background: var(--stone-dark); border: 2px solid var(--edge); box-shadow: inset 2px 2px 0 var(--well), inset -1px -1px 0 var(--btn); }
.slot { min-height: 150px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 8px; text-align: center; }
.slot.filled { background: var(--stone); border: 2px solid var(--edge); box-shadow: inset 1px 1px 0 var(--hi), inset -1px -1px 0 var(--stone-dark); }
.slot.empty { justify-content: center; background: #241e17; border: 2px dashed var(--btn); color: #a8987c; font-size: 14px; }
.slot .name { font-size: 16px; word-break: break-all; }
.sect { display: flex; flex-direction: column; gap: 10px; padding-top: 18px; border-top: 2px solid var(--stone-dark); box-shadow: 0 -1px 0 var(--btn); }
.scroll { background: #e4d6b2; border: 2px solid var(--edge); box-shadow: inset 0 0 0 3px #c9b88f, inset 0 0 0 5px #e4d6b2, inset 0 0 18px rgba(110,80,40,0.35), 0 6px 18px rgba(0,0,0,0.5); padding: 22px 24px; text-shadow: none; }
.scroll pre { margin: 0; white-space: pre-wrap; word-break: break-all; font: 17px/1.6 ui-monospace, 'Cascadia Mono', Consolas, monospace; color: #2a1f12; }
.cf-turnstile { min-height: 65px; }
.table { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 15px; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--stone-dark); vertical-align: middle; }
th { color: var(--orange); font-weight: 600; }
td.acts { display: flex; flex-wrap: wrap; gap: 6px; }
.err { color: var(--err); }
`;

function page(title: string, body: string, season: number, botsPerPlayer: number, opts: { turnstile?: boolean; status?: number } = {}): Response {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - PvP-SDK</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IM+Fell+English+SC&amp;display=swap">
${opts.turnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
<style>${STYLE}</style></head><body><div class="wrap">
<header class="top"><a class="mark" href="/">PvP-SDK</a>
<nav aria-label="Site"><a href="/hiscores">Hiscores</a><a href="/hiscores/pvp">PvP board</a><a href="${RULES_URL}">Rules</a></nav></header>
<main class="panel"><div class="bar"><h1>${esc(title)}</h1></div><div class="body">${body}</div></main>
<footer class="foot"><span>Fair play: ${botsPerPlayer} bots per player, per season. <a href="${WHY_URL}">Why?</a></span><span>Season ${season}</span></footer>
</div></body></html>`;
    return new Response(html, { status: opts.status ?? 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
