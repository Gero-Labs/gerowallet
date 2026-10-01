import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Blockchain } from '@/models/types';
import { scrubStoredMidnightViewingKeys, stripViewingKeyFromPublicKey, withoutViewingKey } from './midnightRecordScrub';

const VK = 'mn_shield-esk_preprod1secret';
const ADDRS = { unshielded: 'mn_addr_preprod1u', shielded: 'mn_shield-addr_preprod1s', dust: 'mn_dust_preprod1d' };

describe('stripViewingKeyFromPublicKey', () => {
  it('removes the key and keeps every public field', () => {
    const out = stripViewingKeyFromPublicKey(JSON.stringify({ ...ADDRS, zswapViewingKey: VK }));
    expect(JSON.parse(out)).toEqual(ADDRS);
    expect(out).not.toContain('mn_shield-esk');
  });

  it('returns the very same string when there is nothing to remove', () => {
    for (const input of [JSON.stringify(ADDRS), 'xpub1abc', '', 'not json zswapViewingKey', '["zswapViewingKey"]']) {
      expect(stripViewingKeyFromPublicKey(input)).toBe(input);
    }
  });

  it('withoutViewingKey drops the field from an addresses object', () => {
    expect(withoutViewingKey({ ...ADDRS, zswapViewingKey: VK })).toEqual(ADDRS);
  });
});

describe('scrubStoredMidnightViewingKeys', () => {
  it('rewrites only Midnight records that still carry the key, and is idempotent', async () => {
    const rows = [
      { id: 1, chain: Blockchain.MIDNIGHT, publicKey: JSON.stringify({ ...ADDRS, zswapViewingKey: VK }) },
      { id: 2, chain: Blockchain.MIDNIGHT, publicKey: JSON.stringify(ADDRS) },
      { id: 3, chain: Blockchain.CARDANO, publicKey: '{"zswapViewingKey":"not-midnight"}' },
    ];
    const table = {
      toArray: async () => rows.map((r) => ({ ...r })),
      update: vi.fn(async (id: number, changes: { publicKey: string }) => {
        Object.assign(rows.find((r) => r.id === id)!, changes);
        return 1;
      }),
    };
    expect(await scrubStoredMidnightViewingKeys(table)).toBe(1);
    expect(table.update).toHaveBeenCalledWith(1, { publicKey: JSON.stringify(ADDRS) });
    expect(rows[2].publicKey).toContain('not-midnight');
    expect(await scrubStoredMidnightViewingKeys(table)).toBe(0);
  });
});

describe('write paths never persist the viewing key', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

  it('new Midnight records are written without it', () => {
    expect(read('db/gero-db.ts')).toContain('withoutViewingKey(midnightAddresses)');
  });

  it('UPDATE_MIDNIGHT_PUBLIC_KEY strips it from whatever the page sends', () => {
    const bg = read('chrome/background.ts');
    const handler = bg.slice(bg.indexOf('app.addToOptions(MessageTypes.UPDATE_MIDNIGHT_PUBLIC_KEY'));
    const body = handler.slice(0, handler.indexOf('\napp.add'));
    expect(body).toContain('stripViewingKeyFromPublicKey(suppliedPublicKey)');
    expect(body).toContain("update(walletId, { publicKey })");
  });

  it('the worker scrubs stored records and the walletStore copy at boot', () => {
    const bg = read('chrome/background.ts');
    const boot = bg.slice(bg.indexOf('loadWallets().then(async () => {'), bg.indexOf('await walletManager.login(walletStore.loggedWallet);'));
    expect(boot).toContain('scrubStoredMidnightViewingKeys(');
    expect(boot).toContain('stripViewingKeyFromPublicKey(walletStore.loggedWallet.publicKey)');
  });
});

describe('Midnight data on wallet deletion', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

  it('the Advanced tab asks the background to forget Midnight data before the record is removed', () => {
    const tab = read('modules/dashboard/components/AdvancedSettingsTab.vue');
    const forget = tab.indexOf('MessageTypes.FORGET_MIDNIGHT_WALLET_DATA');
    const remove = tab.indexOf('GeroStore.removeWallet(walletId)');
    expect(forget).toBeGreaterThan(-1);
    expect(forget).toBeLessThan(remove);
  });

  it('the background clears store state, the address-scoped cache and the SDK state blobs', () => {
    const bg = read('chrome/background.ts');
    const start = bg.indexOf('app.addToOptions(MessageTypes.FORGET_MIDNIGHT_WALLET_DATA');
    const handler = bg.slice(start, bg.indexOf('\napp.add', start + 10));
    expect(handler).toContain('midnightActions.forgetWallet(unshielded)');
    expect(handler).toContain('deleteStoreCacheScope(unshielded)');
    expect(handler).toContain('clearAllWalletState()');
    // The address comes from the wallet's own record, not from the page.
    expect(handler).toContain('getAllWallets()');
    expect(handler).not.toMatch(/request\.data\?\.(unshielded|address)/);
  });
});
