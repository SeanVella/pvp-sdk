// pvp-sdk: the guarded towns of pvp_safe_zones.dbrow, traced from the map. Usage, from server/engine:
//
//   bun tools/pvp/safeZones.ts             # print each town's zones and how much of it they cover
//   bun tools/pvp/safeZones.ts --write     # rewrite pvp_safe_zones.dbrow and sdk/pvp.ts's mirror
//   bun tools/pvp/safeZones.ts --png=DIR   # also draw each town and its zones to DIR/<town>.png
//
// A walled town's zone is the ground inside its walls. The countryside is flooded in from the edge
// of a box around the town, stopped by walls (doors and gates count as shut), solid objects and
// water; the town is what the flood can't reach around its seed tiles. Open gateways would let the
// flood in, so each one is plugged. Rectangles then cover the town greedily: never open ground
// outside the walls, though walls, water and trees (where nobody stands) when that saves one.
// Lumbridge has no walls and the two bank zones are single buildings, so those are drawn by hand.
//
// When a zone grows, raise ^dmm_rules_version in pvp_world.constant, so skulls saved where the
// zone was open ground are cleared at login instead of meeting the guards (~dmm_rules_login).

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const CONTENT = path.resolve(import.meta.dirname, '../../../content');
const DBROW = `${CONTENT}/scripts/pvp_world/configs/pvp_safe_zones.dbrow`;
const SDK_PVP = path.resolve(import.meta.dirname, '../../../../sdk/pvp.ts');

type Box = { x0: number; z0: number; x1: number; z1: number };
type Zone = Box & { minLevel: number; maxLevel: number };
const box = (x0: number, z0: number, x1: number, z1: number): Box => ({ x0, z0, x1, z1 });

interface Town {
    name: string;
    note: string;
    /** Hand-drawn zones; a traced town leaves this out. */
    zones?: Zone[];
    /** The area searched: the town and some countryside all round. */
    box?: Box;
    /** Tiles inside the town; ground they can't reach without crossing a wall isn't the town. */
    seeds?: [number, number][];
    /** Open gateways, closed for the trace. */
    plugs?: Box[];
    /** Ground taken whole, though it isn't walled in: the castle quarter of East Ardougne. */
    force?: Box[];
    /** Water taken where it runs through the town: the river in East Ardougne. */
    include?: Box[];
}

const ALL_LEVELS = { minLevel: 0, maxLevel: 3 };
const TOWNS: Town[] = [
    {
        name: 'Lumbridge',
        note: 'Lumbridge, where every death respawns: the castle grounds and village up to the road (the river and its bridge are open ground), and the churchyard',
        zones: [{ ...box(3200, 3200, 3236, 3260), ...ALL_LEVELS }, { ...box(3237, 3200, 3249, 3217), ...ALL_LEVELS }]
    },
    {
        name: 'Varrock',
        note: 'Varrock, inside the city walls (the palace grounds included; not the Jolly Boar Inn or the fields outside)',
        box: box(3150, 3355, 3315, 3530),
        seeds: [[3210, 3415]],
        plugs: [box(3204, 3380, 3215, 3381) /* south gate */, box(3171, 3424, 3175, 3436) /* west gate */, box(3239, 3501, 3249, 3501) /* north gate */, box(3272, 3425, 3275, 3432) /* east gate */]
    },
    {
        name: 'Falador',
        note: 'Falador, inside the city walls (the castle and its moat included; not the fields south-east)',
        box: box(2905, 3270, 3100, 3430),
        seeds: [[2980, 3368]],
        plugs: [box(2962, 3394, 2968, 3395) /* north gate */, box(3000, 3322, 3012, 3323) /* south gate */]
    },
    {
        name: 'East Ardougne',
        note: 'East Ardougne: the walled market side, the river through town, and the castle quarter up to the West Ardougne wall',
        box: box(2525, 3225, 2725, 3375),
        seeds: [[2662, 3305]],
        // the town's south edge runs open from the river to the shore, above the farmland
        plugs: [box(2686, 3302, 2689, 3307) /* east gate */, box(2634, 3339, 2639, 3340) /* north gate */, box(2611, 3338, 2616, 3341) /* north-west gap */, box(2582, 3263, 2640, 3264) /* south edge */],
        include: [box(2588, 3265, 2606, 3338)],
        force: [box(2560, 3263, 2594, 3340)]
    },
    {
        name: 'Yanille',
        note: 'Yanille, inside the city walls',
        box: box(2500, 3040, 2655, 3140),
        seeds: [[2575, 3090]],
        plugs: [box(2613, 3101, 2618, 3106) /* north-east gate */]
    },
    {
        name: "Seers' Village bank",
        note: "Seers' Village bank",
        zones: [
            { ...box(2721, 3490, 2730, 3497), minLevel: 0, maxLevel: 1 },
            { ...box(2724, 3487, 2727, 3489), minLevel: 0, maxLevel: 0 }
        ]
    },
    {
        name: 'Catherby bank',
        note: 'Catherby bank',
        zones: [{ ...box(2806, 3438, 2812, 3445), minLevel: 0, maxLevel: 0 }]
    }
];
/** A rectangle must cover at least this many more town tiles to be worth a row. */
const MIN_GAIN = 12;

