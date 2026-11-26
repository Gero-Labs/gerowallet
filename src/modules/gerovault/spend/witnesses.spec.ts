// Witness files: each one is held to this device's vault record and to the exact bundle. A key
// that is not in the script, a signature for another body, another vault, a forged signature or a
// cosigner who is not an owner is refused; the transaction is assembled only at threshold.
import { beforeAll, describe, expect, it } from 'vitest';
import { Serialization } from '@cardano-sdk/core';
import type { UnsignedTxBundle, VaultWitnessFile } from '@/modules/gerovault/contracts';
import { buildVaultSpend } from './buildSpend';
import { createUnsignedBundle, signingFileText } from './bundle';
import { signWithRootKey } from './signer';
import { spendContextOf, type VaultSpendContext } from './vaultSpendContext';
import {
  addSignature,
  assembleTransaction,
  createWitnessFile,
  emptyCollection,
  parseWitnessFile,
  signingProgress,
  verifyWitnessFile,
  witnessFileName,
  witnessKeyHashes,
} from './witnesses';
import { TEST_PARAMS, fundingTransaction, lovelaceOutput, payeeAddress, testOwner, testReader, testVaultRecord, type TestOwner } from './__fixtures__/testVault';

let owners: TestOwner[];
let outsider: TestOwner;
let vault: VaultSpendContext;
let bundle: UnsignedTxBundle;
let secondBundle: UnsignedTxBundle;

async function makeBundle(context: VaultSpendContext, lovelace: bigint): Promise<UnsignedTxBundle> {
  const funding = fundingTransaction([lovelaceOutput(context.baseAddress, 80_000_000n)]);
  const { reader } = testReader([funding]);
  const built = await buildVaultSpend({
    context,
    utxos: funding.utxos,
    recipients: [{ address: payeeAddress(), lovelace }],
    protocolParameters: TEST_PARAMS,
    currentSlot: 5000,
  });
  return createUnsignedBundle(context, built, reader.txCbor);
}

async function fileFrom(owner: TestOwner, target: UnsignedTxBundle, signerKeyHash = owner.credential): Promise<VaultWitnessFile> {
  const witness = await signWithRootKey(owner.rootKey, owner.index, owner.credential, target.txId);
  return parseWitnessFile(signingFileText(createWitnessFile(target, { credential: signerKeyHash }, [witness])));
}

beforeAll(async () => {
  owners = [await testOwner(1), await testOwner(2), await testOwner(3)];
  outsider = await testOwner(1);
  vault = await spendContextOf(await testVaultRecord(owners, 2, 0));
  bundle = await makeBundle(vault, 10_000_000n);
  secondBundle = await makeBundle(vault, 11_000_000n);
});

