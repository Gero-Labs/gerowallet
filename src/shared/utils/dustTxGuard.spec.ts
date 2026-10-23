import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { DUST_MAPPING_VALIDATOR } from './dustMappingValidator';
import { verifyDustMappingTx, type DustTxExpectation } from './dustTxGuard';

const NETWORK = 'Preprod';
const VALIDATOR = DUST_MAPPING_VALIDATOR[NETWORK].address;
const net = Cardano.NetworkId.Testnet;
const keyCred = (c: string) => ({ type: Cardano.CredentialType.KeyHash, hash: c.repeat(56) as Cardano.Credential['hash'] });
const base = (pay: string, stake: string) =>
  Cardano.BaseAddress.fromCredentials(net, keyCred(pay), keyCred(stake)).toAddress().toBech32();
const OWN = base('a', 'b');
const ATTACKER = base('f', 'f');
const PAYMENT_HASH = 'a'.repeat(56);
const STAKE_HASH = 'b'.repeat(56);
const DUST = '01' + 'c'.repeat(64);
const ATTACKER_DUST = '01' + 'e'.repeat(64);
const NFT = `${'7'.repeat(56)}6d6170` as Cardano.AssetId;
const TX = '9'.repeat(64);
const REG_REF = `${'8'.repeat(64)}#0`;

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const datumFor = (dustHex: string, stakeHash = STAKE_HASH): Cardano.PlutusData => ({
  constructor: 0n,
  fields: { items: [{ constructor: 0n, fields: { items: [bytes(stakeHash)] } }, bytes(dustHex)] },
});
const out = (address: string, coins: bigint, extra: Partial<Cardano.TxOut> = {}): Cardano.TxOut =>
  ({ address: address as Cardano.PaymentAddress, value: { coins }, ...extra });
const mappingOut = (dustHex = DUST, coins = 1_500_000n, assets = new Map([[NFT, 1n]])) =>
  out(VALIDATOR, coins, { value: { coins, assets }, datum: datumFor(dustHex) });

function tx(body: Partial<Cardano.TxBody>): Cardano.Tx {
  return {
    id: TX,
    body: { inputs: [{ txId: TX, index: 0 }], outputs: [], fee: 300_000n, ...body },
    witness: { signatures: new Map() },
  } as unknown as Cardano.Tx;
}

const register: DustTxExpectation = { kind: 'register', network: NETWORK, cardanoAddress: OWN, dustAddressHex: DUST };
const registerBody: Partial<Cardano.TxBody> = {
  outputs: [mappingOut(), out(OWN, 97_000_000n)],
  mint: new Map([[NFT, 1n]]),
  requiredExtraSignatures: [PAYMENT_HASH, STAKE_HASH] as unknown as Cardano.TxBody['requiredExtraSignatures'],
  collaterals: [{ txId: TX as Cardano.TransactionId, index: 1 }],
  collateralReturn: out(OWN, 4_500_000n),
  totalCollateral: 500_000n,
};

