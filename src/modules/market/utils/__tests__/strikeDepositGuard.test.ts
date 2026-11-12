import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { isStrikeQuoteExpired, verifyStrikeDepositTx } from '../strikeDepositGuard';

const net = Cardano.NetworkId.Mainnet;
const keyCred = (c: string) => ({ type: Cardano.CredentialType.KeyHash, hash: c.repeat(56) as Cardano.Credential['hash'] });
const OWN = Cardano.BaseAddress.fromCredentials(net, keyCred('a'), keyCred('b')).toAddress().toBech32();
const OWN_CHANGE = Cardano.BaseAddress.fromCredentials(net, keyCred('c'), keyCred('b')).toAddress().toBech32();
const ATTACKER = Cardano.BaseAddress.fromCredentials(net, keyCred('f'), keyCred('f')).toAddress().toBech32();
const DEPOSIT = Cardano.EnterpriseAddress.fromCredentials(net, {
  type: Cardano.CredentialType.ScriptHash, hash: 'be7544ca7d42c903268caecae465f3f8b5a7e7607d09165e471ac8b5' as Cardano.Credential['hash'],
}).toAddress().toBech32();
const TX = '9'.repeat(64);
const AMOUNT = 100_000_000n;
const own = { ownAddresses: [OWN, OWN_CHANGE], ownKeyHashes: ['a'.repeat(56), 'b'.repeat(56)] };
const expect100 = { depositAddress: DEPOSIT, assetSymbol: 'ADA', lovelace: AMOUNT.toString(), ...own };

const out = (address: string, coins: bigint, extra: Partial<Cardano.TxOut> = {}): Cardano.TxOut =>
  ({ address: address as Cardano.PaymentAddress, value: { coins }, ...extra });
function cbor(body: Partial<Cardano.TxBody>): string {
  const core = {
    id: TX,
    body: { inputs: [{ txId: TX, index: 0 }], outputs: [], fee: 200_000n, ...body },
    witness: { signatures: new Map() },
  } as unknown as Cardano.Tx;
  return Serialization.Transaction.fromCore(core).toCbor();
}
const DATUM = { datum: 42n as unknown as Cardano.PlutusData };

