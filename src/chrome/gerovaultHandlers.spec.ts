// The GeroVault background requests (gerovaultHandlers.ts) as behaviour, with injected
// dependencies and keys generated here; background.ts cannot be loaded by a unit test, so its
// registration of both is pinned by its source. Neither request ever logs what it was sent.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Bip32PrivateKey, ready } from '@cardano-sdk/crypto';
import { MessageTypes } from '@/models/MessageTypes';
import { Blockchain, Network, WalletType, type Wallet } from '@/models/types';
import { accountXpub, cardanoAccountPath } from '@/shared/utils/walletAccount';
import { UnlockThrottledError } from '@/chrome/unlockGuards';
import type { UnsignedTxBundle, VaultRecord } from '@/modules/gerovault/contracts';
import { buildVaultSpend } from '@/modules/gerovault/spend/buildSpend';
import { createUnsignedBundle } from '@/modules/gerovault/spend/bundle';
import { spendContextOf } from '@/modules/gerovault/spend/vaultSpendContext';
import type { SignVaultBundleDeps } from '@/modules/gerovault/spend/signBundleFlow';
import {
  TEST_PARAMS,
  fundingTransaction,
  lovelaceOutput,
  payeeAddress,
  seededRandom,
  testOwner,
  testReader,
  testVaultRecord,
  type TestOwner,
} from '@/modules/gerovault/spend/__fixtures__/testVault';
import { gerovaultDeriveAccountKeyHandler, gerovaultSignVaultBundleHandler } from './gerovaultHandlers';

const HARDENED = 0x80000000;
const PASSWORD = 'synthetic-spending-password';
const TIP = 80_000_000;

afterEach(() => vi.restoreAllMocks());

/** Runs a handler once and returns what it answered, failing if anything was logged. */
type Handler = ReturnType<typeof gerovaultSignVaultBundleHandler>;

async function answer(handler: Handler, data: unknown) {
  const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level => vi.spyOn(console, level).mockImplementation(() => {}));
  const sendResponse = vi.fn();
  await expect(handler({ id: 'r1', data }, sendResponse)).resolves.toBe(true);
  expect(sendResponse).toHaveBeenCalledTimes(1);
  const [response] = sendResponse.mock.calls[0];
  expect(response).toMatchObject({ id: 'r1', target: 'gerowallet' });
  for (const log of logs) for (const call of log.mock.calls) expect(JSON.stringify(call)).not.toContain(PASSWORD);
  return response.data as Record<string, unknown>;
}

describe('GEROVAULT_DERIVE_ACCOUNT_KEY', () => {
  let rootBytes: Uint8Array;
  let otherRoot: Uint8Array;
  let record: Wallet;
  let multisigAccount: string;

  beforeAll(async () => {
    await ready();
    const root = Bip32PrivateKey.fromBip39Entropy(Buffer.alloc(16, 7), '');
    rootBytes = Uint8Array.from(root.bytes());
    otherRoot = Uint8Array.from(Bip32PrivateKey.fromBip39Entropy(Buffer.alloc(16, 8), '').bytes());
    const zero = root.derive([HARDENED + 1852, HARDENED + 1815, HARDENED]).toPublic().hex();
    multisigAccount = root.derive([HARDENED + 1854, HARDENED + 1815, HARDENED]).toPublic().hex();
    record = {
      id: 7, name: 'Test', chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal,
      encryptionMethod: 'password', encryptedPrivateKey: 'sealed',
      publicKey: accountXpub(zero.slice(0, 64), zero.slice(64), cardanoAccountPath(0)).publicKey,
    } as Wallet;
  });

  const handler = (root: () => Uint8Array) => gerovaultDeriveAccountKeyHandler(async () => ({
    getWallets: async () => ({ [record.id]: record }),
    sessionRootKey: () => undefined,
    decryptRootKey: (_sealed: string, password: string) => {
      if (password !== PASSWORD) throw new Error('bad password');
      return Uint8Array.from(root());
    },
  }));

  it('answers the multisig account public key and nothing else', async () => {
    expect(await answer(handler(() => rootBytes), { walletId: 7, password: PASSWORD })).toEqual({ success: true, publicKey: multisigAccount });
  });

  it('answers wrong-password, and not-supported for a root key that is not this wallet\'s', async () => {
    expect(await answer(handler(() => rootBytes), { walletId: 7, password: 'wrong' })).toEqual({ success: false, error: 'wrong-password' });
    expect(await answer(handler(() => otherRoot), { walletId: 7, password: PASSWORD })).toEqual({ success: false, error: 'not-supported' });
    expect(await answer(handler(() => rootBytes), { walletId: 8, password: PASSWORD })).toEqual({ success: false, error: 'not-found' });
    expect(await answer(handler(() => rootBytes), undefined)).toEqual({ success: false, error: 'not-found' });
  });
});