describe('witness files', () => {
  it('round-trip through their file text and verify against the bundle', async () => {
    const file = await fileFrom(owners[1], bundle);
    expect(witnessFileName(file)).toMatch(/^vault-tx-[0-9a-f]{8}-signer-[0-9a-f]{8}\.gvsig\.json$/);
    const verified = await verifyWitnessFile(file, bundle, vault);
    expect(verified.signer.credential).toBe(owners[1].credential);
    expect(verified.witness.vkey).toBe(owners[1].keys.payment);
  });

  it('refuses a witness whose key is not in the script', async () => {
    const file = await fileFrom(outsider, bundle, owners[1].credential);
    await expect(verifyWitnessFile(file, bundle, vault)).rejects.toMatchObject({ code: 'WITNESS_INVALID', detail: 'key_not_in_script' });
  });

  it('refuses a signer who is not a participant', async () => {
    const file = await fileFrom(outsider, bundle);
    await expect(verifyWitnessFile(file, bundle, vault)).rejects.toMatchObject({ code: 'WITNESS_INVALID', detail: 'signer_unknown' });
  });

  it('refuses a witness for another body', async () => {
    const file = await fileFrom(owners[1], secondBundle);
    await expect(verifyWitnessFile(file, bundle, vault)).rejects.toMatchObject({ code: 'WITNESS_INVALID', detail: 'other_body' });
    // The same signature relabelled as this bundle's still does not verify over this body.
    const relabelled: VaultWitnessFile = { ...file, txId: bundle.txId, bundleHash: createWitnessFile(bundle, owners[1], file.vkeyWitnesses).bundleHash };
    await expect(verifyWitnessFile(relabelled, bundle, vault)).rejects.toMatchObject({ code: 'WITNESS_INVALID', detail: 'bad_signature' });
  });

  it('refuses another owner\'s key under a signer\'s name', async () => {
    const file = await fileFrom(owners[2], bundle, owners[1].credential);
    await expect(verifyWitnessFile(file, bundle, vault)).rejects.toMatchObject({ code: 'WITNESS_INVALID', detail: 'key_not_signer' });
  });

  it('refuses a forged signature', async () => {
    const file = await fileFrom(owners[1], bundle);
    const forged: VaultWitnessFile = { ...file, vkeyWitnesses: [{ vkey: file.vkeyWitnesses[0].vkey, signature: `${'00'.repeat(32)}${file.vkeyWitnesses[0].signature.slice(64)}` }] };
    await expect(verifyWitnessFile(forged, bundle, vault)).rejects.toMatchObject({ code: 'WITNESS_INVALID', detail: 'bad_signature' });
  });

  it('refuses a file for another vault or network', async () => {
    const file = await fileFrom(owners[1], bundle);
    await expect(verifyWitnessFile({ ...file, vaultId: 'ab'.repeat(32) }, bundle, vault)).rejects.toMatchObject({ detail: 'other_vault' });
    await expect(verifyWitnessFile({ ...file, network: 'preview' }, bundle, vault)).rejects.toMatchObject({ detail: 'other_network' });
  });

  it.each([
    ['not JSON', 'nope'],
    ['an unknown field', (f: string) => f.replace('"createdAt"', '"extra": 1, "createdAt"')],
    ['no witnesses', (f: string) => { const raw = JSON.parse(f); raw.vkeyWitnesses = []; return JSON.stringify(raw); }],
    ['a short key', (f: string) => { const raw = JSON.parse(f); raw.vkeyWitnesses[0].vkey = 'ab'; return JSON.stringify(raw); }],
    ['an unsigned bundle', () => signingFileText(bundle)],
  ])('refuses %s as malformed', async (_name, edit) => {
    const text = signingFileText(await fileFrom(owners[1], bundle));
    const input = typeof edit === 'string' ? edit : edit(text);
    expect(() => parseWitnessFile(input)).toThrow(expect.objectContaining({ code: 'WITNESS_INVALID', detail: 'malformed' }));
  });
});

describe('collecting and assembling', () => {
  it('counts each owner once and assembles at threshold', async () => {
    const one = await verifyWitnessFile(await fileFrom(owners[0], bundle), bundle, vault);
    const two = await verifyWitnessFile(await fileFrom(owners[2], bundle), bundle, vault);
    let collection = addSignature(emptyCollection(bundle), one).collection;
    const again = addSignature(collection, one);
    expect(again.added).toBe(false);
    expect(signingProgress(again.collection, vault).collected).toBe(1);
    expect(() => assembleTransaction(bundle, vault, collection)).toThrow(expect.objectContaining({ code: 'NOT_AT_THRESHOLD' }));

    collection = addSignature(collection, two).collection;
    const progress = signingProgress(collection, vault);
    expect(progress).toMatchObject({ collected: 2, threshold: 2, complete: true });
    expect(progress.owners.map(o => o.signed)).toEqual(vault.owners.map(c => c === owners[0].credential || c === owners[2].credential));

    const tx = assembleTransaction(bundle, vault, collection);
    const parsed = Serialization.Transaction.fromCbor(tx as Serialization.TxCBOR);
    expect(String(parsed.getId())).toBe(bundle.txId);
    expect(parsed.body().toCbor()).toBe(bundle.bodyCbor);
    expect((await witnessKeyHashes(tx)).sort()).toEqual([owners[0].credential, owners[2].credential].sort());
    expect(parsed.witnessSet().nativeScripts()?.toCore()).toHaveLength(1);
  });

  it('puts exactly the threshold of witnesses in the transaction when more owners signed', async () => {
    let collection = emptyCollection(bundle);
    for (const owner of owners) collection = addSignature(collection, await verifyWitnessFile(await fileFrom(owner, bundle), bundle, vault)).collection;
    expect(signingProgress(collection, vault).collected).toBe(3);
    expect(await witnessKeyHashes(assembleTransaction(bundle, vault, collection))).toHaveLength(2);
  });

  it('does not assemble signatures collected for another bundle', async () => {
    let collection = emptyCollection(secondBundle);
    for (const owner of owners.slice(0, 2)) {
      collection = addSignature(collection, await verifyWitnessFile(await fileFrom(owner, secondBundle), secondBundle, vault)).collection;
    }
    expect(() => assembleTransaction(bundle, vault, collection)).toThrow(expect.objectContaining({ code: 'NOT_AT_THRESHOLD' }));
  });
});