// ---- the map

function packNames(file: string): string[] {
    const names: string[] = [];
    for (const line of fs.readFileSync(`${CONTENT}/pack/${file}`, 'utf8').split(/\r?\n/)) {
        const m = /^(\d+)=(.+)$/.exec(line);
        if (m) names[+m[1]!] = m[2]!;
    }
    return names;
}
const floNames = packNames('flo.pack'); // map floor ids are 1-based
const locNames = packNames('loc.pack');

/** Each loc's footprint and whether it blocks walking: revision 289's configs, then ours. */
const locSize = new Map<string, { w: number; l: number; walk: boolean }>();
function readLocConfigs(file: string): void {
    let cur: { w: number; l: number; walk: boolean } | null = null;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const name = /^\[(.+)\]$/.exec(line);
        if (name) {
            cur = { w: 1, l: 1, walk: false };
            locSize.set(name[1]!, cur);
        } else if (cur) {
            const kv = /^(width|length|blockwalk)=(.+)$/.exec(line);
            if (kv?.[1] === 'width') cur.w = +kv[2]!;
            else if (kv?.[1] === 'length') cur.l = +kv[2]!;
            else if (kv?.[1] === 'blockwalk') cur.walk = kv[2] === 'no';
        }
    }
}
readLocConfigs(`${CONTENT}/scripts/_unpack/289/all.loc`);
for (const f of fs.readdirSync(`${CONTENT}/scripts`, { recursive: true }) as string[]) {
    if (f.endsWith('.loc') && !f.replace(/\\/g, '/').startsWith('_unpack/')) readLocConfigs(`${CONTENT}/scripts/${f}`);
}

type MapLine = { level: number; x: number; z: number; rest: string };
const squareCache = new Map<string, { map: MapLine[]; locs: MapLine[] }>();
/** The ground-level lines of one map square's .jm2 file. */
function square(mx: number, mz: number): { map: MapLine[]; locs: MapLine[] } {
    const key = `${mx}_${mz}`;
    let sq = squareCache.get(key);
    if (sq) return sq;
    sq = { map: [], locs: [] };
    const file = `${CONTENT}/maps/m${key}.jm2`;
    if (fs.existsSync(file)) {
        let section = '';
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const s = /^==== (\w+) ====$/.exec(line);
            if (s) section = s[1]!;
            const m = /^(\d+) (\d+) (\d+):\s*(.*)$/.exec(line);
            if (!m) continue;
            const entry = { level: +m[1]!, x: (mx << 6) + +m[2]!, z: (mz << 6) + +m[3]!, rest: m[4]! };
            if (section === 'MAP') sq.map.push(entry);
            else if (section === 'LOC') sq.locs.push(entry);
        }
    }
    squareCache.set(key, sq);
    return sq;
}
function squaresIn(b: Box): { map: MapLine[]; locs: MapLine[] }[] {
    const out = [];
    for (let mx = b.x0 >> 6; mx <= b.x1 >> 6; mx++) for (let mz = b.z0 >> 6; mz <= b.z1 >> 6; mz++) out.push(square(mx, mz));
    return out;
}

