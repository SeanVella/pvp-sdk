import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BotSDK } from '../index';
import { BotActions } from '../actions';

// pvp-sdk: the safe deposit box (server/content/scripts/pvp_world/scripts/dmm_safe_box.rs2)

const pack = readFileSync(join(import.meta.dir, '..', '..', 'server', 'content', 'pack', 'interface.pack'), 'utf8');

describe('safe deposit box packets', () => {
    function recordingSdk() {
        const sdk = new BotSDK({ botUsername: 'tester' });
        const sent: any[] = [];
        (sdk as any).sendAction = async (action: any) => {
            sent.push(action);
            return { success: true, message: 'dispatched' };
        };
        return { sdk, sent };
    }

    test('the component ids match the content pack', () => {
        expect(pack).toMatch(/^40496=dmm_safe_box\r?$/m);
        expect(pack).toMatch(/^40589=dmm_safe_box:inv\r?$/m);
        expect(pack).toMatch(/^40592=dmm_safe_box_side:inv\r?$/m);
    });

    test('store and withdraw click the box\'s 1/5/10/All/X buttons', async () => {
        const { sdk, sent } = recordingSdk();
        await sdk.sendSafeBoxStore(3, 1);
        await sdk.sendSafeBoxStore(4, -1);
        await sdk.sendSafeBoxWithdraw(0, 250);
        expect(sent.map(a => [a.type, a.componentId, a.optionIndex, a.slot, a.value])).toEqual([
            ['clickComponentWithOption', 40592, 1, 3, undefined],
            ['clickComponentWithOption', 40592, 4, 4, undefined],
            ['clickComponentWithOption', 40589, 5, 0, undefined],
            ['submitCountDialog', undefined, undefined, undefined, 250]
        ]);
    });
});

describe('BotActions safe deposit box', () => {
    function boxBot(reply: (box: any[], inv: any[]) => string | null) {
        const box: any[] = [{ slot: 0, id: 995, name: 'Coins', count: 500 }];
        const inv: any[] = [{ slot: 2, id: 1127, name: 'Rune platebody', count: 1 }];
        let messages: any[] = [];
        const sdk = {
            getSafeBox: () => ({ isOpen: true, items: box.map(i => ({ ...i })) }),
            getState: () => ({ gameMessages: messages }),
            findInventoryItem: (p: RegExp) => inv.find(i => p.test(i.name)) ?? null,
            sendSafeBoxStore: async (slot: number) => {
                const text = reply(box, inv);
                if (text) messages = [{ tick: 9, observationId: 9, text, type: 0 }];
                else box.push({ slot: 1, id: inv.find(i => i.slot === slot).id, name: 'Rune platebody', count: 1 });
                return { success: true, message: 'dispatched' };
            },
            sendSafeBoxWithdraw: async () => {
                box[0].count -= 100;
                return { success: true, message: 'dispatched' };
            },
            waitForCondition: async (pred: () => boolean) => {
                if (!pred()) throw new Error('timeout');
            }
        };
        return new BotActions(sdk as any);
    }

    test('stores an item and reports how many went in', async () => {
        expect(await boxBot(() => null).storeInSafeDepositBox(/platebody/i)).toEqual({ success: true, message: 'Stored 1 x Rune platebody' });
    });

    test('reports a full box as a refusal', async () => {
        const result = await boxBot(() => 'Your safe deposit box is full.').storeInSafeDepositBox(/platebody/i);
        expect(result).toMatchObject({ success: false, reason: 'refused', message: 'Your safe deposit box is full.' });
    });

    test('withdraws by name', async () => {
        expect(await boxBot(() => null).withdrawFromSafeDepositBox('coins', 100)).toEqual({ success: true, message: 'Withdrew 100 x Coins' });
    });

    test('needs the box open', async () => {
        const closed = new BotActions({ getSafeBox: () => ({ isOpen: false, items: [] }) } as any);
        expect(await closed.storeInSafeDepositBox('coins')).toMatchObject({ success: false, reason: 'not_open' });
    });
});