describe('DUST mapping-validator transaction check', () => {
  it('accepts a registration that is exactly what was asked for', () => {
    expect(verifyDustMappingTx(tx(registerBody), register)).toEqual([]);
  });

  it('refuses an extra output to someone else', () => {
    const t = tx({ ...registerBody, outputs: [mappingOut(), out(ATTACKER, 90_000_000n), out(OWN, 7_000_000n)] });
    expect(verifyDustMappingTx(t, register)).toContain('foreignOutput');
  });

  it('refuses a mapping datum that points at another DUST address', () => {
    const t = tx({ ...registerBody, outputs: [mappingOut(ATTACKER_DUST), out(OWN, 97_000_000n)] });
    expect(verifyDustMappingTx(t, register)).toContain('missingOutput');
  });

  it('refuses a datum that names the chosen address next to another one', () => {
    const sneaky: Cardano.PlutusData = { items: [datumFor(DUST), bytes(ATTACKER_DUST)] };
    const t = tx({ ...registerBody, outputs: [out(VALIDATOR, 1_500_000n, { value: { coins: 1_500_000n, assets: new Map([[NFT, 1n]]) }, datum: sneaky }), out(OWN, 97_000_000n)] });
    expect(verifyDustMappingTx(t, register)).toContain('missingOutput');
  });

  it('refuses an inflated validator output', () => {
    const t = tx({ ...registerBody, outputs: [mappingOut(DUST, 50_000_000n), out(OWN, 48_000_000n)] });
    expect(verifyDustMappingTx(t, register)).toContain('missingOutput');
  });

  it('refuses a validator output that is not the reviewed one', () => {
    const t = tx({ ...registerBody, outputs: [{ ...mappingOut(), address: ATTACKER as Cardano.PaymentAddress }, out(OWN, 97_000_000n)] });
    expect(verifyDustMappingTx(t, register)).toEqual(expect.arrayContaining(['missingOutput', 'foreignOutput']));
  });

  it('refuses minting anything beyond the one mapping NFT', () => {
    const other = `${'6'.repeat(56)}` as Cardano.AssetId;
    const t = tx({ ...registerBody, mint: new Map([[NFT, 1n], [other, 1000n]]) });
    expect(verifyDustMappingTx(t, register)).toContain('unexpectedMint');
  });

  it('refuses collateral returned to someone else, or without a stated bounded total', () => {
    expect(verifyDustMappingTx(tx({ ...registerBody, collateralReturn: out(ATTACKER, 4_500_000n) }), register)).toContain('unexpectedCollateral');
    expect(verifyDustMappingTx(tx({ ...registerBody, totalCollateral: undefined }), register)).toContain('unexpectedCollateral');
    expect(verifyDustMappingTx(tx({ ...registerBody, totalCollateral: 50_000_000n }), register)).toContain('unexpectedCollateral');
  });

  it('lets a lent collateral return to its lender only when the wallet can tell it is not its own', () => {
    const lent = `${TX}#1`;
    const t = tx({ ...registerBody, collateralReturn: out(ATTACKER, 4_500_000n), totalCollateral: undefined });
    expect(verifyDustMappingTx(t, { ...register, sponsoredCollateralRef: lent, ownUtxoRefs: [`${TX}#0`] })).toEqual([]);
    // The wallet holds that UTxO: it is the user's own, whatever Nexus calls it.
    expect(verifyDustMappingTx(t, { ...register, sponsoredCollateralRef: lent, ownUtxoRefs: [lent] })).toContain('unexpectedCollateral');
    // No UTxO list: treated as the user's own.
    expect(verifyDustMappingTx(t, { ...register, sponsoredCollateralRef: lent })).toContain('unexpectedCollateral');
  });

  it('refuses certificates, foreign required signers, and a non-zero withdrawal', () => {
    const cert = { __typename: Cardano.CertificateType.StakeDeregistration, stakeCredential: keyCred('b') } as Cardano.Certificate;
    expect(verifyDustMappingTx(tx({ ...registerBody, certificates: [cert] }), register)).toContain('unexpectedCertificate');
    expect(verifyDustMappingTx(tx({ ...registerBody, requiredExtraSignatures: ['d'.repeat(56)] as unknown as Cardano.TxBody['requiredExtraSignatures'] }), register))
      .toContain('unexpectedRequiredSigner');
    const reward = Cardano.RewardAddress.fromCredentials(net, keyCred('b')).toAddress().toBech32() as Cardano.RewardAccount;
    expect(verifyDustMappingTx(tx({ ...registerBody, withdrawals: [{ stakeAddress: reward, quantity: 5_000_000n }] }), register))
      .toContain('unexpectedWithdrawal');
    expect(verifyDustMappingTx(tx({ ...registerBody, withdrawals: [{ stakeAddress: reward, quantity: 0n }] }), register)).toEqual([]);
  });

  it('refuses a fee above the cap', () => {
    expect(verifyDustMappingTx(tx({ ...registerBody, fee: 9_000_000n }), register)).toContain('feeTooHigh');
  });

  it('checks deregistration: spends the registration, burns one NFT, everything else comes back', () => {
    const exp: DustTxExpectation = { kind: 'deregister', network: NETWORK, cardanoAddress: OWN, registrationRef: REG_REF };
    const [regTx, regIdx] = REG_REF.split('#');
    const good: Partial<Cardano.TxBody> = {
      inputs: [{ txId: TX as Cardano.TransactionId, index: 0 }, { txId: regTx as Cardano.TransactionId, index: Number(regIdx) }],
      outputs: [out(OWN, 99_000_000n)],
      mint: new Map([[NFT, -1n]]),
      requiredExtraSignatures: [PAYMENT_HASH, STAKE_HASH] as unknown as Cardano.TxBody['requiredExtraSignatures'],
    };
    expect(verifyDustMappingTx(tx(good), exp)).toEqual([]);
    expect(verifyDustMappingTx(tx({ ...good, outputs: [out(ATTACKER, 99_000_000n)] }), exp)).toContain('foreignOutput');
    expect(verifyDustMappingTx(tx({ ...good, inputs: [{ txId: TX as Cardano.TransactionId, index: 0 }] }), exp)).toContain('missingInput');
  });

  it('checks an update: the moved NFT must name the chosen DUST address', () => {
    const exp: DustTxExpectation = { kind: 'update', network: NETWORK, cardanoAddress: OWN, dustAddressHex: DUST, registrationRef: REG_REF };
    const [regTx, regIdx] = REG_REF.split('#');
    const good: Partial<Cardano.TxBody> = {
      inputs: [{ txId: TX as Cardano.TransactionId, index: 0 }, { txId: regTx as Cardano.TransactionId, index: Number(regIdx) }],
      outputs: [mappingOut(), out(OWN, 97_000_000n)],
    };
    expect(verifyDustMappingTx(tx(good), exp)).toEqual([]);
    expect(verifyDustMappingTx(tx({ ...good, outputs: [mappingOut(ATTACKER_DUST), out(OWN, 97_000_000n)] }), exp)).toContain('missingOutput');
    expect(verifyDustMappingTx(tx({ ...good, mint: new Map([[NFT, 1n]]) }), exp)).toContain('unexpectedMint');
  });

  it('refuses what it cannot check (unknown network, address without a stake key)', () => {
    expect(verifyDustMappingTx(tx(registerBody), { ...register, network: 'Nowhere' })).toEqual(['unsupported']);
    const enterprise = Cardano.EnterpriseAddress.fromCredentials(net, keyCred('a')).toAddress().toBech32();
    expect(verifyDustMappingTx(tx(registerBody), { ...register, cardanoAddress: enterprise })).toEqual(['unsupported']);
  });
});