// ---- tracing a walled town

// west, north, east, south: the step, the edge bit on this tile, the edge bit on the neighbour
const DIRS = [
    [-1, 0, 1, 4],
    [0, 1, 2, 8],
    [1, 0, 4, 1],
    [0, -1, 8, 2]
] as const;

interface Grid {
    b: Box;
    w: number;
    h: number;
    /** 1 where nobody can stand: water, solid objects, diagonal walls, blocked floor, plugs. */
    blocked: Uint8Array;
    /** Wall bits per tile edge (DIRS). */
    walls: Uint8Array;
    /** The town. */
    inside: Uint8Array;
    /** What a rectangle may cover: the town, plus anything nobody stands on. */
    allowed: Uint8Array;
}

function trace(town: Town): Grid {
    const b = town.box!;
    const w = b.x1 - b.x0 + 1, h = b.z1 - b.z0 + 1;
    const at = (x: number, z: number) => (z - b.z0) * w + (x - b.x0);
    const inBox = (x: number, z: number) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
    const blocked = new Uint8Array(w * h);
    const walls = new Uint8Array(w * h);
    const wall = (x: number, z: number, rot: number) => {
        const [dx, dz, bit, opposite] = DIRS[rot & 3]!;
        if (inBox(x, z)) walls[at(x, z)]! |= bit;
        if (inBox(x + dx, z + dz)) walls[at(x + dx, z + dz)]! |= opposite;
    };
    for (const sq of squaresIn(b)) {
        for (const t of sq.map) {
            if (t.level !== 0 || !inBox(t.x, t.z)) continue;
            for (const part of t.rest.split(/\s+/)) {
                if (part.startsWith('f') && parseInt(part.slice(1)) & 1) blocked[at(t.x, t.z)] = 1;
                if (part.startsWith('o') && /water/.test(floNames[parseInt(part.slice(1)) - 1] ?? '')) blocked[at(t.x, t.z)] = 1;
            }
        }
        for (const l of sq.locs) {
            if (l.level !== 0 || !inBox(l.x, l.z)) continue;
            const [id, shape = 10, rot = 0] = l.rest.split(/\s+/).map(Number) as [number, number?, number?];
            if (shape === 0) wall(l.x, l.z, rot); // straight wall, door or gate
            else if (shape === 2) { wall(l.x, l.z, rot); wall(l.x, l.z, rot + 1); } // L-shaped corner
            else if (shape === 9) blocked[at(l.x, l.z)] = 1; // diagonal wall
            else if (shape === 10 || shape === 11) {
                const cfg = locSize.get(locNames[id] ?? '') ?? { w: 1, l: 1, walk: false };
                if (cfg.walk) continue;
                const [sw, sl] = rot & 1 ? [cfg.l, cfg.w] : [cfg.w, cfg.l];
                for (let i = 0; i < sw; i++) for (let j = 0; j < sl; j++) if (inBox(l.x + i, l.z + j)) blocked[at(l.x + i, l.z + j)] = 1;
            }
        }
    }
    for (const p of town.plugs ?? []) for (let x = p.x0; x <= p.x1; x++) for (let z = p.z0; z <= p.z1; z++) if (inBox(x, z)) blocked[at(x, z)] = 1;

    // flood the countryside in from the box's edge
    const outside = new Uint8Array(w * h);
    const from = new Int32Array(w * h).fill(-1);
    const queue: number[] = [];
    const enter = (i: number, prev: number) => {
        if (outside[i] || blocked[i]) return;
        outside[i] = 1;
        from[i] = prev;
        queue.push(i);
    };
    for (let x = b.x0; x <= b.x1; x++) { enter(at(x, b.z0), -1); enter(at(x, b.z1), -1); }
    for (let z = b.z0; z <= b.z1; z++) { enter(at(b.x0, z), -1); enter(at(b.x1, z), -1); }
    for (let q = 0; q < queue.length; q++) {
        const i = queue[q]!, x = b.x0 + (i % w), z = b.z0 + Math.floor(i / w);
        for (const [dx, dz, bit] of DIRS) if (!(walls[i]! & bit) && inBox(x + dx, z + dz)) enter(at(x + dx, z + dz), i);
    }
    for (const [sx, sz] of town.seeds ?? []) {
        if (!outside[at(sx, sz)]) continue;
        const route: string[] = [];
        for (let i = at(sx, sz); i !== -1; i = from[i]!) route.push(`${b.x0 + (i % w)},${b.z0 + Math.floor(i / w)}`);
        throw new Error(`${town.name}: the countryside gets in, an unplugged gateway on this route: ${route.reverse().join(' ')}`);
    }

    // pockets the flood didn't reach: walkable ones and blocked ones apart
    const pocket = new Int32Array(w * h).fill(-1);
    const size: number[] = [], solid: boolean[] = [];
    let pockets = 0;
    for (let s = 0; s < w * h; s++) {
        if (outside[s] || pocket[s] !== -1) continue;
        const c = pockets++;
        size[c] = 0;
        solid[c] = blocked[s] === 1;
        const stack = [s];
        pocket[s] = c;
        while (stack.length) {
            const i = stack.pop()!, x = b.x0 + (i % w), z = b.z0 + Math.floor(i / w);
            size[c]!++;
            for (const [dx, dz, bit] of DIRS) {
                if (walls[i]! & bit || !inBox(x + dx, z + dz)) continue;
                const n = at(x + dx, z + dz);
                if (outside[n] || pocket[n] !== -1 || blocked[n] !== blocked[i]) continue;
                pocket[n] = c;
                stack.push(n);
            }
        }
    }
    const touchesOutside: boolean[] = [];
    const next: Set<number>[] = Array.from({ length: pockets }, () => new Set<number>());
    for (let i = 0; i < w * h; i++) {
        if (pocket[i] === -1) continue;
        const x = b.x0 + (i % w), z = b.z0 + Math.floor(i / w);
        for (const [dx, dz] of DIRS) {
            if (!inBox(x + dx, z + dz)) continue;
            const n = at(x + dx, z + dz);
            if (outside[n]) touchesOutside[pocket[i]!] = true;
            else if (pocket[n] !== pocket[i]) next[pocket[i]!]!.add(pocket[n]!);
        }
    }
    // The town: its seeds' pockets; the pockets beside those (buildings, a wall tower, a gatehouse
    // built into the wall, but never water or rock running on out of town); and anything walled in
    // by those that the countryside doesn't touch (a castle inside its moat, an inner room).
    const seeds = new Set((town.seeds ?? []).map(([x, z]) => pocket[at(x, z)]!));
    const besideSeed = new Set([...seeds].flatMap(c => [...next[c]!]));
    const town_ = new Set(seeds);
    for (let grew = true; grew; ) {
        grew = false;
        for (const c of [...town_]) for (const n of next[c]!) {
            if (town_.has(n)) continue;
            if (touchesOutside[n] && !(besideSeed.has(n) && !solid[n] && size[n]! <= 400)) continue;
            town_.add(n);
            grew = true;
        }
    }
    const inside = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (pocket[i]! >= 0 && town_.has(pocket[i]!)) inside[i] = 1;
    for (const r of town.include ?? []) for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) if (!outside[at(x, z)]) inside[at(x, z)] = 1;
    for (const r of town.force ?? []) for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) inside[at(x, z)] = 1;
    const allowed = inside.map((v, i) => (v || blocked[i] ? 1 : 0));
    return { b, w, h, blocked, walls, inside, allowed };
}

