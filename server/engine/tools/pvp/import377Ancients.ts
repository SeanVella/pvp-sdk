// pvp-sdk: imports the Ancient Magicks graphics, icons and sounds from LostCity's Content repository,
// branch 377-wip (https://github.com/LostCityRS/Content, MIT licence, as server/content/LICENSE),
// pinned to one commit, plus the Zaros altar. Usage, from server/engine:
//
//   bun tools/pvp/import377Ancients.ts
//
// 377-wip has every ancient spell's graphics, icons and sounds but no spell or spellbook, so the
// spells themselves are ours (content/scripts/pvp_kit/). What comes over, all at 377's ids, which
// 289 doesn't use, except where noted:
//   - 33 spotanims (377 spotanim.pack 360-392): the ice/blood/shadow/smoke rush, burst, blitz and
//     barrage travel and impact graphics, with ice_blitz_impact2/3 and ice_barrage_impact2/3, and
//     zaros_teleport, the ancient teleports' graphic. Blood burst and barrage are
//     spell_blood_*_impact and have no travel; shadow burst and barrage have no travel either.
//   - their 28 seqs (377 seq.pack 1958-1988), verbatim from 377's all.seq;
//   - the 18 animsets holding those seqs' frames, 514-531 (frames 14677-15082), copied unchanged:
//     spotanims have their own small skeletons, never the player's;
//   - 29 spot models (377 model.pack 6375-6404), except spot_ice_burst_travel, which is 1204 in
//     377 and 1204 is furniture_candlestick here, so it's 6386; spot_ice_barrage_travel, 14215
//     in 377, renumbered to 6404 so the model table stays dense instead of growing to 14215; and
//     so spot_zaros_teleport, 6404 in 377, is 6405;
//   - the Zaros altar from Desert Treasure: model dt_zaros_altar (377's dt_zaros_altar_8, model 6264) and a loc
//     zaros_altar at 377's loc id 6552 (377's dt_zaros_altar: "Altar", 3 wide, "Pray-at"). Its
//     prayer_altar category is left off, so the altar's own script decides what praying does.
//   - the spell icons: 377's magicon2 and magicoff2 sheets, keeping our tiles 0-4 (the same five
//     icons 289 has, which 377 re-encoded a shade apart); 377 adds 5 Magic Dart, 6-9 ice, 10-13 smoke, 14-17 blood, 18-21 shadow (each
//     Rush, Burst, Blitz, Barrage), 22-29 the teleports Paddewwa, Senntisten, Kharyrll, Lassar,
//     Dareeyak, Carrallanger, Annakarl, Ghorrock, 30-32 Teleother Lumbridge/Falador/Camelot, 33 Tele
//     Block, 34 Enchant Lvl-6 and 35 Bones to Peaches.
//   - 20 of the spells' sounds, under content/synth/pvp_kit/ancients/: each element's cast and its
//     four impacts. The 289 client keeps 1000 synths (webclient sound/JagFX.ts), so ids stop at
//     999: 377's ids where they fit (blood_rush_impact 984, blood_blitz_impact 985, blood_cast 986),
//     the rest renumbered into the free ids below 1000 (see SYNTHS). 377's other blood sounds
//     (rush_work, rush_all, rush_fail, blitz_all, travel, travel_2) and smoke_cast2 don't fit and
//     stay behind; ice_magic_all and spellfail are 289's already.
// Configs: content/scripts/pvp_kit/configs/ancients.{seq,spotanim,loc}; pack entries (and
// synth.order) are added here, in id order, refusing any clash.

import fs from 'fs';
import path from 'path';

import { Jimp } from 'jimp';

const COMMIT = '44eab09081ef0f6c5f3eaabd1897a588ad7d9e50'; // 377-wip, 2026-10-18
const RAW = `https://raw.githubusercontent.com/LostCityRS/Content/${COMMIT}`;
const CONTENT = path.resolve(import.meta.dirname, '../../../content');
const OUT = `${CONTENT}/models/pvp_kit/ancients`;
const SYNTH_OUT = `${CONTENT}/synth/pvp_kit/ancients`;
const TILE = 20;