describe('GEROVAULT_SIGN_VAULT_BUNDLE', () => {
  const WALLET = { id: 31, network: 'Preprod', type: WalletType.Normal, encryptionMethod: 'password' as const, encryptedPrivateKey: 'sealed' };
  let owners: TestOwner[];
  let records: VaultRecord[];
  let bundle: UnsignedTxBundle;

  beforeAll(async () => {
    owners = [await testOwner(1), await testOwner(2), await testOwner(3)];
    records = await Promise.all(owners.map((_, i) => testVaultRecord(owners, 2, i)));
    const proposer = await spendContextOf(records[0]);
    const { reader } = testReader([fundingTransaction([lovelaceOutput(proposer.baseAddress, 40_000_000n)])]);
    const built = await buildVaultSpend({
      context: proposer,
      utxos: await reader.utxos(proposer.baseAddress),
      recipients: [{ address: payeeAddress(), lovelace: 12_000_000n }],
      protocolParameters: TEST_PARAMS,
      currentSlot: TIP,
      random: seededRandom(5),
    });
    bundle = await createUnsignedBundle(proposer, built, reader.txCbor, 1_700_000_000_000);
  });

  const handler = (who: number, overrides: Partial<SignVaultBundleDeps> = {}) => gerovaultSignVaultBundleHandler(async () => ({
    wallet: () => WALLET,
    verifyPassword: async (password: string) => password === PASSWORD,
    decryptRootKey: () => Uint8Array.from(owners[who].rootKey),
    getVault: async (_walletId: number, vaultId: string) => records.find(r => r.vaultId === vaultId && r === records[who]),
    acceptedVaults: async () => [records[who]],
    currentSlot: () => TIP,
    ...overrides,
  }));
  const data = (extra: Record<string, unknown> = {}) => ({ walletId: WALLET.id, vaultId: records[1].vaultId, bundle, password: PASSWORD, ...extra });

  it('answers this wallet\'s witness file only', async () => {
    const response = await answer(handler(1), data());
    expect(Object.keys(response).sort()).toEqual(['success', 'witnessFile']);
    expect(response['success']).toBe(true);
    expect(response['witnessFile']).toMatchObject({ signerKeyHash: owners[1].credential, txId: bundle.txId, vaultId: records[1].vaultId });
  });

  it('answers wrong-password, and throttled with the wait while the back-off runs', async () => {
    expect(await answer(handler(1), data({ password: 'wrong' }))).toEqual({ success: false, error: 'wrong-password' });
    const throttled = handler(1, { verifyPassword: async () => { throw new UnlockThrottledError(30_000); } });
    expect(await answer(throttled, data())).toEqual({ success: false, error: 'throttled', retryAfterMs: 30_000 });
  });

  it('answers key-mismatch when the key at the record\'s index is not its credential', async () => {
    expect(await answer(handler(1, { decryptRootKey: () => Uint8Array.from(owners[2].rootKey) }), data())).toEqual({ success: false, error: 'key-mismatch' });
  });

  it('answers bundle-refused with the sheet\'s refusals, and bundle-invalid for an altered file', async () => {
    const late = handler(1, { currentSlot: () => TIP + 10 * 24 * 3600 });
    expect(await answer(late, data())).toEqual({ success: false, error: 'bundle-refused', detail: 'expired' });
    expect(await answer(handler(1), data({ bundle: { ...bundle, txId: 'ab'.repeat(32) } }))).toMatchObject({ success: false, error: 'bundle-invalid' });
  });
});

describe('background registration', () => {
  const source = readFileSync(join(__dirname, 'background.ts'), 'utf8');

  it('registers both GeroVault requests for extension pages only, through these handlers', () => {
    expect(source).toContain(`app.addToOptions(MessageTypes.${MessageTypes.GEROVAULT_DERIVE_ACCOUNT_KEY}, gerovaultDeriveAccountKeyHandler(`);
    expect(source).toContain(`app.addToOptions(MessageTypes.${MessageTypes.GEROVAULT_SIGN_VAULT_BUNDLE}, gerovaultSignVaultBundleHandler(`);
    expect(source).toContain('verifyPassword: (password) => walletBg.verifySpendingPassword(password)');
    // The stored tip carries no network: it is read on the vault's network clock.
    expect(source).toMatch(/currentSlot: \(network\) => \{[^}]*slotOnNetwork\(network, /);
    expect(source).not.toMatch(/addToWebpage\(MessageTypes\.GEROVAULT_/);
  });
});