/** Few rectangles over the town, each the one that covers the most of what's still uncovered. */
function cover(g: Grid): { zones: Zone[]; covered: number; total: number; missedWalkable: number } {
    const { w, h, inside, allowed } = g;
    const uncovered = Uint8Array.from(inside);
    const total = inside.reduce((a, v) => a + v, 0);
    const zones: Zone[] = [];
    const heights = new Int32Array(w);
    for (;;) {
        const P = new Int32Array((w + 1) * (h + 1)); // prefix sums of uncovered town tiles
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) P[(j + 1) * (w + 1) + i + 1] = uncovered[j * w + i]! + P[j * (w + 1) + i + 1]! + P[(j + 1) * (w + 1) + i]! - P[j * (w + 1) + i]!;
        const gain = (i0: number, j0: number, i1: number, j1: number) => P[(j1 + 1) * (w + 1) + i1 + 1]! - P[j0 * (w + 1) + i1 + 1]! - P[(j1 + 1) * (w + 1) + i0]! + P[j0 * (w + 1) + i0]!;
        let best = { gain: 0, i0: 0, j0: 0, i1: 0, j1: 0 };
        heights.fill(0);
        // every maximal rectangle of allowed tiles, by the row it starts on (its smallest z)
        for (let j = h - 1; j >= 0; j--) {
            for (let i = 0; i < w; i++) heights[i] = allowed[j * w + i] ? heights[i]! + 1 : 0;
            const stack: number[] = [];
            for (let i = 0; i <= w; i++) {
                const hi = i < w ? heights[i]! : 0;
                while (stack.length && heights[stack[stack.length - 1]!]! >= hi) {
                    const top = stack.pop()!, tall = heights[top]!;
                    const left = stack.length ? stack[stack.length - 1]! + 1 : 0;
                    if (tall > 0) {
                        const g2 = gain(left, j, i - 1, j + tall - 1);
                        if (g2 > best.gain) best = { gain: g2, i0: left, j0: j, i1: i - 1, j1: j + tall - 1 };
                    }
                }
                stack.push(i);
            }
        }
        if (best.gain < MIN_GAIN) break;
        for (let j = best.j0; j <= best.j1; j++) for (let i = best.i0; i <= best.i1; i++) uncovered[j * w + i] = 0;
        zones.push({ x0: g.b.x0 + best.i0, z0: g.b.z0 + best.j0, x1: g.b.x0 + best.i1, z1: g.b.z0 + best.j1, ...ALL_LEVELS });
    }
    let missedWalkable = 0;
    for (let i = 0; i < w * h; i++) if (uncovered[i] && !g.blocked[i]) missedWalkable++;
    return { zones, covered: total - uncovered.reduce((a, v) => a + v, 0), total, missedWalkable };
}