const ANIMSETS = Array.from({ length: 18 }, (_, i) => 514 + i);
const FRAMES = { first: 14677, last: 15082 };
// 377 model ids moved here, and why (see the header).
const MODEL_RENUMBER: Record<string, number> = { spot_ice_burst_travel: 6386, spot_ice_barrage_travel: 6404, spot_zaros_teleport: 6405 };
// 377 names the altar's model with its shape suffix (_8, centrepiece); this packer wants it without,
// so it's dt_zaros_altar here (LocConfig.ts tries the bare name as the centrepiece first).
const ALTAR = { loc: 6552, name: 'zaros_altar', model: 'dt_zaros_altar_8', ourModel: 'dt_zaros_altar', modelId: 6264 };
// The icon tiles 289's sheets already have, kept as they are.
const OUR_ICON_TILES = 5;

// [377 folder under synth/magic, name, id here]: under 1000 for the client (see the header)
const SYNTHS: [string, string, number][] = [
    ['ice', 'ice_rush_impact', 979],
    ['ice', 'ice_burst_impact', 980],
    ['ice', 'ice_blitz_impact', 981],
    ['ice', 'ice_barrage_impact', 982],
    ['ice', 'ice_cast', 983],
    ['blood', 'blood_rush_impact', 984],
    ['blood', 'blood_blitz_impact', 985],
    ['blood', 'blood_cast', 986],
    ['blood', 'blood_burst_impact', 987],
    ['blood', 'blood_barrage_impact', 988],
    ['shadow', 'shadow_rush_impact', 989],
    ['shadow', 'shadow_burst_impact', 990],
    ['shadow', 'shadow_blitz_impact', 991],
    ['shadow', 'shadow_barrage_impact', 992],
    ['shadow', 'shadow_cast', 993],
    ['smoke', 'smoke_rush_impact', 994],
    ['smoke', 'smoke_burst_impact', 995],
    ['smoke', 'smoke_blitz_impact', 996],
    ['smoke', 'smoke_barrage_impact', 997],
    ['smoke', 'smoke_cast', 998]
];

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

// Appends ids an .order file doesn't list yet (the packer only packs what it lists).
function addToOrder(order: string, ids: number[]): void {
    const file = `${CONTENT}/pack/${order}.order`;
    const lines = fs.readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
    const have = new Set(lines.map(Number));
    const added = ids.filter(id => !have.has(id));
    fs.writeFileSync(file, [...lines, ...added.map(String)].join('\n') + '\n');
    console.log(`${order}.order: ${added.length} added`);
}

function header(what: string, ids: string): string {
    return `// pvp-sdk: ${what}, from LostCity's Content repository, branch 377-wip (scripts/_unpack/377),\n` +
        `// MIT licence as server/content/LICENSE, at 377's ids (${ids}), by\n// engine/tools/pvp/import377Ancients.ts. The spells themselves are content/scripts/pvp_kit/.\n\n`;
}

// --------------------------------------------------------------- icons

// 377's sheet, but with our own tiles 0-4: they're the same icons, re-encoded (a blue channel 1
// apart, 377's greyed set a shade lighter), and 289's spells keep exactly what they had.
async function mergeSheet(sheet: string): Promise<void> {
    const file = `${CONTENT}/sprites/${sheet}.png`;
    const ours = await Jimp.read(file);
    const sheet377 = await Jimp.read(Buffer.from(await fetchBytes(`sprites/${sheet}.png`)));
    const { width, height } = ours.bitmap;
    if (sheet377.bitmap.width !== width || sheet377.bitmap.height !== height) {
        throw new Error(`${sheet}: ours is ${width}x${height}, 377's ${sheet377.bitmap.width}x${sheet377.bitmap.height}`);
    }
    if (new TextDecoder().decode(await fetchBytes(`sprites/meta/${sheet}.opt`)).trim() !== fs.readFileSync(`${CONTENT}/sprites/meta/${sheet}.opt`, 'utf8').trim()) {
        throw new Error(`${sheet}: 377's tile size differs`);
    }
    const cols = width / TILE;
    for (let tile = 0; tile < OUR_ICON_TILES; tile++) {
        const ox = (tile % cols) * TILE;
        const oy = Math.floor(tile / cols) * TILE;
        for (let y = 0; y < TILE; y++) {
            const p = ((oy + y) * width + ox) * 4;
            sheet377.bitmap.data.set(ours.bitmap.data.subarray(p, p + TILE * 4), p);
        }
    }
    await sheet377.write(file as `${string}.png`);
}

// --------------------------------------------------------------- main

