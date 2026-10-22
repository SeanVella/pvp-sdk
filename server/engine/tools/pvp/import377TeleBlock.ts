// pvp-sdk: imports Tele Block's impact graphic from LostCity's Content repository, branch 377-wip
// (https://github.com/LostCityRS/Content, MIT licence, as server/content/LICENSE), pinned to one
// commit, and draws the spell's icons. Usage, from server/engine:
//
//   bun tools/pvp/import377TeleBlock.ts
//
// 377-wip has the graphic but no Tele Block spell, interface button or icon, so the spell itself
// is ours (content/scripts/pvp_kit/). What comes over:
//   - 377's animset 461 (frames 13405-13420, its own small skeleton), unchanged: 289 uses
//     neither the set id nor those frame ids;
//   - the impact model, spot_tele_block_impact (377's model 5799).
// The pack and config entries (animset 461, anim 13405-13420, model 5799, seq 1822, spotanim 345,
// all 377's ids and free in 289) are in content/pack/*.pack and scripts/pvp_kit/configs/.
//
// The icons are drawn here, not copied: neither revision has one. They go in tile 5 of
// magicon2/magicoff2, the sheets the later spells (Bind, Snare, Entangle, Charge, Trollheim) use.

import fs from 'fs';
import path from 'path';

import { Jimp } from 'jimp';

const COMMIT = '44eab09081ef0f6c5f3eaabd1897a588ad7d9e50'; // 377-wip, 2026-10-18
const RAW = `https://raw.githubusercontent.com/LostCityRS/Content/${COMMIT}`;
const CONTENT = path.resolve(import.meta.dirname, '../../../content');
const ICON_TILE = 5;
const TILE = 20;

type RGB = [number, number, number];
type Palette = { outline: RGB; top: RGB; bottom: RGB; mark: RGB; slash: RGB };

const ENABLED: Palette = { outline: [26, 0, 38], top: [157, 78, 221], bottom: [90, 24, 154], mark: [243, 232, 255], slash: [208, 0, 0] };
const DISABLED: Palette = { outline: [32, 32, 32], top: [112, 112, 112], bottom: [72, 72, 72], mark: [176, 176, 176], slash: [110, 50, 50] };

async function fetchTo(src: string, dest: string): Promise<Uint8Array> {
    const res = await fetch(`${RAW}/${src}`);
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    fs.writeFileSync(dest, bytes);
    return bytes;
}

function frameIds(b: Uint8Array): number[] {
    const g2 = (p: number) => (b[p]! << 8) | b[p + 1]!;
    const ids: number[] = [];
    for (let i = 0, head = 2; i < g2(0); i++, head += 3) ids.push(g2(head));
    return ids;
}

// A purple orb with a crossed-out "T": no teleporting. Magenta is the sheets' transparent colour.
function iconPixel(x: number, y: number, p: Palette): RGB | null {
    const r = Math.hypot(x - 9.5, y - 9.5);
    if (r > 9.3) return null;
    const slash = Math.abs(x - y) <= 1 && x >= 3 && x <= 16;
    if (slash) return p.slash;
    const t = (y >= 5 && y <= 6 && x >= 6 && x <= 13) || (x >= 9 && x <= 10 && y >= 5 && y <= 14);
    if (t) return p.mark;
    if (r > 8.1) return p.outline;
    const band = Math.min(3, Math.floor(y / 5)); // 4 shades, to stay light on the sheet's palette
    const mix = (i: number) => Math.round(p.top[i]! + ((p.bottom[i]! - p.top[i]!) * band) / 3);
    return [mix(0), mix(1), mix(2)];
}

async function drawIcon(sheet: string, palette: Palette): Promise<void> {
    const file = `${CONTENT}/sprites/${sheet}.png`;
    const img = await Jimp.read(file);
    const cols = img.bitmap.width / TILE;
    const ox = (ICON_TILE % cols) * TILE;
    const oy = Math.floor(ICON_TILE / cols) * TILE;
    for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
            const c = iconPixel(x, y, palette) ?? [255, 0, 255];
            const p = ((oy + y) * img.bitmap.width + (ox + x)) * 4;
            img.bitmap.data[p] = c[0];
            img.bitmap.data[p + 1] = c[1];
            img.bitmap.data[p + 2] = c[2];
            img.bitmap.data[p + 3] = 255;
        }
    }
    await img.write(file as `${string}.png`);
}

async function main(): Promise<void> {
    const out = `${CONTENT}/models/pvp_kit`;
    fs.mkdirSync(out, { recursive: true });

    const set = await fetchTo('models/anim_461.anim', `${out}/pvpkit_tele_block_spotanim.anim`);
    const ids = frameIds(set);
    if (ids[0] !== 13405 || ids[ids.length - 1] !== 13420 || ids.length !== 16) {
        throw new Error(`animset 461 should hold frames 13405-13420, has ${ids.join(',')}`);
    }
    console.log(`pvpkit_tele_block_spotanim: frames ${ids[0]}-${ids[ids.length - 1]}`);

    await fetchTo('models/spot/spot_tele_block_impact.ob2', `${out}/spot_tele_block_impact.ob2`);
    console.log('spot_tele_block_impact.ob2');

    await drawIcon('magicon2', ENABLED);
    await drawIcon('magicoff2', DISABLED);
    console.log(`icons: magicon2/magicoff2 tile ${ICON_TILE}`);
}

if (import.meta.main) {
    await main();
}
