import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { verifyStrikeWithdrawTx } from '../strikeWithdrawGuard';

const net = Cardano.NetworkId.Mainnet;
const keyCred = (c: string) => ({ type: Cardano.CredentialType.KeyHash, hash: c.repeat(56) as Cardano.Credential['hash'] });
const OWN = Cardano.BaseAddress.fromCredentials(net, keyCred('a'), keyCred('b')).toAddress().toBech32();
const ATTACKER = Cardano.BaseAddress.fromCredentials(net, keyCred('f'), keyCred('f')).toAddress().toBech32();
const VALIDATOR = Cardano.EnterpriseAddress.fromCredentials(net, {
  type: Cardano.CredentialType.ScriptHash, hash: 'be7544ca7d42c903268caecae465f3f8b5a7e7607d09165e471ac8b5' as Cardano.Credential['hash'],
}).toAddress().toBech32();
const TX = '9'.repeat(64);
const own = { ownAddresses: [OWN], ownKeyHashes: ['a'.repeat(56), 'b'.repeat(56)] };

const out = (address: string, coins: bigint, assets?: Map<Cardano.AssetId, bigint>): Cardano.TxOut =>
  ({ address: address as Cardano.PaymentAddress, value: assets ? { coins, assets } : { coins } });
function cbor(body: Partial<Cardano.TxBody>): string {
  const core = {
    id: TX,
    body: { inputs: [{ txId: TX, index: 0 }], outputs: [], fee: 200_000n, ...body },
    witness: { signatures: new Map() },
  } as unknown as Cardano.Tx;
  return Serialization.Transaction.fromCore(core).toCbor();
}

describe('Strike withdraw quote transaction check', () => {
  it('accepts a min-UTxO funding of the quoted validator with change back to the wallet', () => {
    const tx = cbor({ outputs: [out(VALIDATOR, 1_700_000n), out(OWN, 98_100_000n)] });
    expect(verifyStrikeWithdrawTx(tx, { validatorAddress: VALIDATOR, ...own })).toEqual([]);
  });

  it('refuses an extra output to someone else', () => {
    const tx = cbor({ outputs: [out(VALIDATOR, 1_700_000n), out(ATTACKER, 90_000_000n), out(OWN, 8_100_000n)] });
    expect(verifyStrikeWithdrawTx(tx, { validatorAddress: VALIDATOR, ...own })).toContain('foreignOutput');
  });

  it('refuses an inflated validator output, or one carrying tokens', () => {
    const big = cbor({ outputs: [out(VALIDATOR, 60_000_000n), out(OWN, 39_800_000n)] });
    expect(verifyStrikeWithdrawTx(big, { validatorAddress: VALIDATOR, ...own })).toContain('missingOutput');
    const withTokens = cbor({ outputs: [out(VALIDATOR, 1_700_000n, new Map([[`${'7'.repeat(56)}` as Cardano.AssetId, 5n]])), out(OWN, 98_100_000n)] });
    expect(verifyStrikeWithdrawTx(withTokens, { validatorAddress: VALIDATOR, ...own })).toContain('missingOutput');
  });

  it('refuses a "validator" that is a key address, or a missing one', () => {
    const tx = cbor({ outputs: [out(ATTACKER, 1_700_000n), out(OWN, 98_100_000n)] });
    expect(verifyStrikeWithdrawTx(tx, { validatorAddress: ATTACKER, ...own })).toEqual(['validatorNotScript']);
    expect(verifyStrikeWithdrawTx(tx, { validatorAddress: undefined, ...own })).toEqual(['validatorNotScript']);
  });

  it('refuses certificates, withdrawals, minting and collateral', () => {
    const base = { outputs: [out(VALIDATOR, 1_700_000n), out(OWN, 98_100_000n)] };
    const cert = { __typename: Cardano.CertificateType.StakeDeregistration, stakeCredential: keyCred('b') };
    expect(verifyStrikeWithdrawTx(cbor({ ...base, certificates: [cert as Cardano.Certificate] }), { validatorAddress: VALIDATOR, ...own }))
      .toContain('unexpectedCertificate');
    expect(verifyStrikeWithdrawTx(cbor({ ...base, mint: new Map([[`${'7'.repeat(56)}` as Cardano.AssetId, 1n]]) }), { validatorAddress: VALIDATOR, ...own }))
      .toContain('unexpectedMint');
    expect(verifyStrikeWithdrawTx(cbor({ ...base, collaterals: [{ txId: TX as Cardano.TransactionId, index: 1 }] }), { validatorAddress: VALIDATOR, ...own }))
      .toContain('unexpectedCollateral');
  });

  it('refuses CBOR it cannot decode', () => {
    expect(verifyStrikeWithdrawTx('deadbeef', { validatorAddress: VALIDATOR, ...own })).toEqual(['undecodable']);
  });
});