async function main(): Promise<void> {
    fs.mkdirSync(OUT, { recursive: true });
    fs.mkdirSync(SYNTH_OUT, { recursive: true });

    // configs
    const allSpot = blocks(await fetchText('scripts/_unpack/377/all.spotanim'));
    const allSeq = blocks(await fetchText('scripts/_unpack/377/all.seq'));
    const allLoc = blocks(await fetchText('scripts/_unpack/377/all.loc'));
    const spotIds = packIds(await fetchText('pack/spotanim.pack'));
    const seqIds = packIds(await fetchText('pack/seq.pack'));
    const modelIds = packIds(await fetchText('pack/model.pack'));
    const locIds = packIds(await fetchText('pack/loc.pack'));

    const spotNames = [...allSpot.keys()].filter(n =>
        /^(smoke|shadow|blood|ice)_(rush|burst|blitz|barrage)_(travel|impact\d?)$/.test(n) || /^spell_blood_(burst|barrage)_impact$/.test(n) || n === 'zaros_teleport');
    if (spotNames.length !== 33) throw new Error(`expected 33 ancient spotanims, found ${spotNames.length}: ${spotNames.join(',')}`);
    const prop = (block: string, key: string) => block.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim();
    const seqNames = [...new Set(spotNames.map(n => prop(allSpot.get(n)!, 'anim')!))];
    const modelNames = [...new Set(spotNames.map(n => prop(allSpot.get(n)!, 'model')!))];

    // animsets: every frame the seqs use must be in 514-531, and nowhere in ours
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
    if (missing.length) throw new Error(`frames not in animsets 514-531: ${missing.join(',')}`);
    if ([...frames.keys()].some(f => f < FRAMES.first || f > FRAMES.last)) throw new Error('animsets 514-531 hold frames outside 14677-15082');
    console.log(`animsets 514-531: ${frames.size} frames, ${wanted.size} used by ${seqNames.length} seqs`);

    // models
    for (const name of modelNames) {
        fs.writeFileSync(`${OUT}/${name}.ob2`, await fetchBytes(`models/spot/${name}.ob2`));
    }
    fs.writeFileSync(`${OUT}/${ALTAR.ourModel}.ob2`, await fetchBytes(`models/loc/${ALTAR.model}.ob2`));
    if (modelIds.get(ALTAR.model) !== ALTAR.modelId || locIds.get('dt_zaros_altar') !== ALTAR.loc) {
        throw new Error('377 altar ids changed');
    }
    console.log(`models: ${modelNames.length} spot models and ${ALTAR.ourModel}`);

    // sounds
    for (const [folder, name] of SYNTHS) {
        fs.writeFileSync(`${SYNTH_OUT}/${name}.synth`, await fetchBytes(`synth/magic/${folder}/${name}.synth`));
    }
    if (SYNTHS.some(([, , id]) => id >= 1000)) throw new Error('the 289 client keeps synth ids 0-999');
    console.log(`synths: ${SYNTHS.length}`);

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
    addToPack('synth', new Map(SYNTHS.map(([, name, id]) => [id, name])));
    addToOrder('synth', SYNTHS.map(([, , id]) => id));

    const byId = (names: string[], ids: Map<string, number>) => [...names].sort((a, b) => ids.get(a)! - ids.get(b)!);
    fs.writeFileSync(`${CONTENT}/scripts/pvp_kit/configs/ancients.seq`,
        header('the Ancient Magicks graphics\' seqs', 'seq.pack 1958-1988') + byId(seqNames, seqIds).map(n => allSeq.get(n)!).join('\n\n') + '\n');
    fs.writeFileSync(`${CONTENT}/scripts/pvp_kit/configs/ancients.spotanim`,
        header('the Ancient Magicks graphics', 'spotanim.pack 360-392') + byId(spotNames, spotIds).map(n => allSpot.get(n)!).join('\n\n') + '\n');
    const altar = allLoc.get('dt_zaros_altar')!;
    fs.writeFileSync(`${CONTENT}/scripts/pvp_kit/configs/ancients.loc`,
        header('the Zaros altar from Desert Treasure, which switches spellbooks here', 'loc.pack 6552, model 6264') +
        `[${ALTAR.name}]\nname=${prop(altar, 'name')}\ndesc=${prop(altar, 'desc')}\nmodel=${prop(altar, 'model')}\nwidth=${prop(altar, 'width')}\nop1=${prop(altar, 'op1')}\n`);
    console.log('configs: ancients.seq, ancients.spotanim, ancients.loc');

    await mergeSheet('magicon2');
    await mergeSheet('magicoff2');
    console.log(`icons: 377's magicon2/magicoff2, with our tiles 0-${OUR_ICON_TILES - 1}`);
}

if (import.meta.main) {
    await main();
}
