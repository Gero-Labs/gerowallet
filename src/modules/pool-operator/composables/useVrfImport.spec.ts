import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/blockchain-api', () => ({
  default: { getPoolById: vi.fn() },
}));
vi.mock('@/db/wallet-db', () => ({ setWalletConfiguration: vi.fn() }));
vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: { id: 1 } } }));
vi.mock('@/stores/poolOperatorStore', () => ({ poolOperatorStore: { vrfKeyHash: null } }));

import { useVrfImport } from './useVrfImport';
import blockchainApi from '@/api/blockchain-api';
import { poolOperatorStore } from '@/stores/poolOperatorStore';

const VKEY_HEX = '8b9e7e6f0e4b8c8b2b3d4a5c6e7f8091a2b3c4d5e6f7081920314253647586a7';
const EXPECT_HASH = '0fa36c7b9ad5be4e49be962cfae8b4e0cb9d45c384539e72151ffd01924fdcde';

describe('useVrfImport', () => {
  it('hashVrfVkey strips 5820 and blake2b-256 hashes the raw vkey', async () => {
    const { hashVrfVkey } = useVrfImport();
    expect(await hashVrfVkey('5820' + VKEY_HEX)).toBe(EXPECT_HASH);
  });

  it('hashVrfVkey handles a cborHex with no 5820 prefix', async () => {
    const { hashVrfVkey } = useVrfImport();
    expect(await hashVrfVkey(VKEY_HEX)).toBe(EXPECT_HASH);
  });

  it('parseVrfFile reads a TextEnvelope and returns the hash', async () => {
    const { parseVrfFile } = useVrfImport();
    const file = new File(
      [JSON.stringify({ type: 'VrfVerificationKey_PraosVRF', cborHex: '5820' + VKEY_HEX })],
      'vrf.vkey',
    );
    expect(await parseVrfFile(file)).toBe(EXPECT_HASH);
  });

  it('parseVrfFile rejects a file with no cborHex', async () => {
    const { parseVrfFile } = useVrfImport();
    const file = new File([JSON.stringify({ type: 'x' })], 'bad.vkey');
    await expect(parseVrfFile(file)).rejects.toThrow('invalidVrfKeyFile');
  });

  it('parseVrfFile rejects non-hex cborHex', async () => {
    const { parseVrfFile } = useVrfImport();
    const file = new File(
      [JSON.stringify({ type: 'x', cborHex: '5820' + 'zz'.repeat(32) })],
      'bad.vkey',
    );
    await expect(parseVrfFile(file)).rejects.toThrow('invalidVrfKeyFile');
  });

  it('parseVrfFile rejects too-short cborHex', async () => {
    const { parseVrfFile } = useVrfImport();
    const file = new File([JSON.stringify({ type: 'x', cborHex: '5820' })], 'bad.vkey');
    await expect(parseVrfFile(file)).rejects.toThrow('invalidVrfKeyFile');
  });

  it('fetchVrfFromChain returns vrf_key_hash on hit', async () => {
    vi.mocked(blockchainApi.getPoolById).mockResolvedValue({ vrf_key_hash: EXPECT_HASH });
    const { fetchVrfFromChain } = useVrfImport();
    expect(await fetchVrfFromChain('pool1', 'Cardano', 'Mainnet')).toBe(EXPECT_HASH);
  });

  it('fetchVrfFromChain returns null when vrf_key_hash is malformed', async () => {
    vi.mocked(blockchainApi.getPoolById).mockResolvedValue({ vrf_key_hash: 'vrf_vk1abcdef' });
    const { fetchVrfFromChain } = useVrfImport();
    expect(await fetchVrfFromChain('pool1', 'Cardano', 'Mainnet')).toBeNull();
  });

  it('fetchVrfFromChain returns null when field absent', async () => {
    vi.mocked(blockchainApi.getPoolById).mockResolvedValue({});
    const { fetchVrfFromChain } = useVrfImport();
    expect(await fetchVrfFromChain('pool1', 'Cardano', 'Mainnet')).toBeNull();
  });

  it('fetchVrfFromChain returns null on error', async () => {
    vi.mocked(blockchainApi.getPoolById).mockRejectedValue(new Error('network'));
    const { fetchVrfFromChain } = useVrfImport();
    expect(await fetchVrfFromChain('pool1', 'Cardano', 'Mainnet')).toBeNull();
  });

  it('saveVrf writes store and db', async () => {
    const { setWalletConfiguration } = await import('@/db/wallet-db');
    const { saveVrf } = useVrfImport();
    await saveVrf(EXPECT_HASH);
    expect(poolOperatorStore.vrfKeyHash).toBe(EXPECT_HASH);
    expect(setWalletConfiguration).toHaveBeenCalledWith(1, 'spo_vrfKeyHash', EXPECT_HASH);
  });
});
