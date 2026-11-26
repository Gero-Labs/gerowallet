// The unsigned bundle file: what the proposer writes reads back the same, and a file that was
// altered, padded or filed under the wrong ids is refused before anything is shown.
import { beforeAll, describe, expect, it } from 'vitest';
import type { UnsignedTxBundle } from '@/modules/gerovault/contracts';
import { buildVaultSpend } from './buildSpend';
import {
  bundleFileName,
  bundleTxSource,
  checkBundleForVault,
  createUnsignedBundle,
  parseUnsignedBundle,
  signingFileText,
  transactionIdOf,
} from './bundle';
import { spendContextOf, type VaultSpendContext } from './vaultSpendContext';
import { TEST_PARAMS, fundingTransaction, lovelaceOutput, payeeAddress, testOwner, testReader, testVaultRecord, type FundingTx } from './__fixtures__/testVault';

let vault: VaultSpendContext;
let other: VaultSpendContext;
let funding: FundingTx;
let bundle: UnsignedTxBundle;

beforeAll(async () => {
  const owners = [await testOwner(1), await testOwner(2), await testOwner(3)];
  vault = await spendContextOf(await testVaultRecord(owners, 2, 0));
  other = await spendContextOf(await testVaultRecord(owners.slice(0, 2), 2, 0));
  funding = fundingTransaction([lovelaceOutput(vault.baseAddress, 30_000_000n), lovelaceOutput(vault.baseAddress, 30_000_000n)]);
  const { reader } = testReader([funding]);
  const built = await buildVaultSpend({
    context: vault,
    utxos: funding.utxos,
    recipients: [{ address: payeeAddress(), lovelace: 40_000_000n }],
    protocolParameters: TEST_PARAMS,
    currentSlot: 1000,
  });
  bundle = await createUnsignedBundle(vault, built, reader.txCbor, 1_700_000_000_000);
});

function tampered(edit: (raw: Record<string, unknown>) => void): string {
  const raw = JSON.parse(signingFileText(bundle)) as Record<string, unknown>;
  edit(raw);
  return JSON.stringify(raw);
}

describe('unsigned bundle', () => {
  it('round-trips through its file text', () => {
    expect(bundle.inputs).toHaveLength(2);
    expect(Object.keys(bundle.sourceTransactions)).toEqual([funding.id]);
    expect(parseUnsignedBundle(signingFileText(bundle))).toEqual(bundle);
    expect(bundleFileName(bundle)).toMatch(/^vault-[0-9a-f]{8}-tx-[0-9a-f]{8}\.gvtx\.json$/);
  });

  it('serves its creating transactions offline, and only those', async () => {
    const source = bundleTxSource(bundle);
    expect([...(await source([funding.id, 'ab'.repeat(32)])).keys()]).toEqual([funding.id]);
  });

  it('is not created when a creating transaction is missing or is another one', async () => {
    const built = { bodyCbor: bundle.bodyCbor, txId: bundle.txId };
    await expect(createUnsignedBundle(vault, built, async () => new Map())).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    const wrong = fundingTransaction([lovelaceOutput(vault.baseAddress, 1_000_000n)], 9);
    await expect(createUnsignedBundle(vault, built, async () => new Map([[funding.id, wrong.cbor]]))).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    await expect(createUnsignedBundle(vault, built, async () => { throw new Error('offline'); })).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
  });

  it.each([
    ['not JSON', () => '{', 'json'],
    ['an unknown field', () => tampered(raw => { raw['note'] = 'x'; }), 'bundle_fields'],
    ['a missing field', () => tampered(raw => { delete raw['createdAt']; }), 'bundle_fields'],
    ['another type', () => tampered(raw => { raw['type'] = 'gero-vault/v1|witnesses'; }), 'type'],
    ['another version', () => tampered(raw => { raw['version'] = 2; }), 'version'],
    ['an unknown network', () => tampered(raw => { raw['network'] = 'testnet'; }), 'network'],
    ['upper-case hex', () => tampered(raw => { raw['vaultId'] = String(raw['vaultId']).toUpperCase(); }), 'vault_id'],
    ['a body that is not the id', () => tampered(raw => { raw['bodyCbor'] = `${String(raw['bodyCbor']).slice(0, -2)}00`; }), 'tx_id_mismatch'],
    ['inputs that are not the body\'s', () => tampered(raw => { (raw['inputs'] as unknown[]).reverse(); }), 'inputs_not_the_body'],
    ['an input with an extra field', () => tampered(raw => { (raw['inputs'] as Record<string, unknown>[])[0]['value'] = 1; }), 'input_fields'],
    ['a creating transaction under the wrong id', () => tampered(raw => {
      const wrong = fundingTransaction([lovelaceOutput(vault.baseAddress, 1_000_000n)], 4);
      raw['sourceTransactions'] = { [funding.id]: wrong.cbor };
    }), 'source_hash'],
    ['a creating transaction of no input', () => tampered(raw => {
      const extra = fundingTransaction([lovelaceOutput(vault.baseAddress, 1_000_000n)], 5);
      raw['sourceTransactions'] = { ...(raw['sourceTransactions'] as object), [extra.id]: extra.cbor };
    }), 'source_not_an_input'],
    ['no creating transactions', () => tampered(raw => { raw['sourceTransactions'] = {}; }), 'source_missing'],
    ['an oversized file', () => ' '.repeat(5 * 1024 * 1024), 'size'],
  ])('refuses %s', (_name, text, detail) => {
    expect(() => parseUnsignedBundle(text())).toThrow(expect.objectContaining({ code: 'BUNDLE_INVALID', detail }));
  });

  it('belongs to its own vault and network only', () => {
    expect(() => checkBundleForVault(bundle, vault)).not.toThrow();
    expect(() => checkBundleForVault(bundle, other)).toThrow(expect.objectContaining({ code: 'BUNDLE_OTHER_VAULT' }));
    expect(() => checkBundleForVault(bundle, { vaultId: vault.vaultId, network: 'preview' })).toThrow(expect.objectContaining({ code: 'BUNDLE_OTHER_VAULT' }));
  });

  it('reads a transaction id from CBOR, or nothing', () => {
    expect(transactionIdOf(funding.cbor)).toBe(funding.id);
    expect(transactionIdOf('00')).toBeUndefined();
  });
});
