// pvp-sdk: GET /api/breach - when the next breach opens, where it was announced, and the
// one open now (engine/pvp/Breaches.ts). All of it is announced to the world anyway.
import World from '#/engine/World.js';
import Environment from '#/util/Environment.js';

export function handleBreachApi(url: URL): Response | null {
    if (url.pathname !== '/api/breach' && url.pathname !== '/api/breach/') return null;
    const body = Environment.BREACHES ? { enabled: true, ...World.breaches.status(Date.now()) } : { enabled: false };
    return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
    });
}
