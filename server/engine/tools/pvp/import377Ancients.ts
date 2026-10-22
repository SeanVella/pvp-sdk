// pvp-sdk: imports the Ancient Magicks graphics from LostCity's Content repository, branch 377-wip
// (https://github.com/LostCityRS/Content, MIT licence, as server/content/LICENSE), pinned to one
// commit, plus the Zaros altar, and draws the 16 spell icons. Usage, from server/engine:
//
//   bun tools/pvp/import377Ancients.ts
//
// 377-wip has every ancient spell's travel/impact graphic but no spell, spellbook or icon, so the
// spells themselves are ours (content/scripts/pvp_kit/). What comes over, all at 377's ids, which
// 289 doesn't use, except where noted:
//   - 32 spotanims (377 spotanim.pack 360-391): the ice/blood/shadow/smoke rush, burst, blitz and
//     barrage travel and impact graphics, with ice_blitz_impact2/3 and ice_barrage_impact2/3.
//     Blood burst and barrage are spell_blood_*_impact and have no travel; shadow burst and
//     barrage have no travel either.
//   - their 27 seqs (377 seq.pack 1958-1987), verbatim from 377's all.seq;
//   - the 17 animsets holding those seqs' frames, 514-530 (frames 14677-14995), copied unchanged:
//     spotanims have their own small skeletons, never the player's;
//   - 28 spot models (377 model.pack 6375-6403), except spot_ice_burst_travel, which is 1204 in
//     377 and 1204 is furniture_candlestick here, so it's 6386; and spot_ice_barrage_travel, 14215
//     in 377, renumbered to 6404 so the model table stays dense instead of growing to 14215;
//   - the Zaros altar from Desert Treasure: model dt_zaros_altar (377's dt_zaros_altar_8, model 6264) and a loc
//     zaros_altar at 377's loc id 6552 (377's dt_zaros_altar: "Altar", 3 wide, "Pray-at"). Its
//     prayer_altar category is left off, so the altar's own script decides what praying does.
// Configs: content/scripts/pvp_kit/configs/ancients.{seq,spotanim,loc}; pack entries are added
// here, in id order, refusing any clash.
//
// The icons are drawn, not copied: neither revision has them. They go in tiles 6-21 of
// magicon2 (enabled) and magicoff2 (greyed), after Tele Block's tile 5:
//   6 smoke rush    7 shadow rush    8 blood rush    9 ice rush
//  10 smoke burst  11 shadow burst  12 blood burst  13 ice burst
//  14 smoke blitz  15 shadow blitz  16 blood blitz  17 ice blitz
//  18 smoke barrage 19 shadow barrage 20 blood barrage 21 ice barrage

import fs from 'fs';
import path from 'path';

import { Jimp } from 'jimp';

const COMMIT = '44eab09081ef0f6c5f3eaabd1897a588ad7d9e50'; // 377-wip, 2026-10-18
const RAW = `https://raw.githubusercontent.com/LostCityRS/Content/${COMMIT}`;
const CONTENT = path.resolve(import.meta.dirname, '../../../content');
const OUT = `${CONTENT}/models/pvp_kit/ancients`;
const TILE = 20;

const ANIMSETS = Array.from({ length: 17 }, (_, i) => 514 + i);
const FRAMES = { first: 14677, last: 14995 };
// 377 model ids moved here, and why (see the header).
const MODEL_RENUMBER: Record<string, number> = { spot_ice_burst_travel: 6386, spot_ice_barrage_travel: 6404 };
// 377 names the altar's model with its shape suffix (_8, centrepiece); this packer wants it without,
// so it's dt_zaros_altar here (LocConfig.ts tries the bare name as the centrepiece first).
const ALTAR = { loc: 6552, name: 'zaros_altar', model: 'dt_zaros_altar_8', ourModel: 'dt_zaros_altar', modelId: 6264 };

