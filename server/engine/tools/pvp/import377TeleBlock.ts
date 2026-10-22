// pvp-sdk: imports Tele Block's impact graphic from LostCity's Content repository, branch 377-wip
// (https://github.com/LostCityRS/Content, MIT licence, as server/content/LICENSE), pinned to one
// commit. Usage, from server/engine:
//
//   bun tools/pvp/import377TeleBlock.ts
//
// 377-wip has the graphic and the icon but no Tele Block spell, so the spell itself is ours
// (content/scripts/pvp_kit/). What comes over:
//   - 377's animset 461 (frames 13405-13420, its own small skeleton), unchanged: 289 uses
//     neither the set id nor those frame ids;
//   - the impact model, spot_tele_block_impact (377's model 5799).
// The pack and config entries (animset 461, anim 13405-13420, model 5799, seq 1822, spotanim 345,
// all 377's ids and free in 289) are in content/pack/*.pack and scripts/pvp_kit/configs/.
//
// The icon is 377's own, tile 33 of magicon2/magicoff2: import377Ancients.ts brings 377's whole
// sheets over.

import fs from 'fs';
import path from 'path';

const COMMIT = '44eab09081ef0f6c5f3eaabd1897a588ad7d9e50'; // 377-wip, 2026-10-18
const RAW = `https://raw.githubusercontent.com/LostCityRS/Content/${COMMIT}`;
const CONTENT = path.resolve(import.meta.dirname, '../../../content');

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
}

if (import.meta.main) {
    await main();
}
