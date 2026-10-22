import { describe, expect, test } from 'bun:test';
import { BotActions } from '../actions';
import type { NearbyNpc, NearbyPlayer } from '../types';

const goblin: NearbyNpc = {
    kind: 'npc',
    id: 100,
    index: 4,
    name: 'Goblin',
    combatLevel: 2,
    x: 3200,
    z: 3200,
    distance: 1,
    hp: null,
    maxHp: null,
    healthPercent: null,
    targetIndex: -1,
    inCombat: false,
    lastCombatTick: null,
    animId: -1,
    spotanimId: -1,
    optionsWithIndex: [{ text: 'Attack', opIndex: 2 }],
    options: ['Attack'],
    reachable: true
};

const rival: NearbyPlayer = {
    kind: 'player',
    index: 4, // deliberately the same number as the goblin's npc index
    name: 'Zezima',
    combatLevel: 42,
    x: 3200,
    z: 3200,
    distance: 1,
    reachable: true
};

interface StateOptions {
    /** Who we are facing, if anyone. */
    engaged?: 'npc' | 'player';
    message?: string;
    magicXp?: number;
    /** A damage_dealt event on the rival after the attack started. */
    hitRival?: boolean;
    spellbook?: 'normal' | 'ancient';
}

function state({ engaged, message, magicXp = 0, hitRival = false, spellbook }: StateOptions) {
    return {
        spellbook,
        tick: message ? 2 : 1,
        revision: message ? 2 : 1,
        player: {
            worldX: 3200,
            worldZ: 3200,
            lifeId: 1,
            isDead: false,
            combat: {
                inCombat: engaged !== undefined,
                targetType: engaged ?? 'none',
                targetIndex: engaged ? 4 : -1,
                lastDamageTick: -1
            }
        },
        nearbyNpcs: [goblin],
        nearbyPlayers: [rival],
        skills: [{ name: 'Magic', level: 10, baseLevel: 10, experience: magicXp }],
        gameMessages: message
            ? [{ tick: 2, text: message, type: 0, sender: '', fromSelf: false }]
            : [],
        combatEvents: hitRival
            ? [{ tick: 2, observationId: 2, type: 'damage_dealt', targetType: 'other_player', targetIndex: rival.index, damage: 1 }]
            : [],
        dialog: { isOpen: false, options: [], isWaiting: false },
        interface: { isOpen: false, interfaceId: -1, options: [] },
        shop: { isOpen: false },
        bank: { isOpen: false }
    } as any;
}

/** A bot whose state flips to `final` as soon as an action has been dispatched. */
function createBot(final: ReturnType<typeof state>, start = state({})) {
    const dispatched: Array<{ call: string; args: unknown[] }> = [];
    let current = start;
    const record = (call: string) => async (...args: unknown[]) => {
        dispatched.push({ call, args });
        return { success: true, message: 'dispatched', phase: 'dispatch' };
    };
    const sdk = {
        getState: () => current,
        findNearbyNpc: (pattern: string | RegExp) =>
            (typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern).test(goblin.name) ? goblin : null,
        findNearbyPlayer: (pattern: string | RegExp) =>
            (typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern).test(rival.name) ? rival : null,
        sendInteractNpc: record('sendInteractNpc'),
        sendInteractPlayer: record('sendInteractPlayer'),
        sendSpellOnTarget: record('sendSpellOnTarget'),
        waitForStateChange: async () => {
            current = final;
            return current;
        },
        waitForCondition: async () => {
            current = final;
            return current;
        }
    };
    return { bot: new BotActions(sdk as any), dispatched };
}

