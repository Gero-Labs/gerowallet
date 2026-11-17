import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { isStrikeQuoteExpired, STRIKE_DEPOSIT_MAX_EXTRA_LOVELACE, verifyStrikeDepositTx } from '../strikeDepositGuard';

const net = Cardano.NetworkId.Mainnet;
const keyCred = (c: string) => ({ type: Cardano.CredentialType.KeyHash, hash: c.repeat(56) as Cardano.Credential['hash'] });
const OWN = Cardano.BaseAddress.fromCredentials(net, keyCred('a'), keyCred('b')).toAddress().toBech32();
const OWN_CHANGE = Cardano.BaseAddress.fromCredentials(net, keyCred('c'), keyCred('b')).toAddress().toBech32();
// For ADA, Strike's build pays an exchanger address it creates per deposit: any address.
const EXCHANGER = Cardano.EnterpriseAddress.fromCredentials(net, keyCred('e')).toAddress().toBech32();
const ATTACKER = Cardano.BaseAddress.fromCredentials(net, keyCred('f'), keyCred('f')).toAddress().toBech32();
const FUND = '1'.repeat(64);
const OTHER = '2'.repeat(64);
const TOKEN = `${'7'.repeat(56)}` as Cardano.AssetId;
const WALLET = 10_000_000_000n;
const AMOUNT = 100_000_000n;
const FEE = 200_000n;

const out = (address: string, coins: bigint, assets?: Map<Cardano.AssetId, bigint>): Cardano.TxOut =>
  ({ address: address as Cardano.PaymentAddress, value: assets ? { coins, assets } : { coins } });
const utxo = (txId: string, txOut: Cardano.TxOut): Cardano.Utxo =>
  [{ txId: txId as Cardano.TransactionId, index: 0, address: txOut.address }, txOut];

function tx(body: Partial<Cardano.TxBody>): Cardano.Tx {
  const core = {
    id: '9'.repeat(64),
    body: { inputs: [{ txId: FUND, index: 0 }], outputs: [], fee: FEE, ...body },
    witness: { signatures: new Map() },
  } as unknown as Cardano.Tx;
  return Serialization.Transaction.fromCore(core).toCore();
}

const own = {
  ownAddresses: [OWN, OWN_CHANGE],
  ownUtxos: [utxo(FUND, out(OWN, WALLET))],
  ownKeyHashes: ['a'.repeat(56), 'c'.repeat(56), 'b'.repeat(56)],
};
const quote = { assetSymbol: 'ADA', lovelace: AMOUNT.toString(), ...own };
const change = (sent: bigint) => out(OWN_CHANGE, WALLET - sent - FEE);

