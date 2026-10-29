import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { minAdaRequired } from '@cardano-sdk/tx-construction';
import {
  drepRegistrationMatches,
  DEFAULT_COINS_PER_UTXO_BYTE,
  matchIntendedOutputs,
  MAX_BUILT_TX_FEE_LOVELACE,
  parseDRepTarget,
  stakeCertificatesMatch,
  stakeCredentialOf,
  verifySpendBound,
  verifyTxIntent,
  type IntendedOutput,
  type TxIntent,
} from './txIntentGuard';

const net = Cardano.NetworkId.Testnet;
const keyCred = (c: string) => ({ type: Cardano.CredentialType.KeyHash, hash: c.repeat(56) as Cardano.Credential['hash'] });
const base = (pay: string, stake: string) =>
  Cardano.BaseAddress.fromCredentials(net, keyCred(pay), keyCred(stake)).toAddress().toBech32();
const reward = (stake: string) => Cardano.RewardAddress.fromCredentials(net, keyCred(stake)).toAddress().toBech32();

const OWN = base('a', 'b');
const OWN_CHANGE = base('c', 'b');
const RECIPIENT = base('d', 'e');
const ATTACKER = base('f', 'f');
const OWN_REWARD = reward('b');
const TOKEN = `${'1'.repeat(56)}474552`;
const TX = '9'.repeat(64);
const POOL = Cardano.PoolId.fromKeyHash('2'.repeat(56) as never);
const OTHER_POOL = Cardano.PoolId.fromKeyHash('3'.repeat(56) as never);

const out = (address: string, coins: bigint, assets?: [string, bigint][]) =>
  ({ address, value: { coins, ...(assets ? { assets: new Map(assets) } : {}) } });
const tx = (body: Record<string, unknown>, witness: Record<string, unknown> = {}) =>
  ({ id: TX, body: { inputs: [{ txId: TX, index: 0 }], outputs: [], fee: 200_000n, ...body }, witness }) as unknown as Cardano.Tx;

const send = (lovelace: bigint | 'max' = 5_000_000n, assets: [string, bigint][] = []): IntendedOutput =>
  ({ address: RECIPIENT, lovelace, assets: new Map(assets) });
const intent = (over: Partial<TxIntent> = {}): TxIntent => ({
  outputs: [send()],
  ownAddresses: [OWN_CHANGE, OWN],
  allowedInputs: [`${TX}#0`],
  ...over,
});