describe('BotActions.attack target dispatch', () => {
    test('sends the player attack option for a player target', async () => {
        const harness = createBot(state({ engaged: 'player' }));
        const result = await harness.bot.attack(rival);

        expect(result).toMatchObject({ success: true, targetType: 'player' });
        expect(harness.dispatched).toEqual([{ call: 'sendInteractPlayer', args: [rival.index, 2] }]);
    });

    test('does not mistake an npc fight for engagement with the same-numbered player', async () => {
        // npc index 4 and player slot 4 are different entities; only targetType tells them apart.
        const harness = createBot(state({ engaged: 'npc' }));
        const result = await harness.bot.attack(rival, 200);

        expect(result).toMatchObject({ success: false, reason: 'timeout', targetType: 'player' });
    });

    test('reports the safe-area refusal instead of a silent no-op', async () => {
        const harness = createBot(state({ message: 'That player is in a safe area.' }));
        const result = await harness.bot.attack(rival);

        expect(result).toMatchObject({ success: false, reason: 'not_attackable', targetType: 'player' });
        expect(result.message).toContain('safe area');
    });

    test('reports spawn protection and attacking from a safe area as not attackable', async () => {
        for (const message of ['That player has just respawned and is protected.', 'That player is new and protected for now.', "You can't attack other players from a safe area."]) {
            const result = await createBot(state({ message })).bot.attack(rival);
            expect(result).toMatchObject({ success: false, reason: 'not_attackable', targetType: 'player' });
        }
    });

    test('a refusal is not success just because the server turned us toward the target', async () => {
        // The engine faces the target before the pvp rules refuse, so the client
        // briefly reports it as our combat target.
        const result = await createBot(state({ engaged: 'player', message: 'That player is in a safe area.' })).bot.attack(rival);

        expect(result).toMatchObject({ success: false, reason: 'not_attackable', targetType: 'player' });
    });

    test('a hit on the target still wins over a same-tick refusal', async () => {
        const result = await createBot(state({ engaged: 'player', hitRival: true, message: "I'm already under attack." })).bot.attack(rival);

        expect(result).toMatchObject({ success: true, targetType: 'player' });
    });

    test('still reports the wilderness refusal from upstream servers', async () => {
        const harness = createBot(state({ message: "You can't attack players who aren't in the wilderness." }));
        const result = await harness.bot.attack(rival);

        expect(result).toMatchObject({ success: false, reason: 'not_attackable', targetType: 'player' });
        expect(result.message).toContain("aren't in the wilderness");
    });

    test('reports a single-way combat lock as retryable', async () => {
        const harness = createBot(state({ message: "I'm already under attack." }));
        const result = await harness.bot.attack(rival);

        expect(result).toMatchObject({ success: false, reason: 'already_in_combat' });
    });

    test('matches a name against npcs before players', async () => {
        const harness = createBot(state({ engaged: 'npc' }));
        const result = await harness.bot.attack('goblin');

        expect(result).toMatchObject({ success: true, targetType: 'npc' });
        expect(harness.dispatched).toEqual([{ call: 'sendInteractNpc', args: [goblin.index, 2] }]);
    });

    test('falls through to players when no npc matches', async () => {
        const harness = createBot(state({ engaged: 'player' }));
        const result = await harness.bot.attack('Zezima');

        expect(result).toMatchObject({ success: true, targetType: 'player' });
        expect(harness.dispatched).toEqual([{ call: 'sendInteractPlayer', args: [rival.index, 2] }]);
    });
});

describe('BotActions.castSpell target dispatch', () => {
    test('routes a player target through the player spell packet', async () => {
        const harness = createBot(state({ magicXp: 20 }));
        const result = await harness.bot.castSpell(rival, 1152);

        expect(result).toMatchObject({ success: true, hit: true, xpGained: 20, targetType: 'player' });
        expect(harness.dispatched).toEqual([{ call: 'sendSpellOnTarget', args: [rival, 1152] }]);
    });

    test('reports a PvP refusal rather than claiming a splash', async () => {
        const harness = createBot(state({ message: 'Your level difference is too great!' }));
        const result = await harness.bot.castSpell(rival, 1152);

        expect(result).toMatchObject({ success: false, reason: 'not_attackable', targetType: 'player' });
    });

    test('still splashes on npcs without magic xp', async () => {
        const harness = createBot(state({}));
        const result = await harness.bot.castSpell(goblin, 1152);

        expect(result).toMatchObject({ success: true, hit: false, xpGained: 0, targetType: 'npc' });
        expect(harness.dispatched).toEqual([{ call: 'sendSpellOnTarget', args: [goblin, 1152] }]);
    });

    test('casts an ancient spell by name on the ancient spellbook', async () => {
        const harness = createBot(state({ magicXp: 52, spellbook: 'ancient' }), state({ spellbook: 'ancient' }));
        const result = await harness.bot.castSpell(rival, 'ice barrage');

        expect(result).toMatchObject({ success: true, hit: true, targetType: 'player' });
        expect(harness.dispatched).toEqual([{ call: 'sendSpellOnTarget', args: [rival, 40768] }]);
    });

    test("refuses a spell from the other spellbook instead of sending what the server would drop", async () => {
        const normal = createBot(state({}), state({ spellbook: 'normal' }));
        expect(await normal.bot.castSpell(rival, 'blood blitz')).toMatchObject({ success: false, reason: 'wrong_spellbook' });
        const ancient = createBot(state({}), state({ spellbook: 'ancient' }));
        expect(await ancient.bot.castSpell(goblin, 'fire wave')).toMatchObject({ success: false, reason: 'wrong_spellbook' });
        expect([...normal.dispatched, ...ancient.dispatched]).toEqual([]);
    });
});

