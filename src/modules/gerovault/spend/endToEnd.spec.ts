// A 2-of-3 vault spend from proposal to submission, across three wallets whose keys are generated
// here: the proposer builds and signs, a cosigner reads the bundle file on its own device, checks
// it, signs and hands back a witness file, and the proposer assembles and submits at threshold.
import { describe, expect, it } from 'vitest';
import { Serialization } from '@cardano-sdk/core';
import { Ed25519PublicKey, Ed25519Signature, ready } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { buildVaultSpend } from './buildSpend';
import { checkBundleForVault, createUnsignedBundle, parseUnsignedBundle, signingFileText } from './bundle';
import { reviewBundle } from './review';
import { signWithRootKey } from './signer';
import { spendContextOf } from './vaultSpendContext';
import {
  addSignature,
  assembleTransaction,
  createWitnessFile,
  emptyCollection,
  parseWitnessFile,
  signingProgress,
  verifyOwnWitness,
  verifyWitnessFile,
  witnessKeyHashes,
} from './witnesses';
import { TEST_PARAMS, fundingTransaction, lovelaceOutput, payeeAddress, seededRandom, testOwner, testReader, testVaultRecord } from './__fixtures__/testVault';

const TIP = 80_000_000;

describe('GeroVault 2-of-3 spend, end to end', () => {
  it('proposes, collects one cosigner signature by file, assembles at threshold and submits', async () => {
    const owners = [await testOwner(1), await testOwner(3), await testOwner(2)];
    const records = await Promise.all(owners.map((_, i) => testVaultRecord(owners, 2, i, { name: 'Ops' })));
    const [alice, bob, carol] = await Promise.all(records.map(spendContextOf));
    expect(alice.vaultId).toBe(bob.vaultId);
    expect(alice.baseAddress).toBe(carol.baseAddress);

    const funding = fundingTransaction([
      lovelaceOutput(alice.baseAddress, 40_000_000n),
      lovelaceOutput(alice.baseAddress, 25_000_000n),
      lovelaceOutput(payeeAddress('b2'), 9_000_000n),
    ]);
    const { reader, submitted } = testReader([funding]);
    const payee = payeeAddress();

    // Alice proposes 30 ADA to the payee and signs her part.
    const built = await buildVaultSpend({
      context: alice,
      utxos: await reader.utxos(alice.baseAddress),
      recipients: [{ address: payee, lovelace: 30_000_000n }],
      protocolParameters: TEST_PARAMS,
      currentSlot: TIP,
      random: seededRandom(7),
    });
    const bundle = await createUnsignedBundle(alice, built, reader.txCbor, 1_700_000_000_000);
    const aliceReview = await reviewBundle(bundle, alice, { currentSlot: TIP });
    expect(aliceReview.status).toBe('ready');
    const aliceWitness = await signWithRootKey(owners[0].rootKey, alice.ownIndex, alice.self.credential, bundle.txId);
    let collection = addSignature(emptyCollection(bundle), await verifyOwnWitness(aliceWitness, bundle, alice)).collection;
    expect(signingProgress(collection, alice)).toMatchObject({ collected: 1, threshold: 2, complete: false });
    expect(() => assembleTransaction(bundle, alice, collection)).toThrow(expect.objectContaining({ code: 'NOT_AT_THRESHOLD' }));

    // Bob reads the file on his device, with no chain access: the inputs are proven from the bundle.
    const received = parseUnsignedBundle(signingFileText(bundle));
    checkBundleForVault(received, bob);
    const bobReview = await reviewBundle(received, bob, { currentSlot: TIP + 60 });
    if (bobReview.status !== 'ready') throw new Error(JSON.stringify(bobReview.refusals));
    expect(bobReview.inputCount).toBe(built.inputs.length);
    const external = bobReview.outputs.filter(o => o.kind === 'external');
    expect(external).toHaveLength(1);
    expect(external[0].address).toBe(payee);
    expect(external[0].value.lovelace).toBe(30_000_000n);
    expect(bobReview.leaves.lovelace).toBe(30_000_000n + bobReview.fee);
    const spent = bobReview.summary.inputs.reduce((sum, i) => sum + i.output.value.lovelace, 0n);
    expect(bobReview.change.lovelace + bobReview.leaves.lovelace).toBe(spent);
    const bobWitness = await signWithRootKey(owners[1].rootKey, bob.ownIndex, bob.self.credential, received.txId);
    const witnessText = signingFileText(createWitnessFile(received, bob.self, [bobWitness], 1_700_000_001_000));

    // Alice imports Bob's file, reaches 2 of 2 needed, assembles and submits through the reader.
    const verified = await verifyWitnessFile(parseWitnessFile(witnessText), bundle, alice);
    expect(verified.signer.credential).toBe(owners[1].credential);
    collection = addSignature(collection, verified).collection;
    const progress = signingProgress(collection, alice);
    expect(progress).toMatchObject({ collected: 2, threshold: 2, complete: true });
    expect(progress.owners.filter(o => o.signed).map(o => o.participant.credential).sort()).toEqual([owners[0].credential, owners[1].credential].sort());

    const txCbor = assembleTransaction(bundle, alice, collection);
    const txId = await reader.submit(txCbor);
    expect(txId).toBe(bundle.txId);
    expect(submitted).toEqual([txCbor]);

    // What was submitted: the signed body byte for byte, two owner witnesses that verify, the payment script only.
    const tx = Serialization.Transaction.fromCbor(txCbor as Serialization.TxCBOR);
    expect(tx.body().toCbor()).toBe(bundle.bodyCbor);
    expect((await witnessKeyHashes(txCbor)).sort()).toEqual([owners[0].credential, owners[1].credential].sort());
    const scripts = tx.witnessSet().nativeScripts()?.toCore() ?? [];
    expect(scripts.map(s => Serialization.NativeScript.fromCore(s).hash())).toEqual([alice.paymentScriptHash]);
    await ready();
    for (const [vkey, signature] of tx.witnessSet().vkeys()!.toCore()) {
      expect(Ed25519PublicKey.fromHex(vkey).verify(Ed25519Signature.fromHex(signature), HexBlob(bundle.txId))).toBe(true);
    }
    // The fee covers the transaction as submitted, at the size it actually has.
    const minimum = BigInt(Math.ceil((txCbor.length / 2) * TEST_PARAMS.minFeeCoefficient + TEST_PARAMS.minFeeConstant));
    expect(tx.body().fee()).toBeGreaterThanOrEqual(minimum);
  });

  it('lets any two of the three owners complete it: Bob and Carol without Alice', async () => {
    const owners = [await testOwner(4), await testOwner(1), await testOwner(9)];
    const [alice, bob, carol] = await Promise.all(owners.map((_, i) => testVaultRecord(owners, 2, i)).map(async r => spendContextOf(await r)));
    const funding = fundingTransaction([lovelaceOutput(alice.baseAddress, 50_000_000n)]);
    const { reader } = testReader([funding]);
    const built = await buildVaultSpend({
      context: alice,
      utxos: await reader.utxos(alice.baseAddress),
      recipients: [{ address: payeeAddress(), lovelace: 5_000_000n }],
      protocolParameters: TEST_PARAMS,
      currentSlot: TIP,
    });
    const bundle = parseUnsignedBundle(signingFileText(await createUnsignedBundle(alice, built, reader.txCbor)));
    const files = await Promise.all([[bob, owners[1]], [carol, owners[2]]].map(async ([context, owner]) => {
      const ctx = context as typeof bob;
      const witness = await signWithRootKey((owner as typeof owners[0]).rootKey, ctx.ownIndex, ctx.self.credential, bundle.txId);
      return parseWitnessFile(signingFileText(createWitnessFile(bundle, ctx.self, [witness])));
    }));
    let collection = emptyCollection(bundle);
    for (const file of files) collection = addSignature(collection, await verifyWitnessFile(file, bundle, alice)).collection;
    const txCbor = assembleTransaction(bundle, alice, collection);
    expect((await witnessKeyHashes(txCbor)).sort()).toEqual([owners[1].credential, owners[2].credential].sort());
  });
});