describe('verifyTxIntent', () => {
  it('accepts exactly the requested payment with change back to the wallet', () => {
    expect(verifyTxIntent(tx({ outputs: [out(RECIPIENT, 5_000_000n), out(OWN_CHANGE, 94_800_000n)] }), intent())).toEqual([]);
  });

  it('refuses an extra output to someone else', () => {
    const t = tx({ outputs: [out(RECIPIENT, 5_000_000n), out(ATTACKER, 90_000_000n), out(OWN_CHANGE, 4_800_000n)] });
    expect(verifyTxIntent(t, intent())).toEqual(['foreignOutput']);
  });

  it('refuses a swapped recipient or a changed amount', () => {
    expect(verifyTxIntent(tx({ outputs: [out(ATTACKER, 5_000_000n), out(OWN_CHANGE, 1n)] }), intent()))
      .toEqual(expect.arrayContaining(['missingOutput', 'foreignOutput']));
    expect(verifyTxIntent(tx({ outputs: [out(RECIPIENT, 50_000_000n), out(OWN_CHANGE, 1n)] }), intent()))
      .toEqual(expect.arrayContaining(['missingOutput']));
  });

  it('lets a token output gain only the min-UTxO top-up, and never extra tokens', () => {
    const want = intent({ outputs: [send(1_000_000n, [[TOKEN, 10n]])] });
    expect(verifyTxIntent(tx({ outputs: [out(RECIPIENT, 1_400_000n, [[TOKEN, 10n]])] }), want)).toEqual([]);
    expect(verifyTxIntent(tx({ outputs: [out(RECIPIENT, 9_000_000n, [[TOKEN, 10n]])] }), want)).toContain('missingOutput');
    expect(verifyTxIntent(tx({ outputs: [out(RECIPIENT, 1_000_000n, [[TOKEN, 11n]])] }), want)).toContain('missingOutput');
  });

  it('accepts a top-up past 2 ADA only up to the protocol minimum for that output', () => {
    // 60 different tokens need far more than the asked 1 ADA plus 2 ADA of slack.
    const bundle: [string, bigint][] = Array.from({ length: 60 }, (_, i) => [`${i.toString(16).padStart(56, '0')}4e4654`, 1n]);
    const want = intent({ outputs: [send(1_000_000n, bundle)] });
    const required = minAdaRequired(out(RECIPIENT, 10_000_000n, bundle) as unknown as Cardano.TxOut, DEFAULT_COINS_PER_UTXO_BYTE);
    expect(required).toBeGreaterThan(3_000_000n);
    expect(verifyTxIntent(tx({ outputs: [out(RECIPIENT, required, bundle)] }), want)).toEqual([]);
    expect(verifyTxIntent(tx({ outputs: [out(RECIPIENT, required * 3n / 2n, bundle)] }), want)).toContain('missingOutput');
    // A higher live parameter raises what counts as the minimum.
    const higher = intent({ outputs: [send(1_000_000n, bundle)], coinsPerUtxoByte: DEFAULT_COINS_PER_UTXO_BYTE * 2n });
    expect(verifyTxIntent(tx({ outputs: [out(RECIPIENT, required * 3n / 2n, bundle)] }), higher)).toEqual([]);
  });

  it('accepts any amount in a send-max output', () => {
    expect(verifyTxIntent(tx({ outputs: [out(RECIPIENT, 77_000_000n)] }), intent({ outputs: [send('max')] }))).toEqual([]);
  });

  it('refuses inputs the wallet did not offer', () => {
    const t = tx({ inputs: [{ txId: TX, index: 0 }, { txId: TX, index: 7 }], outputs: [out(RECIPIENT, 5_000_000n)] });
    expect(verifyTxIntent(t, intent())).toEqual(['unexpectedInput']);
  });

  it('refuses certificates, withdrawals, minting, votes, collateral and signers nobody asked for', () => {
    const outputs = [out(RECIPIENT, 5_000_000n)];
    const cert = { __typename: Cardano.CertificateType.StakeDelegation, stakeCredential: keyCred('b'), poolId: POOL };
    expect(verifyTxIntent(tx({ outputs, certificates: [cert] }), intent())).toEqual(['unexpectedCertificate']);
    expect(verifyTxIntent(tx({ outputs, withdrawals: [{ stakeAddress: OWN_REWARD, quantity: 1n }] }), intent())).toEqual(['unexpectedWithdrawal']);
    expect(verifyTxIntent(tx({ outputs, mint: new Map([[TOKEN, 1n]]) }), intent())).toEqual(['unexpectedMint']);
    expect(verifyTxIntent(tx({ outputs, collaterals: [{ txId: TX, index: 0 }] }), intent())).toEqual(['unexpectedCollateral']);
    expect(verifyTxIntent(tx({ outputs, requiredExtraSignatures: ['4'.repeat(56)] }), intent())).toEqual(['unexpectedRequiredSigner']);
    expect(verifyTxIntent(tx({ outputs, donation: 1n }), intent())).toEqual(['unexpectedDonation']);
  });

  it('matches withdrawals exactly', () => {
    const want = intent({ outputs: [], withdrawals: [{ rewardAccount: OWN_REWARD, lovelace: 5_000_000n }] });
    expect(verifyTxIntent(tx({ withdrawals: [{ stakeAddress: OWN_REWARD, quantity: 5_000_000n }] }), want)).toEqual([]);
    expect(verifyTxIntent(tx({ withdrawals: [{ stakeAddress: OWN_REWARD, quantity: 6_000_000n }] }), want)).toEqual(['unexpectedWithdrawal']);
    expect(verifyTxIntent(tx({}), want)).toEqual(['unexpectedWithdrawal']);
  });

  it('caps the fee', () => {
    expect(verifyTxIntent(tx({ outputs: [out(RECIPIENT, 5_000_000n)], fee: MAX_BUILT_TX_FEE_LOVELACE + 1n }), intent())).toEqual(['feeTooHigh']);
  });

  it('pairs each requested output with a distinct transaction output', () => {
    const t = tx({ outputs: [out(RECIPIENT, 5_000_000n), out(RECIPIENT, 5_000_000n)] });
    expect(matchIntendedOutputs(t, [send(), send()])).toEqual([0, 1]);
    expect(matchIntendedOutputs(tx({ outputs: [out(RECIPIENT, 5_000_000n)] }), [send(), send()])).toEqual([0, -1]);
  });
});

describe('stakeCertificatesMatch', () => {
  const own = stakeCredentialOf(OWN_REWARD);
  const deleg = (pool: string, cred = own) => ({ __typename: Cardano.CertificateType.StakeDelegation, stakeCredential: cred, poolId: pool }) as Cardano.Certificate;

  it('reads the stake credential from the reward address', () => {
    expect(own).toEqual(keyCred('b'));
  });

  it('accepts a delegation of the wallet’s own key to the chosen pool only', () => {
    expect(stakeCertificatesMatch({ stakeCredential: own, poolId: POOL })([deleg(POOL)])).toBe(true);
    expect(stakeCertificatesMatch({ stakeCredential: own, poolId: POOL })([deleg(OTHER_POOL)])).toBe(false);
    expect(stakeCertificatesMatch({ stakeCredential: own, poolId: POOL })([deleg(POOL, keyCred('e'))])).toBe(false);
    expect(stakeCertificatesMatch({ stakeCredential: own, poolId: POOL })([])).toBe(false);
  });

  it('accepts a combined registration + pool + vote certificate when registration is allowed', () => {
    const combined = {
      __typename: Cardano.CertificateType.StakeVoteRegistrationDelegation,
      stakeCredential: own, poolId: POOL, dRep: { __typename: 'AlwaysAbstain' }, deposit: 2_000_000n,
    } as unknown as Cardano.Certificate;
    expect(stakeCertificatesMatch({ stakeCredential: own, poolId: POOL, drep: 'abstain', registration: 'allowed' })([combined])).toBe(true);
    expect(stakeCertificatesMatch({ stakeCredential: own, poolId: POOL, drep: 'abstain' })([combined])).toBe(false);
    expect(stakeCertificatesMatch({ stakeCredential: own, poolId: POOL, drep: 'noConfidence', registration: 'allowed' })([combined])).toBe(false);
  });

  it('accepts a deregistration only when asked for, and refuses an extra delegation beside it', () => {
    const dereg = { __typename: Cardano.CertificateType.Unregistration, stakeCredential: own, deposit: 2_000_000n } as unknown as Cardano.Certificate;
    expect(stakeCertificatesMatch({ stakeCredential: own, deregistration: true })([dereg])).toBe(true);
    expect(stakeCertificatesMatch({ stakeCredential: own, deregistration: true })([dereg, deleg(POOL)])).toBe(false);
    expect(stakeCertificatesMatch({ stakeCredential: own, registration: 'required' })([dereg])).toBe(false);
  });
});