const SPELLS = ['rush', 'burst', 'blitz', 'barrage'] as const;
const ELEMENTS = ['smoke', 'shadow', 'blood', 'ice'] as const;
type Tier = (typeof SPELLS)[number];
type Element = (typeof ELEMENTS)[number];
const FIRST_ICON_TILE = 6;

async function fetchBytes(src: string): Promise<Uint8Array> {
    const res = await fetch(`${RAW}/${src}`);
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
}

async function fetchText(src: string): Promise<string> {
    return new TextDecoder().decode(await fetchBytes(src)).replace(/\r\n/g, '\n');
}

function frameIds(b: Uint8Array): number[] {
    const g2 = (p: number) => (b[p]! << 8) | b[p + 1]!;
    const ids: number[] = [];
    for (let i = 0, head = 2; i < g2(0); i++, head += 3) ids.push(g2(head));
    return ids;
}

function blocks(text: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const block of text.split(/\n(?=\[)/)) {
        const m = block.match(/^\[([a-z0-9_]+)\]/);
        if (m) out.set(m[1]!, block.trim());
    }
    return out;
}

function readPack(file: string): Map<number, string> {
    const out = new Map<number, string>();
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) out.set(Number(line.slice(0, eq)), line.slice(eq + 1).trim());
    }
    return out;
}

function packIds(text: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const line of text.split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) out.set(line.slice(eq + 1).trim(), Number(line.slice(0, eq)));
    }
    return out;
}

// Adds id=name lines to a pack file in id order; an id or name already used for something else is an error.
function addToPack(pack: string, entries: Map<number, string>): void {
    const file = `${CONTENT}/pack/${pack}.pack`;
    const have = readPack(file);
    const names = new Map([...have].map(([id, name]) => [name, id]));
    for (const [id, name] of entries) {
        if (have.has(id) && have.get(id) !== name) throw new Error(`${pack}.pack: ${id} is already ${have.get(id)}`);
        if (names.has(name) && names.get(name) !== id) throw new Error(`${pack}.pack: ${name} is already ${names.get(name)}`);
        have.set(id, name);
    }
    fs.writeFileSync(file, [...have.keys()].sort((a, b) => a - b).map(id => `${id}=${have.get(id)}\n`).join(''));
    console.log(`${pack}.pack: ${entries.size} entries`);
}

function header(what: string, ids: string): string {
    return `// pvp-sdk: ${what}, from LostCity's Content repository, branch 377-wip (scripts/_unpack/377),\n` +
        `// MIT licence as server/content/LICENSE, at 377's ids (${ids}), by\n// engine/tools/pvp/import377Ancients.ts. The spells themselves are content/scripts/pvp_kit/.\n\n`;
}

// --------------------------------------------------------------- icons

type RGB = [number, number, number];
type Palette = { dark: RGB; base: RGB; light: RGB };
const PALETTES: Record<Element, Palette> = {
    smoke: { dark: [52, 60, 48], base: [118, 132, 104], light: [196, 210, 176] },
    shadow: { dark: [22, 12, 32], base: [74, 40, 98], light: [160, 118, 196] },
    blood: { dark: [74, 4, 10], base: [168, 18, 26], light: [236, 96, 92] },
    ice: { dark: [56, 104, 156], base: [146, 198, 234], light: [236, 248, 255] }
};