describe('BotActions.attack PvP warnings', () => {
    test('warns about a refusal and a skull but attacks anyway', async () => {
        // The harness stands us and the rival in Lumbridge, 42 combat levels apart.
        const harness = createBot(state({ message: 'That player is in a safe area.' }));
        const result = await harness.bot.attack(rival);

        expect(harness.dispatched).toEqual([{ call: 'sendInteractPlayer', args: [rival.index, 2] }]);
        expect(result.warnings?.map(w => w.code)).toEqual(['target_in_safe_area', 'level_gap', 'you_in_safe_area', 'will_skull']);
        expect(result).toMatchObject({ success: false, reason: 'not_attackable' });
    });

    test('npc attacks carry no warnings', async () => {
        const result = await createBot(state({ engaged: 'npc' })).bot.attack(goblin);
        expect(result.warnings).toBeUndefined();
    });
});

describe('BotActions bank keys', () => {
    function keyBot(replies: string[], hasKey = true) {
        let current: any = { ...state({}), inventory: hasKey ? [{ slot: 3, id: 10000, name: 'Bank key', count: 1 }] : [] };
        const sent: unknown[][] = [];
        const sdk = {
            getState: () => current,
            findInventoryItem: (p: RegExp) => current.inventory.find((i: any) => p.test(i.name)) ?? null,
            sendUseItem: async (...args: unknown[]) => {
                sent.push(args);
                current = { ...current, gameMessages: replies.map(text => ({ tick: 5, text, type: 0, sender: '', fromSelf: false })) };
                return { success: true, message: 'dispatched' };
            },
            waitForCondition: async (pred: (s: any) => boolean) => {
                if (!pred(current)) throw new Error('timeout');
                return current;
            }
        };
        return { bot: new BotActions(sdk as any), sent };
    }

    test('checkBankKeys groups the Check lines by key', async () => {
        const { bot, sent } = keyBot(['Bank key 1: 25 x Coins', 'Bank key 1: 1 x Rune platebody', 'Bank key 2: 100 x Shark']);
        expect(await bot.checkBankKeys()).toEqual([
            { key: 1, items: [{ name: 'Coins', count: 25 }, { name: 'Rune platebody', count: 1 }] },
            { key: 2, items: [{ name: 'Shark', count: 100 }] }
        ]);
        expect(sent).toEqual([[3, 2]]);
    });

    test('openBankKey counts banked and dropped stacks', async () => {
        const { bot, sent } = keyBot(['You open the bank key: 3 stacks go to your bank.', 'Your bank is full, so 1 stack falls at your feet.']);
        expect(await bot.openBankKey()).toMatchObject({ success: true, banked: 3, dropped: 1 });
        expect(sent).toEqual([[3, 1]]);
    });

    test('openBankKey reports the server refusals', async () => {
        expect(await keyBot(["You can't open a bank key while you're skulled."]).bot.openBankKey())
            .toMatchObject({ success: false, reason: 'skulled' });
        expect(await keyBot(['Bank keys can only be opened in a safe area.']).bot.openBankKey())
            .toMatchObject({ success: false, reason: 'not_in_safe_area' });
        expect(await keyBot([], false).bot.openBankKey()).toMatchObject({ success: false, reason: 'no_key' });
    });
});