describe('Strike deposit transaction check', () => {
  it('accepts the quoted amount to an exchanger address, with change back to the wallet', () => {
    expect(verifyStrikeDepositTx(tx({ outputs: [out(EXCHANGER, AMOUNT), change(AMOUNT)] }), quote)).toEqual([]);
  });

  it('accepts the quoted amount at the quote\'s vault script too', () => {
    const vault = Cardano.EnterpriseAddress.fromCredentials(net, {
      type: Cardano.CredentialType.ScriptHash, hash: 'be7544ca7d42c903268caecae465f3f8b5a7e7607d09165e471ac8b5' as Cardano.Credential['hash'],
    }).toAddress().toBech32();
    expect(verifyStrikeDepositTx(tx({ outputs: [out(vault, AMOUNT), change(AMOUNT)] }), quote)).toEqual([]);
  });

  it('accepts up to the extra allowance over the quote, and refuses one lovelace more', () => {
    const most = AMOUNT + STRIKE_DEPOSIT_MAX_EXTRA_LOVELACE;
    expect(verifyStrikeDepositTx(tx({ outputs: [out(EXCHANGER, most), change(most)] }), quote)).toEqual([]);
    expect(verifyStrikeDepositTx(tx({ outputs: [out(EXCHANGER, most + 1n), change(most + 1n)] }), quote))
      .toContain('spendExceeded');
  });

  it('refuses the quoted deposit plus the rest of the wallet to someone else', () => {
    const body = { outputs: [out(EXCHANGER, AMOUNT), out(ATTACKER, WALLET - AMOUNT)], fee: 0n };
    expect(verifyStrikeDepositTx(tx(body), quote)).toContain('spendExceeded');
  });

  it('refuses an amount split over several outputs that adds up past the quote', () => {
    const body = { outputs: [out(EXCHANGER, AMOUNT), out(ATTACKER, 50_000_000n), change(AMOUNT + 50_000_000n)] };
    expect(verifyStrikeDepositTx(tx(body), quote)).toContain('spendExceeded');
  });

  it('refuses tokens leaving the wallet', () => {
    const withTokens = { ...own, ownUtxos: [utxo(FUND, out(OWN, WALLET, new Map([[TOKEN, 5n]])))] };
    const kept = tx({ outputs: [out(EXCHANGER, AMOUNT), out(OWN_CHANGE, WALLET - AMOUNT - FEE, new Map([[TOKEN, 5n]]))] });
    expect(verifyStrikeDepositTx(kept, { ...quote, ...withTokens })).toEqual([]);
    const taken = tx({ outputs: [out(EXCHANGER, AMOUNT, new Map([[TOKEN, 5n]])), change(AMOUNT)] });
    expect(verifyStrikeDepositTx(taken, { ...quote, ...withTokens })).toContain('spendExceeded');
  });

  it('refuses an input the wallet cannot value', () => {
    const body = { inputs: [{ txId: FUND, index: 0 }, { txId: OTHER, index: 0 }], outputs: [out(EXCHANGER, AMOUNT), change(AMOUNT)] };
    expect(verifyStrikeDepositTx(tx(body as Partial<Cardano.TxBody>), quote)).toContain('unknownInput');
  });

  it('refuses a fee above the cap', () => {
    const fee = 5_000_001n;
    const body = { outputs: [out(EXCHANGER, AMOUNT), out(OWN_CHANGE, WALLET - AMOUNT - fee)], fee };
    expect(verifyStrikeDepositTx(tx(body), quote)).toContain('feeTooHigh');
  });

  it('refuses certificates, withdrawals, minting and collateral', () => {
    const base = { outputs: [out(EXCHANGER, AMOUNT), change(AMOUNT)] };
    const cert = { __typename: Cardano.CertificateType.StakeDeregistration, stakeCredential: keyCred('b') };
    expect(verifyStrikeDepositTx(tx({ ...base, certificates: [cert as Cardano.Certificate] }), quote)).toContain('unexpectedCertificate');
    const reward = Cardano.RewardAddress.fromCredentials(net, keyCred('b')).toAddress().toBech32();
    expect(verifyStrikeDepositTx(tx({ ...base, withdrawals: [{ stakeAddress: reward as Cardano.RewardAccount, quantity: 5n }] }), quote))
      .toContain('unexpectedWithdrawal');
    expect(verifyStrikeDepositTx(tx({ ...base, mint: new Map([[TOKEN, 1n]]) }), quote)).toContain('unexpectedMint');
    expect(verifyStrikeDepositTx(tx({ ...base, collaterals: [{ txId: FUND as Cardano.TransactionId, index: 0 }] }), quote))
      .toContain('unexpectedCollateral');
  });

  it('accepts the wallet\'s own keys as required signers and refuses any other', () => {
    const base = { outputs: [out(EXCHANGER, AMOUNT), change(AMOUNT)] };
    const signers = (h: string) => [h] as Cardano.TxBody['requiredExtraSignatures'];
    expect(verifyStrikeDepositTx(tx({ ...base, requiredExtraSignatures: signers('c'.repeat(56)) }), quote)).toEqual([]);
    expect(verifyStrikeDepositTx(tx({ ...base, requiredExtraSignatures: signers('e'.repeat(56)) }), quote))
      .toContain('unexpectedRequiredSigner');
  });

  it.each([undefined, '', '0', '-5', '1.5', '1e8', ' 100'])('refuses quoted amount %j', (lovelace) => {
    expect(verifyStrikeDepositTx(tx({ outputs: [out(EXCHANGER, AMOUNT), change(AMOUNT)] }), { ...quote, lovelace }))
      .toEqual(['invalidAmount']);
  });

  it.each([undefined, '', 'USDM', 'BTC'])('refuses a quote in %j, whose amount is not lovelace', (assetSymbol) => {
    expect(verifyStrikeDepositTx(tx({ outputs: [out(EXCHANGER, AMOUNT), change(AMOUNT)] }), { ...quote, assetSymbol }))
      .toEqual(['invalidAmount']);
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