// ---- output

const coord = (level: number, x: number, z: number) => `${level}_${x >> 6}_${z >> 6}_${x & 63}_${z & 63}`;
const pair = (r: Zone) => `${coord(r.minLevel, r.x0, r.z0)},${coord(r.maxLevel, r.x1, r.z1)}`;
/** A note as // comment lines of at most 100 characters. */
function wrap(note: string): string[] {
    const lines = [''];
    for (const word of note.split(' ')) {
        if (lines[lines.length - 1]!.length + word.length + 4 > 100) lines.push('');
        lines[lines.length - 1] += (lines[lines.length - 1] ? ' ' : '') + word;
    }
    return lines.map(l => `// ${l}`);
}

/** A top-down map of the box with the zones on it: floors, walls (doors yellow), a 10-tile grid. */
function drawPng(file: string, b: Box, zones: Zone[]): void {
    const S = 4, M = 22, W = (b.x1 - b.x0 + 1) * S + M, H = (b.z1 - b.z0 + 1) * S + M;
    const px = new Uint8Array(W * H * 3).fill(24);
    const put = (x: number, y: number, rgb: number, a = 1) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const i = (y * W + x) * 3;
        for (let c = 0; c < 3; c++) px[i + c] = Math.round(px[i + c]! * (1 - a) + ((rgb >> (16 - 8 * c)) & 255) * a);
    };
    const fill = (x: number, y: number, w: number, h: number, rgb: number, a = 1) => {
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, rgb, a);
    };
    const sx = (x: number) => M + (x - b.x0) * S, sy = (z: number) => (b.z1 - z) * S;
    const colour = new Map<string, number>();
    for (const f of ['floors/underlay.flo', 'floors/overlay.flo']) {
        let name = '';
        for (const line of fs.readFileSync(`${CONTENT}/scripts/${f}`, 'utf8').split(/\r?\n/)) {
            const n = /^\[(.+)\]$/.exec(line);
            if (n) name = n[1]!;
            const c = /^colour=0x([0-9A-Fa-f]+)/.exec(line);
            if (c) colour.set(name, parseInt(c[1]!, 16));
            if (/^texture=water/.test(line)) colour.set(name, 0x2f5fb0);
            else if (/^texture=/.test(line) && !colour.has(name)) colour.set(name, 0x7a6a5a);
        }
    }
    const flo = (id: number) => colour.get(floNames[id - 1] ?? '');
    for (const sq of squaresIn(b)) {
        for (const t of sq.map) {
            if (t.level !== 0 || t.x < b.x0 || t.x > b.x1 || t.z < b.z0 || t.z > b.z1) continue;
            let rgb = 0x202020;
            for (const part of t.rest.split(/\s+/)) {
                if (part.startsWith('u')) rgb = flo(parseInt(part.slice(1))) ?? rgb;
            }
            for (const part of t.rest.split(/\s+/)) {
                const o = part.startsWith('o') ? flo(parseInt(part.slice(1))) : undefined;
                if (o !== undefined && o !== 0xff00ff) rgb = o;
            }
            fill(sx(t.x), sy(t.z), S, S, rgb);
        }
        for (const l of sq.locs) {
            if (l.level !== 0 || l.x < b.x0 || l.x > b.x1 || l.z < b.z0 || l.z > b.z1) continue;
            const [id, shape = 10, rot = 0] = l.rest.split(/\s+/).map(Number) as [number, number?, number?];
            const col = /door|gate/i.test(locNames[id] ?? '') ? 0xffd040 : 0xf4f4f4;
            const X = sx(l.x), Y = sy(l.z);
            const edge = (r: number) => (r & 3) === 0 ? fill(X, Y, 1, S, col) : (r & 3) === 1 ? fill(X, Y, S, 1, col) : (r & 3) === 2 ? fill(X + S - 1, Y, 1, S, col) : fill(X, Y + S - 1, S, 1, col);
            if (shape === 0) edge(rot);
            else if (shape === 2) { edge(rot); edge(rot + 1); }
            else if (shape === 9) for (let i = 0; i < S; i++) put(X + i, Y + (rot & 1 ? i : S - 1 - i), col);
        }
    }
    const FONT = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
    const text = (x: number, y: number, s: string) => [...s].forEach((d, c) => [...FONT[+d]!].forEach((on, i) => on === '1' && put(x + c * 4 + (i % 3), y + Math.floor(i / 3), 0xffffff)));
    for (let x = Math.ceil(b.x0 / 10) * 10; x <= b.x1; x += 10) {
        for (let y = 0; y < H - M; y++) put(sx(x), y, 0xffffff, 0.18);
        if (x % 20 === 0) text(sx(x) - 7, H - M + 8, String(x));
    }
    for (let z = Math.ceil(b.z0 / 10) * 10; z <= b.z1; z += 10) {
        for (let x = M; x < W; x++) put(x, sy(z) + S - 1, 0xffffff, 0.18);
        if (z % 20 === 0) text(2, sy(z) + S - 3, String(z));
    }
    for (const r of zones) {
        const L = sx(Math.max(r.x0, b.x0)), R = sx(Math.min(r.x1, b.x1)) + S - 1, T = sy(Math.min(r.z1, b.z1)), B = sy(Math.max(r.z0, b.z0)) + S - 1;
        fill(L, T, R - L + 1, B - T + 1, 0xffe000, 0.12);
        fill(L, T, R - L + 1, 1, 0xffe000); fill(L, B, R - L + 1, 1, 0xffe000);
        fill(L, T, 1, B - T + 1, 0xffe000); fill(R, T, 1, B - T + 1, 0xffe000);
    }
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const chunk = (type: string, data: Buffer) => {
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        let c = 0xffffffff;
        for (const byte of body) c = crcTable[(c ^ byte) & 255]! ^ (c >>> 8);
        const out = Buffer.alloc(12 + data.length);
        out.writeUInt32BE(data.length, 0);
        body.copy(out, 4);
        out.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + data.length);
        return out;
    };
    const raw = Buffer.alloc(H * (W * 3 + 1));
    for (let y = 0; y < H; y++) Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(W, 0);
    ihdr.writeUInt32BE(H, 4);
    ihdr.set([8, 2, 0, 0, 0], 8);
    fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