describe('parseDRepTarget / drepRegistrationMatches', () => {
  const drepCred = keyCred('5');

  it('reads every DRep id form Nexus takes', () => {
    expect(parseDRepTarget('drep_always_abstain')).toBe('abstain');
    expect(parseDRepTarget('drep_always_no_confidence')).toBe('noConfidence');
    expect(parseDRepTarget(Cardano.DRepID.cip129FromCredential(drepCred))).toEqual(drepCred);
    expect(parseDRepTarget(Cardano.DRepID.cip105FromCredential(drepCred))).toEqual(drepCred);
    expect(parseDRepTarget(`22${'5'.repeat(56)}`)).toEqual(drepCred);
    expect(parseDRepTarget(`23${'5'.repeat(56)}`)).toEqual({ ...drepCred, type: Cardano.CredentialType.ScriptHash });
    expect(() => parseDRepTarget('not-a-drep')).toThrow();
  });

  it('accepts only the wallet’s own DRep registration with the requested anchor', () => {
    const anchor = { url: 'https://example.org/drep.json', dataHash: '6'.repeat(64) };
    const reg = (cred: Cardano.Credential, a: unknown) =>
      [{ __typename: Cardano.CertificateType.RegisterDelegateRepresentative, dRepCredential: cred, deposit: 500_000_000n, anchor: a }] as unknown as Cardano.Certificate[];
    expect(drepRegistrationMatches({ credential: drepCred, deregister: false, anchor })(reg(drepCred, anchor))).toBe(true);
    expect(drepRegistrationMatches({ credential: drepCred, deregister: false, anchor })(reg(drepCred, { ...anchor, url: 'https://evil.example' }))).toBe(false);
    expect(drepRegistrationMatches({ credential: drepCred, deregister: false, anchor: null })(reg(keyCred('7'), null))).toBe(false);
    expect(drepRegistrationMatches({ credential: drepCred, deregister: true })(reg(drepCred, null))).toBe(false);
  });
});

describe('verifySpendBound', () => {
  const ownUtxos = [[{ txId: TX, index: 0 }, out(OWN, 100_000_000n)]] as unknown as Cardano.Utxo[];
  const wallet = { ownAddresses: [OWN], ownUtxos };
  const bound = { maxOutflow: new Map([['lovelace', 20_000_000n]]) };

  it('refuses a key-locked input the wallet does not know, but not a script input', () => {
    const unknown = tx({ inputs: [{ txId: TX, index: 0 }, { txId: TX, index: 5 }], outputs: [out(OWN, 99_000_000n)] });
    expect(verifySpendBound(unknown, wallet, bound)).toEqual(['unknownInput']);
    // index 1 in the sorted input set is TX#5, spent by a script.
    const script = tx(
      { inputs: [{ txId: TX, index: 0 }, { txId: TX, index: 5 }], outputs: [out(OWN, 99_000_000n)] },
      { redeemers: [{ purpose: Cardano.RedeemerPurpose.spend, index: 1, data: {}, executionUnits: { memory: 0, steps: 0 } }] },
    );
    expect(verifySpendBound(script, wallet, bound)).toEqual([]);
  });

  it('refuses the wallet’s collateral returned to someone else', () => {
    const t = tx({
      outputs: [out(OWN, 99_000_000n)],
      collaterals: [{ txId: TX, index: 0 }],
      collateralReturn: out(ATTACKER, 95_000_000n),
    });
    expect(verifySpendBound(t, wallet, bound)).toEqual(['unexpectedCollateral']);
  });

  it('refuses certificates and withdrawals in an order', () => {
    const t = tx({ outputs: [out(OWN, 99_000_000n)], withdrawals: [{ stakeAddress: OWN_REWARD, quantity: 1n }] });
    expect(verifySpendBound(t, wallet, bound)).toEqual(['unexpectedWithdrawal']);
  });
});
