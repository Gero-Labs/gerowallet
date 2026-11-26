// Proposing a vault spend: the form's parsing, coin selection from the vault's own UTxOs, the
// body, change to the vault, and a fee sized for the transaction as it will be submitted.
import { beforeAll, describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { buildVaultSpend, parseAdaAmount, parseTokenQuantity, readRecipientAddress, utxoTotal, vaultUtxos } from './buildSpend';
import { NATIVE_FEE_MAX_LOVELACE } from './constants';
import { spendContextOf, type VaultSpendContext } from './vaultSpendContext';
import { TEST_PARAMS, fundingTransaction, lovelaceOutput, payeeAddress, seededRandom, testOwner, testVaultRecord, type TestOwner } from './__fixtures__/testVault';

const TIP = 50_000_000;
const POLICY = 'c1'.repeat(28);
const TOKEN = Cardano.AssetId(`${POLICY}474f4c44`);

let owners: TestOwner[];
let vault: VaultSpendContext;

beforeAll(async () => {
  owners = [await testOwner(1), await testOwner(1), await testOwner(1)];
  vault = await spendContextOf(await testVaultRecord(owners, 2, 0));
});

function bodyOf(bodyCbor: string): Cardano.TxBody {
  return Serialization.TransactionBody.fromCbor(HexBlob(bodyCbor)).toCore();
}

describe('the spend form', () => {
  it('reads ADA amounts to the lovelace', () => {
    expect(parseAdaAmount('12')).toBe(12_000_000n);
    expect(parseAdaAmount(' 0.5 ')).toBe(500_000n);
    expect(parseAdaAmount('1.000001')).toBe(1_000_001n);
    for (const bad of ['', '-1', '1.0000001', '1e6', '01', '1,5', 'abc', '.5']) {
      expect(() => parseAdaAmount(bad), bad).toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT' }));
    }
  });

  it('reads token quantities as positive whole numbers', () => {
    expect(parseTokenQuantity('500')).toBe(500n);
    for (const bad of ['0', '-3', '1.5', '', '18446744073709551616']) {
      expect(() => parseTokenQuantity(bad), bad).toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT' }));
    }
  });

  it('accepts base and enterprise addresses on the vault network only', () => {
    expect(readRecipientAddress(payeeAddress(), vault)).toBe(payeeAddress());
    expect(readRecipientAddress(vault.baseAddress, vault)).toBe(vault.baseAddress);
    const mainnet = Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Mainnet, {
      type: Cardano.CredentialType.KeyHash,
      hash: 'a1'.repeat(28) as unknown as Cardano.Credential['hash'],
    }).toAddress().toBech32();
    expect(() => readRecipientAddress(mainnet, vault)).toThrow(expect.objectContaining({ code: 'INVALID_RECIPIENT', detail: 'network_mismatch' }));
    const reward = Cardano.RewardAddress.fromCredentials(Cardano.NetworkId.Testnet, {
      type: Cardano.CredentialType.KeyHash,
      hash: 'a1'.repeat(28) as unknown as Cardano.Credential['hash'],
    }).toAddress().toBech32();
    expect(() => readRecipientAddress(reward, vault)).toThrow(expect.objectContaining({ code: 'INVALID_RECIPIENT', detail: 'address_invalid' }));
    expect(() => readRecipientAddress('addr_test1nope', vault)).toThrow(expect.objectContaining({ code: 'INVALID_RECIPIENT' }));
  });
});

