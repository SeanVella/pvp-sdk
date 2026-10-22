// pvp-sdk: imports the abyssal whip and granite maul assets from LostCity's Content repository,
// branch 377-wip (https://github.com/LostCityRS/Content, MIT licence, as server/content/LICENSE),
// into this revision-289 tree. Usage, from server/engine:
//
//   bun tools/pvp/import377Weapons.ts <path to a 377-wip checkout>
//
// The checkout only needs models/anim_{28,409,410}.anim, models/obj/obj_{abyssal_whip,granite_maul}*.ob2,
// models/spot/spot_sp_attack_{maul_spotanim,abyssal_whip}.ob2, synth/skills/slayer/*.synth and
// sprites/combaticons3.png (a sparse checkout is enough).
//
// Why this is not a plain copy: Jagex re-rigged the player between 289 and 377. 377's player
// skeleton has 117 transform groups where 289's has 89, and the vertex labels were renumbered
// (377's right hand is label 27, 289's is 8). Groups 0-88 are still the same bones in the same
// order, so:
//   - the 96 player frames (whip and maul attack, defend, walk, run, ready, maul special) are
//     re-encoded against 289's own player base, keeping groups 0-88 and dropping 89-116. The maul
//     frames only use groups below 89; the whip frames also curl the lash through 377's new
//     finger/lash chain (groups 90-102), which 289 doesn't have, so the lash swings rigidly here.
//   - the worn models are relabelled to 289's held-weapon rig: every vertex on label 50 (as 289's
//     dragon weapons are) and every face label 255 (no transparency group), so 289's own idle,
//     walk and emote animations carry them in the right hand.
//   - the spotanim animsets have their own small skeletons and come over as they are, except
//     that 377 reused frame ids 7071/7073/7076/7078/7080/7082 (still player frames in 289's
//     anim_84), so those six frames are renumbered above 377's highest frame id.
// Everything is written under content/{models,synth}/pvp_kit/; the pack and config entries that
// name these files are maintained by hand (see server/PATCHES.md, "PvP kit").

import fs from 'fs';
import path from 'path';

import { Jimp } from 'jimp';

type Frame = { id: number; groupCount: number; flags: number[]; vals: number[]; delay: number };
type AnimSet = { frames: Frame[]; base: Uint8Array };

const CONTENT = path.resolve(import.meta.dirname, '../../../content');

// animset ids (server/content/pack/animset.pack): 409/410 are 377's ids for the two spotanim
// sets; the player frames have no set of their own in 377 (they live in its anim_28), so they
// get 1044, the first id above 377's animsets.
export const PLAYER_SET = { id: 1044, name: 'pvpkit_whip_maul_player' };
export const MAUL_SPOT_SET = { id: 409, name: 'pvpkit_maul_spotanim' };
export const WHIP_SPOT_SET = { id: 410, name: 'pvpkit_whip_spotanim' };

// 377 frame ids that 289 already uses for other frames, and where they go instead (above 377's
// highest frame id, 33567).
export const FRAME_RENUMBER: Record<number, number> = { 7071: 33568, 7073: 33569, 7076: 33570, 7078: 33571, 7080: 33572, 7082: 33573 };

const PLAYER_FRAMES = { first: 12501, last: 12596 };
const HELD_WEAPON_LABEL = 50;
const NO_FACE_LABEL = 255;

function decodeAnimSet(b: Uint8Array): AnimSet {
    const g2at = (p: number) => (b[p] << 8) | b[p + 1];
    const m = b.length - 8;
    const headLen = g2at(m);
    const t1Len = g2at(m + 2);
    const t2Len = g2at(m + 4);
    const delLen = g2at(m + 6);
    let head = 0;
    let t1 = headLen + 2;
    let t2 = t1 + t1Len;
    let del = t2 + t2Len;
    const baseStart = del + delLen;
    const gsmart = () => {
        if (b[t2] < 128) {
            return b[t2++] - 64;
        }
        const v = g2at(t2) - 49152;
        t2 += 2;
        return v;
    };
    const total = g2at(head);
    head += 2;
    const frames: Frame[] = [];
    for (let i = 0; i < total; i++) {
        const id = g2at(head);
        head += 2;
        const groupCount = b[head++];
        const flags: number[] = [];
        const vals: number[] = [];
        for (let g = 0; g < groupCount; g++) {
            const f = b[t1++];
            flags.push(f);
            for (const bit of [1, 2, 4]) {
                if (f & bit) {
                    vals.push(gsmart());
                }
            }
        }
        frames.push({ id, groupCount, flags, vals, delay: b[del++] });
    }
    if (t2 !== headLen + 2 + t1Len + t2Len || del !== baseStart) {
        throw new Error('animset sections do not add up');
    }
    return { frames, base: b.slice(baseStart, m) };
}

