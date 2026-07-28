import { describe, it, expect, vi } from 'vitest';

vi.mock('@/db/wallet-db', () => ({ setWalletConfiguration: vi.fn() }));
vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: { id: 1, type: 'Normal' } } }));
vi.mock('@/stores/poolOperatorStore', () => ({ poolOperatorStore: {} }));

import { useColdKeyImport } from './useColdKeyImport';

const SKEY_HEX = '0000000000000000000000000000000000000000000000000000000000000001';
const EXPECT_HASH = 'c0c076fde689af49a07d93b2b48fbcb6865785d2a7bb1430fc3fe190';
const EXPECT_POOL = 'pool1crq8dl0x3xh5ngrajwetfrauk6r90pwj57a3gv8u8lseq4a0anz';

describe('useColdKeyImport', () => {
  it('parseColdKey extracts the raw key from a StakePoolSigningKey envelope', () => {
    const { parseColdKey } = useColdKeyImport();
    const { type, rawKeyBytes } = parseColdKey(
      JSON.stringify({ type: 'StakePoolSigningKey_ed25519', cborHex: '5820' + SKEY_HEX }),
    );
    expect(type).toContain('StakePoolSigningKey');
    expect(Buffer.from(rawKeyBytes).toString('hex')).toBe(SKEY_HEX);
  });

  it('parseColdKey rejects a non-pool key type', () => {
    const { parseColdKey } = useColdKeyImport();
    expect(() =>
      parseColdKey(JSON.stringify({ type: 'PaymentSigningKeyShelley_ed25519', cborHex: '5820' + SKEY_HEX })),
    ).toThrow();
  });

  it('derivePoolId returns blake2b-224 hash and bech32 pool id', async () => {
    const { parseColdKey, derivePoolId } = useColdKeyImport();
    const { rawKeyBytes } = parseColdKey(
      JSON.stringify({ type: 'StakePoolSigningKey_ed25519', cborHex: '5820' + SKEY_HEX }),
    );
    const { coldKeyHash, poolIdBech32 } = await derivePoolId(rawKeyBytes);
    expect(coldKeyHash).toBe(EXPECT_HASH);
    expect(poolIdBech32).toBe(EXPECT_POOL);
  });
});