describe('coin selection and the body', () => {
  it('spends only UTxOs at the vault address and sends change back to it, plain', async () => {
    const funding = fundingTransaction([
      lovelaceOutput(vault.baseAddress, 20_000_000n),
      lovelaceOutput(payeeAddress('b3'), 500_000_000n),
      lovelaceOutput(vault.baseAddress, 15_000_000n),
    ]);
    expect(vaultUtxos(funding.utxos, vault)).toHaveLength(2);
    expect(utxoTotal(vaultUtxos(funding.utxos, vault)).lovelace).toBe(35_000_000n);

    const built = await buildVaultSpend({
      context: vault,
      utxos: funding.utxos,
      recipients: [{ address: payeeAddress(), lovelace: 25_000_000n }],
      protocolParameters: TEST_PARAMS,
      currentSlot: TIP,
      random: seededRandom(3),
    });
    const body = bodyOf(built.bodyCbor);
    const spent = body.inputs.map(input => funding.utxos.find(([i]) => i.txId === input.txId && i.index === input.index)!);
    expect(spent.every(([, output]) => output.address === vault.baseAddress)).toBe(true);
    expect(body.outputs[0]).toMatchObject({ address: payeeAddress(), value: { coins: 25_000_000n } });
    const change = body.outputs.slice(1);
    expect(change.length).toBeGreaterThan(0);
    for (const output of change) {
      expect(output.address).toBe(vault.baseAddress);
      expect(output.datum ?? output.datumHash ?? output.scriptReference).toBeUndefined();
    }
    const inTotal = spent.reduce((sum, [, o]) => sum + o.value.coins, 0n);
    const outTotal = body.outputs.reduce((sum, o) => sum + o.value.coins, 0n);
    expect(inTotal).toBe(outTotal + body.fee);
    expect(body.fee).toBe(built.fee);
    expect(body.requiredExtraSignatures).toBeUndefined();
    expect(body.certificates ?? body.withdrawals ?? body.collaterals ?? body.referenceInputs).toBeUndefined();
    expect(Number(body.validityInterval?.invalidHereafter)).toBe(TIP + 48 * 3600);
    expect(built.invalidHereafter).toBe(TIP + 48 * 3600);
    expect(built.inputs).toEqual(body.inputs.map(({ txId, index }) => ({ txId, index })));
    expect(built.txId).toBe(Serialization.TransactionBody.fromCbor(HexBlob(built.bodyCbor)).hash());
  });

  it('sizes the fee for the threshold of witnesses and the payment script', async () => {
    const funding = fundingTransaction([lovelaceOutput(vault.baseAddress, 100_000_000n)]);
    const built = await buildVaultSpend({
      context: vault,
      utxos: funding.utxos,
      recipients: [{ address: payeeAddress(), lovelace: 10_000_000n }],
      protocolParameters: TEST_PARAMS,
      currentSlot: TIP,
    });
    // The transaction as submitted: body, two 32-byte keys with 64-byte signatures, the script.
    const signed = Serialization.Transaction.fromCore({
      id: Cardano.TransactionId(built.txId),
      body: bodyOf(built.bodyCbor),
      witness: {
        signatures: new Map([
          ['11'.repeat(32), 'aa'.repeat(64)],
          ['22'.repeat(32), 'bb'.repeat(64)],
        ] as never),
        scripts: [vault.paymentScript],
      },
    });
    const size = BigInt(signed.toCbor().length / 2);
    expect(built.fee).toBeGreaterThanOrEqual(size * 44n + 155_381n);
    expect(built.fee).toBeLessThan(size * 44n + 155_381n + 10_000n);
    expect(built.fee).toBeLessThanOrEqual(NATIVE_FEE_MAX_LOVELACE);
  });

  it('pays tokens with their minimum ADA, and returns the other tokens to the vault', async () => {
    const funding = fundingTransaction([
      lovelaceOutput(vault.baseAddress, 10_000_000n, new Map([[TOKEN, 700n]])),
      lovelaceOutput(vault.baseAddress, 5_000_000n),
    ]);
    const built = await buildVaultSpend({
      context: vault,
      utxos: funding.utxos,
      recipients: [{ address: payeeAddress(), lovelace: 0n, assets: new Map([[TOKEN, 200n]]) }],
      protocolParameters: TEST_PARAMS,
      currentSlot: TIP,
      random: seededRandom(5),
    });
    const body = bodyOf(built.bodyCbor);
    expect(body.outputs[0].value.assets?.get(TOKEN)).toBe(200n);
    expect(body.outputs[0].value.coins).toBeGreaterThan(1_000_000n);
    const changeTokens = body.outputs.slice(1).reduce((sum, o) => sum + (o.value.assets?.get(TOKEN) ?? 0n), 0n);
    expect(changeTokens).toBe(500n);
  });

  it('refuses what it cannot build', async () => {
    const funding = fundingTransaction([lovelaceOutput(vault.baseAddress, 3_000_000n)]);
    const base = { context: vault, utxos: funding.utxos, protocolParameters: TEST_PARAMS, currentSlot: TIP };
    await expect(buildVaultSpend({ ...base, recipients: [] })).rejects.toMatchObject({ code: 'NO_RECIPIENT' });
    await expect(buildVaultSpend({ ...base, recipients: [{ address: payeeAddress(), lovelace: 50_000_000n }] }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    await expect(buildVaultSpend({ ...base, recipients: [{ address: payeeAddress(), lovelace: 100n }] }))
      .rejects.toMatchObject({ code: 'BELOW_MIN_ADA' });
    await expect(buildVaultSpend({ ...base, utxos: [], recipients: [{ address: payeeAddress(), lovelace: 1_000_000n }] }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    await expect(buildVaultSpend({ ...base, validitySlots: 8 * 24 * 3600, recipients: [{ address: payeeAddress(), lovelace: 1_000_000n }] }))
      .rejects.toMatchObject({ code: 'PARAMS_UNAVAILABLE' });
    await expect(buildVaultSpend({ ...base, currentSlot: Number.NaN, recipients: [{ address: payeeAddress(), lovelace: 1_000_000n }] }))
      .rejects.toMatchObject({ code: 'PARAMS_UNAVAILABLE' });
  });

  it('refuses a fee above the native vault bound', async () => {
    const funding = fundingTransaction([lovelaceOutput(vault.baseAddress, 100_000_000n)]);
    await expect(buildVaultSpend({
      context: vault,
      utxos: funding.utxos,
      recipients: [{ address: payeeAddress(), lovelace: 10_000_000n }],
      protocolParameters: { ...TEST_PARAMS, minFeeConstant: 2_500_000 },
      currentSlot: TIP,
    })).rejects.toMatchObject({ code: 'FEE_TOO_HIGH' });
  });
});