function encodeAnimSet(set: AnimSet): Uint8Array {
    const head: number[] = [];
    const t1: number[] = [];
    const t2: number[] = [];
    const del: number[] = [];
    const p2 = (out: number[], v: number) => out.push((v >> 8) & 0xff, v & 0xff);
    const psmart = (v: number) => {
        if (v >= -64 && v < 64) {
            t2.push(v + 64);
        } else if (v >= -16384 && v < 16384) {
            p2(t2, v + 49152);
        } else {
            throw new Error(`transform value out of range: ${v}`);
        }
    };
    p2(head, set.frames.length);
    for (const f of set.frames) {
        p2(head, f.id);
        head.push(f.groupCount);
        let vi = 0;
        for (let g = 0; g < f.groupCount; g++) {
            const fl = f.flags[g];
            t1.push(fl);
            for (const bit of [1, 2, 4]) {
                if (fl & bit) {
                    psmart(f.vals[vi++]);
                }
            }
        }
        if (vi !== f.vals.length) {
            throw new Error(`frame ${f.id}: ${f.vals.length - vi} unused transform values`);
        }
        del.push(f.delay);
    }
    const trailer: number[] = [];
    p2(trailer, head.length - 2); // the reader skips the frame count itself
    p2(trailer, t1.length);
    p2(trailer, t2.length);
    p2(trailer, del.length);
    return Uint8Array.from([...head, ...t1, ...t2, ...del, ...set.base, ...trailer]);
}

function groupCountOf(base: Uint8Array) {
    return base[0];
}

// Keep a frame's transforms for groups below `limit` only.
function truncateFrame(f: Frame, limit: number): { frame: Frame; droppedGroups: number[] } {
    const flags: number[] = [];
    const vals: number[] = [];
    const droppedGroups: number[] = [];
    let vi = 0;
    for (let g = 0; g < f.groupCount; g++) {
        const fl = f.flags[g];
        const n = (fl & 1 ? 1 : 0) + (fl & 2 ? 1 : 0) + (fl & 4 ? 1 : 0);
        if (g < limit) {
            flags.push(fl);
            vals.push(...f.vals.slice(vi, vi + n));
        } else if (fl !== 0) {
            droppedGroups.push(g);
        }
        vi += n;
    }
    while (flags.length > 0 && flags[flags.length - 1] === 0) {
        flags.pop();
    }
    return { frame: { id: f.id, groupCount: flags.length, flags, vals, delay: f.delay }, droppedGroups };
}

// ob2 trailer: numPoints, numFaces, numT, hasRenderType, priority, hasAlpha, hasFaceLabels,
// hasVertexLabels, then four section lengths (the same layout the webclient's Model.unpack reads).
function relabelHeldWeapon(src: Uint8Array): Uint8Array {
    const out = src.slice();
    const t = out.length - 18;
    const numPoints = (out[t] << 8) | out[t + 1];
    const numFaces = (out[t + 2] << 8) | out[t + 3];
    const priority = out[t + 6];
    const hasRenderType = out[t + 5] === 1;
    const hasFaceLabels = out[t + 8] === 1;
    const hasVertexLabels = out[t + 9] === 1;
    let pos = numPoints + numFaces; // vertex order, face index order
    if (priority === 255) {
        pos += numFaces;
    }
    if (hasFaceLabels) {
        out.fill(NO_FACE_LABEL, pos, pos + numFaces);
        pos += numFaces;
    }
    if (hasRenderType) {
        pos += numFaces;
    }
    if (!hasVertexLabels) {
        throw new Error('worn model has no vertex labels');
    }
    out.fill(HELD_WEAPON_LABEL, pos, pos + numPoints);
    return out;
}