function main(): void {
    const write = process.argv.includes('--write');
    const pngDir = process.argv.find(a => a.startsWith('--png='))?.slice(6);
    const rows: string[] = [];
    const sdk: string[] = [];
    for (const town of TOWNS) {
        let zones = town.zones;
        if (!zones) {
            const grid = trace(town);
            const c = cover(grid);
            zones = c.zones;
            console.log(`${town.name}: ${zones.length} rectangles cover ${c.covered} of ${c.total} tiles inside the walls (${((100 * c.covered) / c.total).toFixed(1)}%), missing ${c.missedWalkable} walkable ones along them`);
        } else {
            console.log(`${town.name}: ${zones.length} hand-drawn rectangle${zones.length > 1 ? 's' : ''}`);
        }
        rows.push(...wrap(town.note), ...zones.map(z => `data=coord_pair,${pair(z)}`));
        const q = town.name.includes("'") ? '"' : "'";
        sdk.push(...zones.map(z => `    zone(${q}${town.name}${q}, 'town', '${coord(z.minLevel, z.x0, z.z0)}', '${coord(z.maxLevel, z.x1, z.z1)}'),`));
        if (pngDir) {
            const b = town.box ?? zones.reduce((a, z) => box(Math.min(a.x0, z.x0 - 12), Math.min(a.z0, z.z0 - 12), Math.max(a.x1, z.x1 + 12), Math.max(a.z1, z.z1 + 12)), box(1e9, 1e9, -1e9, -1e9));
            fs.mkdirSync(pngDir, { recursive: true });
            drawPng(`${pngDir}/${town.name.toLowerCase().replace(/[^a-z]+/g, '-')}.png`, b, zones);
        }
    }
    const dbrow = [
        '// pvp-sdk: Deadman-style safe areas. Nobody attacks into or out of them, and the',
        '// guards shoot skulled players inside (see ~pvp_in_safe_zone, which also counts',
        '// Tutorial Island, the Duel Arena and Castle Wars). Edgeville and other banks',
        '// outside these towns are not safe, as in Deadman.',
        '// Generated by server/engine/tools/pvp/safeZones.ts, which traces the walled towns from the',
        '// map: change the tool and run it with --write, rather than editing these rows.',
        '[pvp_safe_zones]',
        'table=coord_pair_table',
        ...rows,
        ''
    ].join('\n');
    if (!write) {
        console.log(`\n${dbrow}`);
        return;
    }
    fs.writeFileSync(DBROW, dbrow);
    const src = fs.readFileSync(SDK_PVP, 'utf8');
    const eol = src.includes('\r\n') ? '\r\n' : '\n'; // a Windows checkout may have CRLF
    const marker = '    // pvp_safe_zones.dbrow, in its order';
    const start = src.indexOf(marker);
    const end = src.indexOf('    // ~in_tutorial_island');
    if (start < 0 || end < start) throw new Error(`${SDK_PVP}: the SAFE_ZONES town block's markers moved`);
    fs.writeFileSync(SDK_PVP, src.slice(0, start) + [marker, ...sdk].join(eol) + eol + src.slice(end));
    console.log(`\nwrote ${path.relative(process.cwd(), DBROW)} and ${path.relative(process.cwd(), SDK_PVP)}`);
}

main();
