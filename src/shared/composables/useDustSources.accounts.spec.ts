// An added Cardano account (issue 1307) as a cNIGHT source of a Midnight wallet.
// Its record holds no secrets: the phrase is its account #0's, and its keys sit
// at its own account index. Real key derivation, real phrase encryption and the
// real signer; only Nexus and the Midnight address codec are stood in for.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bech32 } from 'bech32';
import { Cardano, Serialization } from '@cardano-sdk/core';

const { api } = vi.hoisted(() => ({
  api: { buildDustRegistrationTx: vi.fn(), submitCardanoTx: vi.fn() },
}));
vi.mock('@/stores/geroStore', async () => ({ geroStore: (await import('vue')).reactive({ wallets: {} as Record<number, unknown> }) }));
vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: { id: 50, name: 'Night', chain: 'Midnight', network: 'Preprod' } } }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: { addresses: { dust: 'dust-address' } } }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => api }));
vi.mock('@/chains/midnight/midnightKeyManager', () => ({ dustAddressToHex: () => 'abcd' }));
vi.mock('@/shared/composables/useCnightDustRegistration', () => ({ CNIGHT_ASSETS: {}, mapDustBuildError: (message: string) => message }));
vi.mock('@/shared/composables/useDustPending', () => ({ clearDustPending: vi.fn(), markDustPending: vi.fn(), reconcileDustPending: vi.fn() }));

import { useDustSources, type DustSource } from './useDustSources';
import { enumerateCardanoStakeIdentities } from './useCardanoStakeEnumeration';
import { geroStore } from '@/stores/geroStore';
import { getAddress, getPaymentKeyExternal, getStakeKey } from '@/chrome/serialization';
import { resolvePrivateKey } from '@/shared/utils/resolver';
import { encrypt } from '@/shared/utils/crypto';
import { Blockchain, CoinTypes, HARDENED, Network, WalletType, WalletTypePurpose } from '@/models/types';

// Fixed test vector — never used to hold funds.
const MNEMONIC = `${'abandon '.repeat(23)}art`;
const PASSWORD = 'Test-Password-1!';
const rootKey = resolvePrivateKey(MNEMONIC);

function accountXpub(index: number): string {
  const hex = rootKey.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index]).toPublic().hex();
  return bech32.encode('xpub', bech32.toWords(Buffer.from(hex, 'hex')), 1023);
}

const base = { chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal, encryptionMethod: 'password' };
const daily = { id: 1, name: 'Daily', ...base, publicKey: accountXpub(0), encryptedMnemonic: encrypt(MNEMONIC, PASSWORD) };
const added = { id: 2, name: 'Account #1', ...base, publicKey: accountXpub(1), accountIndex: 1, parentWalletId: 1 };
const orphan = { id: 3, name: 'Account #2', ...base, publicKey: accountXpub(2), accountIndex: 2, parentWalletId: 99 };

/** An unsigned transaction spending one UTxO at `address`. */
function spendFrom(address: string): string {
  const addressHex = Cardano.Address.fromBech32(address).toBytes();
  return `84a300818258 20${'aa'.repeat(32)}00 0181825839${addressHex}1a001e8480 021a00030d40 a0f5f6`.replace(/ /g, '');
}

/** A row the dialog would offer Register on: both chain reads answered, nothing registered. */
async function sourceFor(walletId: number): Promise<DustSource> {
  const identity = (await enumerateCardanoStakeIdentities(Network.PREPROD)).find((row) => row.walletId === walletId)!;
  return { ...identity, nightBalance: 1n, status: null, statusLoaded: true, registrations: [], registrationsLoaded: true, pendingLocal: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  geroStore.wallets = { 1: daily, 2: added, 3: orphan } as unknown as typeof geroStore.wallets;
  api.submitCardanoTx.mockResolvedValue('tx-id');
});

describe('an added Cardano account as a cNIGHT source', () => {
  it('can sign with its account #0’s phrase, at its own account; one whose account #0 is gone cannot', async () => {
    const [child, lost] = [await sourceFor(2), await sourceFor(3)];
    expect(child).toMatchObject({ accountIndex: 1, canSign: true, encryptionMethod: 'password' });
    expect(child.baseAddress).toBe(getAddress(accountXpub(1), Blockchain.CARDANO, Network.PREPROD, 0).toBech32());
    expect(lost).toMatchObject({ accountIndex: 2, canSign: false });
  });

  it('registers with that account’s payment and stake keys, never account #0’s', async () => {
    const child = await sourceFor(2);
    api.buildDustRegistrationTx.mockResolvedValue({ status: 'complete', txCbor: spendFrom(child.baseAddress) });

    const result = await useDustSources().registerSource(child, { password: PASSWORD });

    expect(result).toEqual({ status: 'submitted', txHash: 'tx-id' });
    const submitted = Serialization.Transaction.fromCbor(Serialization.TxCBOR(api.submitCardanoTx.mock.calls[0][0]));
    const signers = (submitted.witnessSet().vkeys()?.values() ?? []).map((witness) => witness.vkey());
    expect(signers.sort()).toEqual([getPaymentKeyExternal(accountXpub(1), 0).hex(), getStakeKey(accountXpub(1), 0).hex()].sort());
    expect(signers).not.toContain(getPaymentKeyExternal(accountXpub(0), 0).hex());
  });

  it('refuses to sign when the phrase does not derive the source’s address at its account', async () => {
    const child = { ...(await sourceFor(2)), accountIndex: 0 };
    api.buildDustRegistrationTx.mockResolvedValue({ status: 'complete', txCbor: spendFrom(child.baseAddress) });

    const result = await useDustSources().registerSource(child, { password: PASSWORD });

    expect(result).toEqual({ status: 'error', message: 'Decrypted seed does not derive this Cardano address' });
    expect(api.submitCardanoTx).not.toHaveBeenCalled();
  });
});