async function addWhipIcons(src377: string) {
    // combaticons3: 289's sheet is 10 tiles wide and leaves tiles 13 and 14 empty; 377's is 5 wide
    // and puts the whip's Flick/Lash icons there. Copy just those two, so 289's icons 0-12 stay
    // exactly as they are (several differ slightly from 377's).
    const tile = { w: 34, h: 24 };
    const target = `${CONTENT}/sprites/combaticons3.png`;
    const ours = await Jimp.read(target);
    const theirs = await Jimp.read(`${src377}/sprites/combaticons3.png`);
    const ourCols = ours.bitmap.width / tile.w;
    const theirCols = theirs.bitmap.width / tile.w;
    for (const index of [13, 14]) {
        const sx = (index % theirCols) * tile.w;
        const sy = Math.floor(index / theirCols) * tile.h;
        const dx = (index % ourCols) * tile.w;
        const dy = Math.floor(index / ourCols) * tile.h;
        for (let y = 0; y < tile.h; y++) {
            for (let x = 0; x < tile.w; x++) {
                const sp = (sx + x + (sy + y) * theirs.bitmap.width) * 4;
                const dp = (dx + x + (dy + y) * ours.bitmap.width) * 4;
                for (let c = 0; c < 4; c++) {
                    ours.bitmap.data[dp + c] = theirs.bitmap.data[sp + c];
                }
            }
        }
    }
    await ours.write(target as `${string}.png`);
}

async function main() {
    const src377 = process.argv[2];
    if (!src377 || !fs.existsSync(`${src377}/models/anim_28.anim`)) {
        console.error('usage: bun tools/pvp/import377Weapons.ts <LostCity Content 377-wip checkout>');
        process.exit(1);
    }

    const modelsOut = `${CONTENT}/models/pvp_kit`;
    const synthOut = `${CONTENT}/synth/pvp_kit`;
    fs.mkdirSync(modelsOut, { recursive: true });
    fs.mkdirSync(synthOut, { recursive: true });

    // player frames, on 289's player skeleton (every 289 player animset carries the same base)
    const playerBase = decodeAnimSet(new Uint8Array(fs.readFileSync(`${CONTENT}/models/_animset/anim_83.anim`))).base;
    const limit = groupCountOf(playerBase);
    const anim28 = decodeAnimSet(new Uint8Array(fs.readFileSync(`${src377}/models/anim_28.anim`)));
    const dropped = new Set<number>();
    const playerFrames = anim28.frames
        .filter(f => f.id >= PLAYER_FRAMES.first && f.id <= PLAYER_FRAMES.last)
        .map(f => {
            const r = truncateFrame(f, limit);
            r.droppedGroups.forEach(g => dropped.add(g));
            return r.frame;
        });
    if (playerFrames.length !== PLAYER_FRAMES.last - PLAYER_FRAMES.first + 1) {
        throw new Error(`expected ${PLAYER_FRAMES.last - PLAYER_FRAMES.first + 1} player frames, found ${playerFrames.length}`);
    }
    fs.writeFileSync(`${modelsOut}/${PLAYER_SET.name}.anim`, encodeAnimSet({ frames: playerFrames, base: playerBase }));
    console.log(`${PLAYER_SET.name}: ${playerFrames.length} frames on 289's ${limit}-group player base; dropped 377-only groups ${[...dropped].sort((a, b) => a - b).join(',')}`);

    // spotanim sets
    const anim409 = decodeAnimSet(new Uint8Array(fs.readFileSync(`${src377}/models/anim_409.anim`)));
    for (const f of anim409.frames) {
        f.id = FRAME_RENUMBER[f.id] ?? f.id;
    }
    fs.writeFileSync(`${modelsOut}/${MAUL_SPOT_SET.name}.anim`, encodeAnimSet(anim409));
    fs.copyFileSync(`${src377}/models/anim_410.anim`, `${modelsOut}/${WHIP_SPOT_SET.name}.anim`);
    console.log(`${MAUL_SPOT_SET.name}: frames ${anim409.frames.map(f => f.id).join(',')}`);

    // models
    for (const name of ['obj_abyssal_whip', 'obj_granite_maul']) {
        fs.copyFileSync(`${src377}/models/obj/${name}.ob2`, `${modelsOut}/${name}.ob2`);
        const worn = new Uint8Array(fs.readFileSync(`${src377}/models/obj/${name}_manwear.ob2`));
        fs.writeFileSync(`${modelsOut}/${name}_manwear.ob2`, relabelHeldWeapon(worn));
    }
    for (const name of ['spot_sp_attack_maul_spotanim', 'spot_sp_attack_abyssal_whip']) {
        fs.copyFileSync(`${src377}/models/spot/${name}.ob2`, `${modelsOut}/${name}.ob2`);
    }

    // sounds
    for (const name of ['whip', 'granite_maul', 'energydrain', 'quicksmash']) {
        fs.copyFileSync(`${src377}/synth/skills/slayer/${name}.synth`, `${synthOut}/${name}.synth`);
    }

    await addWhipIcons(src377);
    console.log('done');
}

if (import.meta.main) {
    await main();
}
