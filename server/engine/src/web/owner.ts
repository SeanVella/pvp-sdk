// pvp-sdk: routes only the server owner may use. In a world where anyone can attack
// anyone, live positions, everyone's worn gear and banks are a map for hunting, so
// they're hidden from players; screenshots write to the server, so they're closed too.
// The owner proves who they are with Environment.OWNER_TOKEN, sent as
// `Authorization: Bearer <token>` or as the cookie that POST /owner sets for browsers.
import { timingSafeEqual } from 'node:crypto';

import Environment from '#/util/Environment.js';

export const OWNER_COOKIE = 'pvp_owner';
const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

const OWNER_ONLY_PATHS = [
    /^\/playerpositions\/?$/,
    /^\/playertraces\/?$/,
    /^\/hi(?:gh)?scores\/(?:outfit|bank)\/?$/,
    /^\/api\/screenshot\/?$/,
    /^\/screenshots(?:\/|$)/,
    // fair play: the owner hands out the invite codes (web/pages/account.ts)
    /^\/account\/invites(?:\/|$)/
];

/** Live positions and movement history, everyone's gear and bank, screenshots, and invites. */
export function isOwnerOnlyPath(pathname: string): boolean {
    return OWNER_ONLY_PATHS.some(re => re.test(pathname));
}

/** Constant-time check against OWNER_TOKEN; always false while it's unset. */
export function isOwnerToken(candidate: string | null | undefined, token: string = Environment.OWNER_TOKEN): boolean {
    if (!token || !candidate) return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
}

export function isOwnerRequest(req: Request, token: string = Environment.OWNER_TOKEN): boolean {
    const auth = req.headers.get('authorization');
    if (auth?.startsWith('Bearer ') && isOwnerToken(auth.slice(7), token)) return true;
    const cookie = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${OWNER_COOKIE}=([^;]+)`));
    return cookie !== null && isOwnerToken(decodeURIComponent(cookie[1]!), token);
}

/** What everyone else gets: the route looks absent rather than locked. */
export function notFound(): Response {
    return new Response(null, { status: 404 });
}

/**
 * GET /owner shows a sign-in form; POST /owner with the token sets the owner cookie and
 * goes to the map. The token never goes in a URL, so it stays out of logs and history.
 */
export async function handleOwnerSignIn(req: Request, url: URL, token: string = Environment.OWNER_TOKEN): Promise<Response | null> {
    if (url.pathname !== '/owner' && url.pathname !== '/owner/') return null;
    if (!token) return notFound();

    if (req.method === 'POST') {
        const form = await req.formData().catch(() => null);
        const candidate = form?.get('token');
        if (typeof candidate !== 'string' || !isOwnerToken(candidate, token)) {
            return new Response('Wrong token.', { status: 403, headers: { 'Content-Type': 'text/plain' } });
        }
        const secure = url.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https' ? '; Secure' : '';
        return new Response(null, {
            status: 303,
            headers: {
                Location: '/mapview/',
                'Set-Cookie': `${OWNER_COOKIE}=${encodeURIComponent(candidate)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_S}${secure}`
            }
        });
    }

    return new Response(
        '<!doctype html><title>Owner</title><form method="post" action="/owner">' +
        '<label>Owner token <input type="password" name="token" autocomplete="current-password" autofocus></label> ' +
        '<button>Sign in</button></form>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
}