function grey(c: RGB): RGB {
    const l = Math.round((0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) * 0.7);
    return [l, l, l];
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const BOLT: [number, number][] = [[14, 2], [8, 9], [12, 10], [6, 18]];

function onRay(x: number, y: number, rays: number, r0: number, r1: number, offset = 0): boolean {
    const dx = x - 9.5;
    const dy = y - 9.5;
    const r = Math.hypot(dx, dy);
    if (r < r0 || r > r1) return false;
    const step = (Math.PI * 2) / rays;
    const a = Math.atan2(dy, dx) - offset;
    const nearest = Math.round(a / step) * step;
    return Math.abs(a - nearest) * r <= 0.75;
}

function iconPixel(x: number, y: number, tier: Tier, p: Palette): RGB | null {
    const r = Math.hypot(x - 9.5, y - 9.5);
    const orb = { rush: 4.6, burst: 4.6, blitz: 5.6, barrage: 6.2 }[tier];
    if (tier === 'blitz' && BOLT.slice(1).some(([bx, by], i) => segDist(x, y, BOLT[i]![0], BOLT[i]![1], bx, by) <= 0.85)) {
        return p.light;
    }
    if (r <= orb) {
        if (r > orb - 1.1) return p.dark;
        if (Math.hypot(x - 8, y - 8) <= 1.3) return p.light; // highlight
        return p.base;
    }
    if (tier === 'burst' && onRay(x, y, 8, orb + 1, 9.3)) return p.light;
    if (tier === 'barrage') {
        if (onRay(x, y, 8, orb + 0.5, 9.6)) return p.light;
        if (onRay(x, y, 8, orb + 0.5, 8.0, Math.PI / 8)) return p.base;
    }
    return null;
}

async function drawIcons(sheet: string, colour: (c: RGB) => RGB): Promise<void> {
    const file = `${CONTENT}/sprites/${sheet}.png`;
    const img = await Jimp.read(file);
    const cols = img.bitmap.width / TILE;
    SPELLS.forEach((tier, t) => ELEMENTS.forEach((element, e) => {
        const tile = FIRST_ICON_TILE + t * 4 + e;
        const ox = (tile % cols) * TILE;
        const oy = Math.floor(tile / cols) * TILE;
        const palette = PALETTES[element];
        for (let y = 0; y < TILE; y++) {
            for (let x = 0; x < TILE; x++) {
                const c = iconPixel(x, y, tier, palette);
                const rgb = c ? colour(c) : ([255, 0, 255] as RGB);
                const p = ((oy + y) * img.bitmap.width + (ox + x)) * 4;
                img.bitmap.data[p] = rgb[0];
                img.bitmap.data[p + 1] = rgb[1];
                img.bitmap.data[p + 2] = rgb[2];
                img.bitmap.data[p + 3] = 255;
            }
        }
    }));
    await img.write(file as `${string}.png`);
}

// --------------------------------------------------------------- main

async function main(): Promise<void> {
    fs.mkdirSync(OUT, { recursive: true });

    // configs
    const allSpot = blocks(await fetchText('scripts/_unpack/377/all.spotanim'));
    const allSeq = blocks(await fetchText('scripts/_unpack/377/all.seq'));
    const allLoc = blocks(await fetchText('scripts/_unpack/377/all.loc'));
    const spotIds = packIds(await fetchText('pack/spotanim.pack'));
    const seqIds = packIds(await fetchText('pack/seq.pack'));
    const modelIds = packIds(await fetchText('pack/model.pack'));
    const locIds = packIds(await fetchText('pack/loc.pack'));

    const spotNames = [...allSpot.keys()].filter(n =>
        /^(smoke|shadow|blood|ice)_(rush|burst|blitz|barrage)_(travel|impact\d?)$/.test(n) || /^spell_blood_(burst|barrage)_impact$/.test(n));
    if (spotNames.length !== 32) throw new Error(`expected 32 ancient spotanims, found ${spotNames.length}: ${spotNames.join(',')}`);
    const prop = (block: string, key: string) => block.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim();
    const seqNames = [...new Set(spotNames.map(n => prop(allSpot.get(n)!, 'anim')!))];
    const modelNames = [...new Set(spotNames.map(n => prop(allSpot.get(n)!, 'model')!))];

    // animsets: every frame the seqs use must be in 514-530, and nowhere in ours
    const wanted = new Set<number>();
    for (const s of seqNames) {
        for (const m of allSeq.get(s)!.matchAll(/^i?frame\d+=anim_(\d+)$/gm)) wanted.add(Number(m[1]));
    }
    const frames = new Map<number, number>(); // frame -> set
    for (const set of ANIMSETS) {
        const bytes = await fetchBytes(`models/anim_${set}.anim`);
        fs.writeFileSync(`${OUT}/pvpkit_ancients_${set}.anim`, bytes);
        for (const f of frameIds(bytes)) {
            if (frames.has(f)) throw new Error(`frame ${f} is in sets ${frames.get(f)} and ${set}`);
            frames.set(f, set);
        }
    }
    const missing = [...wanted].filter(f => !frames.has(f));
    if (missing.length) throw new Error(`frames not in animsets 514-530: ${missing.join(',')}`);
    if ([...frames.keys()].some(f => f < FRAMES.first || f > FRAMES.last)) throw new Error('animsets 514-530 hold frames outside 14677-14995');
    console.log(`animsets 514-530: ${frames.size} frames, ${wanted.size} used by ${seqNames.length} seqs`);

    // models
    for (const name of modelNames) {
        fs.writeFileSync(`${OUT}/${name}.ob2`, await fetchBytes(`models/spot/${name}.ob2`));
    }
    fs.writeFileSync(`${OUT}/${ALTAR.ourModel}.ob2`, await fetchBytes(`models/loc/${ALTAR.model}.ob2`));
    if (modelIds.get(ALTAR.model) !== ALTAR.modelId || locIds.get('dt_zaros_altar') !== ALTAR.loc) {
        throw new Error('377 altar ids changed');
    }
    console.log(`models: ${modelNames.length} spot models and ${ALTAR.ourModel}`);

    // pack entries
    addToPack('animset', new Map(ANIMSETS.map(s => [s, `pvpkit_ancients_${s}`])));
    addToPack('anim', new Map([...frames.keys()].map(f => [f, `anim_${f}`])));
    addToPack('model', new Map([
        ...modelNames.map(n => [MODEL_RENUMBER[n] ?? modelIds.get(n)!, n] as [number, string]),
        [ALTAR.modelId, ALTAR.ourModel]
    ]));
    addToPack('seq', new Map(seqNames.map(n => [seqIds.get(n)!, n])));
    addToPack('spotanim', new Map(spotNames.map(n => [spotIds.get(n)!, n])));
    addToPack('loc', new Map([[ALTAR.loc, ALTAR.name]]));

    const byId = (names: string[], ids: Map<string, number>) => [...names].sort((a, b) => ids.get(a)! - ids.get(b)!);
    fs.writeFileSync(`${CONTENT}/scripts/pvp_kit/configs/ancients.seq`,
        header('the Ancient Magicks graphics\' seqs', 'seq.pack 1958-1987') + byId(seqNames, seqIds).map(n => allSeq.get(n)!).join('\n\n') + '\n');
    fs.writeFileSync(`${CONTENT}/scripts/pvp_kit/configs/ancients.spotanim`,
        header('the Ancient Magicks graphics', 'spotanim.pack 360-391') + byId(spotNames, spotIds).map(n => allSpot.get(n)!).join('\n\n') + '\n');
    const altar = allLoc.get('dt_zaros_altar')!;
    fs.writeFileSync(`${CONTENT}/scripts/pvp_kit/configs/ancients.loc`,
        header('the Zaros altar from Desert Treasure, which switches spellbooks here', 'loc.pack 6552, model 6264') +
        `[${ALTAR.name}]\nname=${prop(altar, 'name')}\ndesc=${prop(altar, 'desc')}\nmodel=${prop(altar, 'model')}\nwidth=${prop(altar, 'width')}\nop1=${prop(altar, 'op1')}\n`);
    console.log('configs: ancients.seq, ancients.spotanim, ancients.loc');

    await drawIcons('magicon2', c => c);
    await drawIcons('magicoff2', grey);
    console.log(`icons: magicon2/magicoff2 tiles ${FIRST_ICON_TILE}-${FIRST_ICON_TILE + 15}`);
}

if (import.meta.main) {
    await main();
}