describe('Strike deposit transaction check', () => {
  it('accepts the quoted amount to the deposit script, with a datum, and change back to the wallet', () => {
    const tx = cbor({ outputs: [out(DEPOSIT, AMOUNT, DATUM), out(OWN_CHANGE, 9_899_800_000n)] });
    expect(verifyStrikeDepositTx(tx, expect100)).toEqual([]);
  });

  it('refuses the quoted deposit plus the rest of the wallet to someone else', () => {
    const tx = cbor({ outputs: [out(DEPOSIT, AMOUNT), out(ATTACKER, 9_900_000_000n)], fee: 0n });
    expect(verifyStrikeDepositTx(tx, expect100)).toContain('foreignOutput');
  });

  it('refuses a deposit output larger or smaller than the quote', () => {
    const more = cbor({ outputs: [out(DEPOSIT, AMOUNT + 1n), out(OWN, 9_000_000_000n)] });
    expect(verifyStrikeDepositTx(more, expect100)).toContain('missingOutput');
    const less = cbor({ outputs: [out(DEPOSIT, AMOUNT - 1n), out(OWN, 9_000_000_000n)] });
    expect(verifyStrikeDepositTx(less, expect100)).toContain('missingOutput');
  });

  it('refuses a second output to the deposit script', () => {
    const tx = cbor({ outputs: [out(DEPOSIT, AMOUNT), out(DEPOSIT, AMOUNT), out(OWN, 9_000_000_000n)] });
    expect(verifyStrikeDepositTx(tx, expect100)).toContain('foreignOutput');
  });

  it('refuses a deposit output carrying tokens', () => {
    const assets = new Map([[`${'7'.repeat(56)}` as Cardano.AssetId, 5n]]);
    const tx = cbor({ outputs: [{ address: DEPOSIT as Cardano.PaymentAddress, value: { coins: AMOUNT, assets } }, out(OWN, 9_000_000_000n)] });
    expect(verifyStrikeDepositTx(tx, expect100)).toContain('missingOutput');
  });

  it('refuses a fee above the cap', () => {
    const tx = cbor({ outputs: [out(DEPOSIT, AMOUNT), out(OWN, 9_000_000_000n)], fee: 5_000_001n });
    expect(verifyStrikeDepositTx(tx, expect100)).toContain('feeTooHigh');
  });

  it('refuses certificates, withdrawals, minting, collateral and foreign required signers', () => {
    const base = { outputs: [out(DEPOSIT, AMOUNT), out(OWN, 9_000_000_000n)] };
    const cert = { __typename: Cardano.CertificateType.StakeDeregistration, stakeCredential: keyCred('b') };
    expect(verifyStrikeDepositTx(cbor({ ...base, certificates: [cert as Cardano.Certificate] }), expect100))
      .toContain('unexpectedCertificate');
    const reward = Cardano.RewardAddress.fromCredentials(net, keyCred('b')).toAddress().toBech32();
    expect(verifyStrikeDepositTx(cbor({ ...base, withdrawals: [{ stakeAddress: reward as Cardano.RewardAccount, quantity: 5n }] }), expect100))
      .toContain('unexpectedWithdrawal');
    expect(verifyStrikeDepositTx(cbor({ ...base, mint: new Map([[`${'7'.repeat(56)}` as Cardano.AssetId, 1n]]) }), expect100))
      .toContain('unexpectedMint');
    expect(verifyStrikeDepositTx(cbor({ ...base, collaterals: [{ txId: TX as Cardano.TransactionId, index: 1 }] }), expect100))
      .toContain('unexpectedCollateral');
    expect(verifyStrikeDepositTx(cbor({ ...base, requiredExtraSignatures: ['e'.repeat(56)] as Cardano.TxBody['requiredExtraSignatures'] }), expect100))
      .toContain('unexpectedRequiredSigner');
  });

  it('refuses a deposit address that is a key address, or a missing one', () => {
    const tx = cbor({ outputs: [out(ATTACKER, AMOUNT), out(OWN, 9_000_000_000n)] });
    expect(verifyStrikeDepositTx(tx, { ...expect100, depositAddress: ATTACKER })).toEqual(['depositNotScript']);
    expect(verifyStrikeDepositTx(tx, { ...expect100, depositAddress: undefined })).toEqual(['depositNotScript']);
  });

  it.each([undefined, '', '0', '-5', '1.5', '1e8', ' 100'])('refuses quoted amount %j', (lovelace) => {
    const tx = cbor({ outputs: [out(DEPOSIT, AMOUNT), out(OWN, 9_000_000_000n)] });
    expect(verifyStrikeDepositTx(tx, { ...expect100, lovelace })).toEqual(['invalidAmount']);
  });

  it.each([undefined, '', 'USDM', 'BTC'])('refuses a quote in %j, whose amount is not lovelace', (assetSymbol) => {
    const tx = cbor({ outputs: [out(DEPOSIT, AMOUNT), out(OWN, 9_000_000_000n)] });
    expect(verifyStrikeDepositTx(tx, { ...expect100, assetSymbol })).toEqual(['invalidAmount']);
  });

  it('refuses CBOR it cannot decode', () => {
    expect(verifyStrikeDepositTx('deadbeef', expect100)).toEqual(['undecodable']);
  });
});

describe('Strike quote expiry', () => {
  const now = 1_800_000_000_000;
  it('reads seconds and milliseconds', () => {
    expect(isStrikeQuoteExpired(1_800_000_060, now)).toBe(false);
    expect(isStrikeQuoteExpired(1_799_999_999, now)).toBe(true);
    expect(isStrikeQuoteExpired(1_800_000_060_000, now)).toBe(false);
    expect(isStrikeQuoteExpired(1_799_999_999_000, now)).toBe(true);
  });

  it('treats an absent expiry as not expired and an unreadable one as expired', () => {
    expect(isStrikeQuoteExpired(undefined, now)).toBe(false);
    expect(isStrikeQuoteExpired(null, now)).toBe(false);
    expect(isStrikeQuoteExpired(Number.NaN, now)).toBe(true);
    expect(isStrikeQuoteExpired('soon' as unknown as number, now)).toBe(true);
  });
});
