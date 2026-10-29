import { Cardano } from '@cardano-sdk/core';
import { minAdaRequired } from '@cardano-sdk/tx-construction';

/**
 * Verify a transaction someone else built before the wallet signs it.
 *
 * Most Cardano flows ask Nexus (or the swap aggregator, or RealFi through Nexus)
 * to build the transaction and only get CBOR back. Signing that CBOR as-is would
 * make the backend a single point of theft: it could add an output, swap the
 * recipient or slip in a certificate, and the review screen, built from what the
 * user typed, would not show it. These checks compare the decoded transaction
 * with what the flow asked for and refuse anything else.
 *
 * Two shapes:
 * - {@link verifyTxIntent}: the flow knows the exact result (a send, a
 *   withdrawal, a delegation). Every requested output must be present, every
 *   other output must pay the wallet, and nothing the flow did not ask for may
 *   appear (certificates, withdrawals, minting, votes, collateral, ...).
 * - {@link verifySpendBound}: the flow only knows a budget (a DEX order or a
 *   RealFi order, whose outputs go to a script). The net value leaving the
 *   wallet, per asset, must stay within the budget.
 *
 * Pure and UI-free so every caller and its tests share one implementation.
 */

export type TxIntentViolation =
  | 'missingOutput'
  | 'foreignOutput'
  | 'unexpectedInput'
  | 'missingInput'
  | 'unknownInput'
  | 'unexpectedWithdrawal'
  | 'unexpectedCertificate'
  | 'unexpectedMint'
  | 'unexpectedVote'
  | 'unexpectedProposal'
  | 'unexpectedCollateral'
  | 'unexpectedRequiredSigner'
  | 'unexpectedDonation'
  | 'feeTooHigh'
  | 'spendExceeded'
  /** An input or collateral whose value could not be proven from its creating transaction. */
  | 'unprovenInput'
  /** The UTxO list describes an input differently from the transaction that created it. */
  | 'misreportedInput';

/**
 * Upper bound for the network fee of a transaction built for the wallet. The
 * largest valid transaction (16 KiB, no scripts) costs under 1 ADA at current
 * parameters, so anything above this is not a fee the user agreed to.
 */
export const MAX_BUILT_TX_FEE_LOVELACE = 5_000_000n;

/**
 * A requested output that carries tokens may come back with more lovelace than
 * asked: the builder raises it to the minimum UTxO value. This is how much more
 * it may always add. More is accepted only when the output then holds no more
 * than the protocol minimum for that very output (isMinUtxoTopUp): a bundle of
 * many tokens can need well over 2 ADA, and the extra goes to the recipient the
 * user chose, never anywhere else.
 */
export const TOKEN_OUTPUT_LOVELACE_SLACK = 2_000_000n;

/**
 * coinsPerUTxOByte on mainnet, preprod and preview since Babbage. A caller with
 * the live protocol parameters passes them in the intent instead.
 */
export const DEFAULT_COINS_PER_UTXO_BYTE = 4_310n;

/** The output holds at most the ledger's minimum for it (10% leeway for the builder's rounding). */
function isMinUtxoTopUp(output: Cardano.TxOut, coins: bigint, coinsPerUtxoByte: bigint): boolean {
  try {
    return coins * 10n <= minAdaRequired(output, coinsPerUtxoByte) * 11n;
  } catch {
    return false;
  }
}

export interface IntendedOutput {
  address: string;
  /** Exact lovelace, or 'max' when the builder was asked to put the rest here. */
  lovelace: bigint | 'max';
  /** unit (policyId + assetName hex) → quantity. Must match exactly. */
  assets: ReadonlyMap<string, bigint>;
}

export interface ExpectedWithdrawal {
  rewardAccount: string;
  lovelace: bigint;
}

/**
 * An output whose exact lovelace the flow cannot know (a script's min-UTxO
 * deposit), so it is bounded instead: it must pay `address`, carry at most
 * `maxLovelace`, and hold exactly the assets `assets` accepts.
 */
export interface BoundedOutput {
  address: string;
  maxLovelace: bigint;
  /** Accepts the output's assets (unit → quantity). Omitted: no assets. */
  assets?: (assets: ReadonlyMap<string, bigint>) => boolean;
  /** Accepts the output's datum. Omitted: not checked. */
  datum?: (output: Cardano.TxOut) => boolean;
}

/**
 * Collateral a Plutus flow needs. The ledger keeps `totalCollateral` of it if a
 * script fails, and sends the rest to `collateralReturn`, so the wallet's own
 * collateral is acceptable only with that total stated and bounded and the
 * return paying the wallet. `isOwnRisk` says which collateral inputs the user
 * stands to lose (every input except one a sponsor provably lends).
 */
export interface CollateralAllowance {
  maxAtRiskLovelace: bigint;
  isOwnRisk: (inputRef: string) => boolean;
}

export interface TxIntent {
  outputs: readonly IntendedOutput[];
  /** Outputs to a script whose lovelace is bounded rather than known. Each must match one output. */
  boundedOutputs?: readonly BoundedOutput[];
  /** Addresses that belong to the wallet; every output not requested must pay one. */
  ownAddresses: Iterable<string>;
  /** `txId#index` of the UTxOs the wallet offered the builder. Omitted: not checked. */
  allowedInputs?: Iterable<string>;
  /** `txId#index` of inputs that must be spent (a script UTxO the flow consumes). */
  requiredInputs?: Iterable<string>;
  /** Withdrawals the flow asked for, matched exactly. Omitted: none allowed. */
  withdrawals?: readonly ExpectedWithdrawal[];
  /** Also accept withdrawals of 0 lovelace (the withdraw-zero script authorization); they move no value. */
  allowZeroWithdrawals?: boolean;
  /** Accepts the certificate list the flow asked for. Omitted: none allowed. */
  certificates?: (certificates: readonly Cardano.Certificate[]) => boolean;
  /** Accepts the mint (unit → signed quantity). Omitted: no minting or burning allowed. */
  mint?: (mint: ReadonlyMap<string, bigint>) => boolean;
  /** Key hashes the flow expects to be required signers. Omitted: none allowed. */
  requiredSigners?: Iterable<string>;
  /** Collateral the flow needs. Omitted: none allowed. */
  collateral?: CollateralAllowance;
  maxFeeLovelace?: bigint;
  /** Live coinsPerUTxOByte, for recognising a min-UTxO top-up. Default DEFAULT_COINS_PER_UTXO_BYTE. */
  coinsPerUtxoByte?: bigint;
}

// ── value helpers ──

/** Assets of an output as unit → quantity, whatever shape a storage round trip left. */
export function assetMapOf(value: { assets?: unknown } | undefined): Map<string, bigint> {
  const result = new Map<string, bigint>();
  const raw = value?.assets as unknown;
  const add = (unit: unknown, quantity: unknown) => {
    try {
      const qty = BigInt(String(quantity));
      if (qty === 0n) return;
      const key = String(unit);
      result.set(key, (result.get(key) ?? 0n) + qty);
    } catch {
      /* unparseable quantity: ignore */
    }
  };
  if (!raw) return result;
  if (raw instanceof Map) raw.forEach((quantity, unit) => add(unit, quantity));
  else if (Array.isArray(raw)) {
    for (const entry of raw as Array<{ unit?: unknown; quantity?: unknown } | [unknown, unknown]>) {
      if (Array.isArray(entry)) add(entry[0], entry[1]);
      else add(entry.unit, entry.quantity);
    }
  } else if (typeof raw === 'object') {
    for (const [unit, quantity] of Object.entries(raw as Record<string, unknown>)) add(unit, quantity);
  }
  return result;
}

export function lovelaceOf(value: { coins?: unknown } | undefined): bigint {
  try {
    return BigInt(String(value?.coins ?? 0));
  } catch {
    return 0n;
  }
}

/** Canonical form of an address for comparison (bech32 vs. other encodings). */
export function canonicalAddress(address: string): string {
  const text = String(address).trim();
  try {
    const parsed = Cardano.Address.fromString(text);
    if (parsed) return String(parsed.toBytes()).toLowerCase();
  } catch {
    /* not an address the SDK parses: compare the text */
  }
  return text;
}

function canonicalSet(addresses: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const a of addresses) if (a) set.add(canonicalAddress(a));
  return set;
}

const refOf = (input: { txId: unknown; index: unknown }) => `${String(input.txId).toLowerCase()}#${Number(input.index)}`;

function sameAssets(have: ReadonlyMap<string, bigint>, want: ReadonlyMap<string, bigint>): boolean {
  if (have.size !== want.size) return false;
  for (const [unit, qty] of want) if (have.get(unit) !== qty) return false;
  return true;
}

function outputMatches(output: Cardano.TxOut, want: IntendedOutput, wantAddress: string, coinsPerUtxoByte: bigint): boolean {
  if (canonicalAddress(String(output.address)) !== wantAddress) return false;
  const wantAssets = new Map<string, bigint>();
  want.assets.forEach((qty, unit) => { if (qty !== 0n) wantAssets.set(unit, qty); });
  if (!sameAssets(assetMapOf(output.value), wantAssets)) return false;
  if (want.lovelace === 'max') return true;
  const coins = lovelaceOf(output.value);
  if (wantAssets.size === 0) return coins === want.lovelace;
  if (coins < want.lovelace) return false;
  return coins - want.lovelace <= TOKEN_OUTPUT_LOVELACE_SLACK || isMinUtxoTopUp(output, coins, coinsPerUtxoByte);
}

/**
 * Index of the transaction output that satisfies each requested output, or -1.
 * Each transaction output answers at most one request, in request order.
 */
export function matchIntendedOutputs(
  tx: Cardano.Tx,
  intended: readonly IntendedOutput[],
  coinsPerUtxoByte: bigint = DEFAULT_COINS_PER_UTXO_BYTE,
): number[] {
  const outputs = tx.body.outputs ?? [];
  const used = new Set<number>();
  return intended.map((want) => {
    const wantAddress = canonicalAddress(want.address);
    const index = outputs.findIndex((o, i) => !used.has(i) && outputMatches(o, want, wantAddress, coinsPerUtxoByte));
    if (index >= 0) used.add(index);
    return index;
  });
}

function hasEntries(value: unknown): boolean {
  if (!value) return false;
  if (value instanceof Map) return value.size > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return false;
}

function rewardAccountKey(account: string): string {
  try {
    return String(Cardano.RewardAccount(String(account).trim())).toLowerCase();
  } catch {
    return String(account).trim().toLowerCase();
  }
}

function withdrawalsMatch(
  actual: ReadonlyArray<{ stakeAddress: unknown; quantity: unknown }> | undefined,
  expected: readonly ExpectedWithdrawal[] | undefined,
): boolean {
  const have = (actual ?? []).map((w) => `${rewardAccountKey(String(w.stakeAddress))}:${String(w.quantity)}`).sort();
  const want = (expected ?? []).map((w) => `${rewardAccountKey(w.rewardAccount)}:${w.lovelace.toString()}`).sort();
  return have.length === want.length && have.every((v, i) => v === want[i]);
}

/** Checks shared by both shapes: fields no built-for-the-wallet transaction should carry. */
function structuralViolations(body: Cardano.TxBody, violations: Set<TxIntentViolation>): void {
  if (hasEntries(body.mint)) violations.add('unexpectedMint');
  if (hasEntries(body.votingProcedures)) violations.add('unexpectedVote');
  if (hasEntries(body.proposalProcedures)) violations.add('unexpectedProposal');
  if (body.donation != null && BigInt(body.donation) > 0n) violations.add('unexpectedDonation');
}

/**
 * Index of the output that satisfies each bounded output, or -1. Outputs that
 * already answered a requested output are not reused.
 */
function matchBoundedOutputs(tx: Cardano.Tx, bounded: readonly BoundedOutput[], taken: ReadonlySet<number>): number[] {
  const outputs = tx.body.outputs ?? [];
  const used = new Set<number>(taken);
  return bounded.map((want) => {
    const wantAddress = canonicalAddress(want.address);
    const index = outputs.findIndex((o, i) => {
      if (used.has(i) || canonicalAddress(String(o.address)) !== wantAddress) return false;
      if (lovelaceOf(o.value) > want.maxLovelace) return false;
      const assets = assetMapOf(o.value);
      if (want.assets ? !want.assets(assets) : assets.size > 0) return false;
      return want.datum ? want.datum(o) : true;
    });
    if (index >= 0) used.add(index);
    return index;
  });
}

/**
 * Collateral is acceptable when the flow allows it and the user's share of it is
 * bounded: the stated total is within the limit and whatever the ledger returns
 * comes back to the wallet. Collateral that is entirely a sponsor's is the
 * sponsor's risk.
 */
function collateralAllowed(body: Cardano.TxBody, allowance: CollateralAllowance | undefined, own: ReadonlySet<string>): boolean {
  const collaterals = body.collaterals ?? [];
  const present = collaterals.length > 0 || !!body.collateralReturn || body.totalCollateral != null;
  if (!present) return true;
  if (!allowance) return false;
  const ownRisk = collaterals.some((c) => allowance.isOwnRisk(refOf(c)));
  if (!ownRisk) return true;
  if (body.collateralReturn && !own.has(canonicalAddress(String(body.collateralReturn.address)))) return false;
  if (body.totalCollateral == null) return false;
  return BigInt(body.totalCollateral) <= allowance.maxAtRiskLovelace;
}

function requiredSignersAllowed(actual: readonly unknown[] | undefined, allowed: Iterable<string> | undefined): boolean {
  if (!hasEntries(actual)) return true;
  if (!allowed) return false;
  const set = new Set(Array.from(allowed, (h) => h.toLowerCase()));
  return (actual ?? []).every((h) => set.has(String(h).toLowerCase()));
}

/** Every way `tx` departs from `intent`; empty when it is exactly what was asked for. */
export function verifyTxIntent(tx: Cardano.Tx, intent: TxIntent): TxIntentViolation[] {
  const body = tx.body;
  const violations = new Set<TxIntentViolation>();
  const own = canonicalSet(intent.ownAddresses);

  const matched = matchIntendedOutputs(tx, intent.outputs, intent.coinsPerUtxoByte);
  if (matched.some((i) => i < 0)) violations.add('missingOutput');
  const matchedSet = new Set(matched.filter((i) => i >= 0));
  for (const index of matchBoundedOutputs(tx, intent.boundedOutputs ?? [], matchedSet)) {
    if (index < 0) violations.add('missingOutput');
    else matchedSet.add(index);
  }
  (body.outputs ?? []).forEach((o, i) => {
    if (!matchedSet.has(i) && !own.has(canonicalAddress(String(o.address)))) violations.add('foreignOutput');
  });

  if (intent.allowedInputs) {
    const allowed = new Set(Array.from(intent.allowedInputs, (r) => r.toLowerCase()));
    for (const r of intent.requiredInputs ?? []) allowed.add(r.toLowerCase());
    for (const input of body.inputs ?? []) if (!allowed.has(refOf(input))) violations.add('unexpectedInput');
  }
  if (intent.requiredInputs) {
    const spent = new Set((body.inputs ?? []).map(refOf));
    for (const r of intent.requiredInputs) if (!spent.has(r.toLowerCase())) violations.add('missingInput');
  }

  if (!collateralAllowed(body, intent.collateral, own)) violations.add('unexpectedCollateral');
  const withdrawals = intent.allowZeroWithdrawals
    ? (body.withdrawals ?? []).filter((w) => BigInt(String(w.quantity ?? 0)) !== 0n)
    : body.withdrawals;
  if (!withdrawalsMatch(withdrawals, intent.withdrawals)) violations.add('unexpectedWithdrawal');

  const certificates = (body.certificates ?? []) as Cardano.Certificate[];
  if (intent.certificates ? !intent.certificates(certificates) : certificates.length > 0) {
    violations.add('unexpectedCertificate');
  }
  if (!requiredSignersAllowed(body.requiredExtraSignatures, intent.requiredSigners)) {
    violations.add('unexpectedRequiredSigner');
  }
  structuralViolations(body, violations);
  if (intent.mint) {
    violations.delete('unexpectedMint');
    if (!intent.mint(assetMapOf({ assets: body.mint }))) violations.add('unexpectedMint');
  }

  if (BigInt(body.fee ?? 0n) > (intent.maxFeeLovelace ?? MAX_BUILT_TX_FEE_LOVELACE)) violations.add('feeTooHigh');
  return [...violations];
}

// ── certificate expectations ──

export type DRepTarget = 'abstain' | 'noConfidence' | Cardano.Credential;

function sameCredential(a: { type?: unknown; hash?: unknown } | undefined, b: Cardano.Credential): boolean {
  return !!a && a.type === b.type && String(a.hash).toLowerCase() === String(b.hash).toLowerCase();
}

function drepMatches(drep: Cardano.DelegateRepresentative | undefined, target: DRepTarget): boolean {
  if (!drep) return false;
  if (target === 'abstain') return Cardano.isDRepAlwaysAbstain(drep);
  if (target === 'noConfidence') return Cardano.isDRepAlwaysNoConfidence(drep);
  return Cardano.isDRepCredential(drep) && sameCredential(drep, target);
}

/** Normalise a pool id given as bech32 or a 56-character key hash. */
export function normalizePoolId(poolId: string): string {
  const text = String(poolId).trim();
  if (/^[0-9a-f]{56}$/i.test(text)) return String(Cardano.PoolId.fromKeyHash(text.toLowerCase() as never));
  return text.toLowerCase();
}

/**
 * The DRep a Nexus `drepId` names: `drep_always_abstain`, `drep_always_no_confidence`,
 * a CIP-105/CIP-129 bech32 id, or the credential as hex (28-byte key hash, or the
 * 29-byte CIP-129 form with its header byte). Throws for anything else.
 */
export function parseDRepTarget(drepId: string): DRepTarget {
  const text = String(drepId).trim();
  if (text === 'drep_always_abstain') return 'abstain';
  if (text === 'drep_always_no_confidence') return 'noConfidence';
  if (/^[0-9a-f]{56}$/i.test(text)) {
    return { type: Cardano.CredentialType.KeyHash, hash: text.toLowerCase() as Cardano.Credential['hash'] };
  }
  if (/^[0-9a-f]{58}$/i.test(text)) {
    const header = parseInt(text.slice(0, 2), 16);
    if ((header & 0x20) !== 0x20) throw new Error('Not a DRep credential');
    return {
      type: (header & 0x03) === 0x03 ? Cardano.CredentialType.ScriptHash : Cardano.CredentialType.KeyHash,
      hash: text.slice(2).toLowerCase() as Cardano.Credential['hash'],
    };
  }
  return Cardano.DRepID.toCredential(Cardano.DRepID(text));
}

/** The stake credential a reward address (stake1… / stake_test1…) carries. */
export function stakeCredentialOf(rewardAccount: string): Cardano.Credential {
  const reward = Cardano.Address.fromBech32(String(rewardAccount).trim()).asReward();
  if (!reward) throw new Error('Not a reward address');
  return reward.getPaymentCredential();
}

export interface StakeCertificateExpectation {
  /** The wallet's own stake credential; every certificate must act on it. */
  stakeCredential: Cardano.Credential;
  /** A (re)registration of that credential may appear (`required`: must appear). */
  registration?: 'allowed' | 'required';
  /** A deregistration of that credential must appear. */
  deregistration?: boolean;
  /** A delegation to exactly this pool must appear. */
  poolId?: string;
  /** A vote delegation to exactly this DRep must appear. */
  drep?: DRepTarget;
}

/**
 * Accepts the stake certificates of a registration, deregistration, pool
 * delegation and/or vote delegation of the wallet's own credential, in any of
 * the encodings Conway allows (separate certificates or the combined ones).
 */
export function stakeCertificatesMatch(exp: StakeCertificateExpectation) {
  const poolId = exp.poolId ? normalizePoolId(exp.poolId) : null;
  return (certificates: readonly Cardano.Certificate[]): boolean => {
    let registered = false;
    let deregistered = false;
    let pool = false;
    let vote = false;
    for (const cert of certificates) {
      const c = cert as Cardano.Certificate & {
        stakeCredential?: Cardano.Credential;
        poolId?: string;
        dRep?: Cardano.DelegateRepresentative;
      };
      if (!sameCredential(c.stakeCredential, exp.stakeCredential)) return false;
      const wantsReg = [
        Cardano.CertificateType.StakeRegistration,
        Cardano.CertificateType.Registration,
        Cardano.CertificateType.StakeRegistrationDelegation,
        Cardano.CertificateType.VoteRegistrationDelegation,
        Cardano.CertificateType.StakeVoteRegistrationDelegation,
      ].includes(c.__typename);
      const wantsPool = [
        Cardano.CertificateType.StakeDelegation,
        Cardano.CertificateType.StakeVoteDelegation,
        Cardano.CertificateType.StakeRegistrationDelegation,
        Cardano.CertificateType.StakeVoteRegistrationDelegation,
      ].includes(c.__typename);
      const wantsVote = [
        Cardano.CertificateType.VoteDelegation,
        Cardano.CertificateType.StakeVoteDelegation,
        Cardano.CertificateType.VoteRegistrationDelegation,
        Cardano.CertificateType.StakeVoteRegistrationDelegation,
      ].includes(c.__typename);
      const wantsDereg = [
        Cardano.CertificateType.StakeDeregistration,
        Cardano.CertificateType.Unregistration,
      ].includes(c.__typename);
      if (!wantsReg && !wantsPool && !wantsVote && !wantsDereg) return false;
      if (wantsReg) {
        if (!exp.registration || registered) return false;
        registered = true;
      }
      if (wantsDereg) {
        if (!exp.deregistration || deregistered) return false;
        deregistered = true;
      }
      if (wantsPool) {
        if (!poolId || !c.poolId || normalizePoolId(String(c.poolId)) !== poolId || pool) return false;
        pool = true;
      }
      if (wantsVote) {
        if (!exp.drep || !drepMatches(c.dRep, exp.drep) || vote) return false;
        vote = true;
      }
    }
    if (exp.registration === 'required' && !registered) return false;
    if (exp.deregistration && !deregistered) return false;
    if (poolId && !pool) return false;
    if (exp.drep && !vote) return false;
    return true;
  };
}

export interface DRepRegistrationExpectation {
  credential: Cardano.Credential;
  deregister: boolean;
  /** Anchor the registration must carry; null/undefined: none. */
  anchor?: { url: string; dataHash: string } | null;
}

/** Accepts exactly one registration (or retirement) of the wallet's own DRep credential. */
export function drepRegistrationMatches(exp: DRepRegistrationExpectation) {
  return (certificates: readonly Cardano.Certificate[]): boolean => {
    if (certificates.length !== 1) return false;
    const c = certificates[0] as Cardano.Certificate & {
      dRepCredential?: Cardano.Credential;
      anchor?: { url?: string; dataHash?: string } | null;
    };
    const wantType = exp.deregister
      ? Cardano.CertificateType.UnregisterDelegateRepresentative
      : Cardano.CertificateType.RegisterDelegateRepresentative;
    if (c.__typename !== wantType || !sameCredential(c.dRepCredential, exp.credential)) return false;
    if (exp.deregister) return true;
    if (!exp.anchor) return !c.anchor;
    return !!c.anchor && c.anchor.url === exp.anchor.url
      && String(c.anchor.dataHash).toLowerCase() === exp.anchor.dataHash.toLowerCase();
  };
}

// ── spend bound (orders whose outputs go to a script) ──

export interface SpendBound {
  /**
   * Largest net amount of each asset that may leave the wallet, by unit;
   * 'lovelace' for ADA (the network fee comes on top). An asset not listed may
   * not leave at all.
   */
  maxOutflow: ReadonlyMap<string, bigint>;
}

export interface OwnWalletView {
  /** The wallet's own addresses, as it derives them (ownAddresses.ts). The only addresses that count as change. */
  ownAddresses: Iterable<string>;
  /**
   * Every UTxO the wallet holds, collateral included, with values the caller has
   * proven (provenInputs.ts). Their addresses do not widen `ownAddresses`.
   */
  ownUtxos: readonly Cardano.Utxo[];
}

/** Lovelace of the wallet's own collateral that may be lost if the scripts fail. */
export const MAX_COLLATERAL_AT_RISK_LOVELACE = 10_000_000n;

function sortedInputRefs(inputs: readonly Cardano.TxIn[]): string[] {
  return inputs
    .map((i) => ({ txId: String(i.txId).toLowerCase(), index: Number(i.index) }))
    .sort((a, b) => (a.txId === b.txId ? a.index - b.index : a.txId < b.txId ? -1 : 1))
    .map((i) => `${i.txId}#${i.index}`);
}

/** `txId#index` of an input or UTxO reference, as every check here keys them. */
export function inputRefOf(input: { txId: unknown; index: unknown }): string {
  return refOf(input);
}

/**
 * Inputs a script spends: a spend redeemer names them by their position in the
 * sorted input set. Those are never the wallet's key-locked UTxOs.
 */
export function scriptSpentInputRefs(tx: Cardano.Tx): Set<string> {
  const sorted = sortedInputRefs(tx.body.inputs ?? []);
  return new Set(
    (tx.witness?.redeemers ?? [])
      .filter((r) => r.purpose === Cardano.RedeemerPurpose.spend)
      .map((r) => sorted[Number(r.index)])
      .filter((r): r is string => !!r),
  );
}

/**
 * Every way `tx` exceeds `bound`. Inputs the wallet does not hold are allowed
 * only when a script spends them (a redeemer names them); any other unknown
 * input could be the wallet's own and is refused rather than left out of the sum.
 */
export function verifySpendBound(tx: Cardano.Tx, wallet: OwnWalletView, bound: SpendBound): TxIntentViolation[] {
  const body = tx.body;
  const violations = new Set<TxIntentViolation>();
  const own = canonicalSet(wallet.ownAddresses);
  const ownUtxos = new Map<string, Cardano.TxOut>();
  for (const [txIn, txOut] of wallet.ownUtxos) ownUtxos.set(refOf(txIn), txOut);

  const scriptSpent = scriptSpentInputRefs(tx);

  const net = new Map<string, bigint>();
  const addNet = (unit: string, qty: bigint) => net.set(unit, (net.get(unit) ?? 0n) + qty);
  for (const input of body.inputs ?? []) {
    const ref = refOf(input);
    const held = ownUtxos.get(ref);
    if (held) {
      addNet('lovelace', lovelaceOf(held.value));
      assetMapOf(held.value).forEach((qty, unit) => addNet(unit, qty));
    } else if (!scriptSpent.has(ref)) {
      violations.add('unknownInput');
    }
  }
  for (const output of body.outputs ?? []) {
    if (!own.has(canonicalAddress(String(output.address)))) continue;
    addNet('lovelace', -lovelaceOf(output.value));
    assetMapOf(output.value).forEach((qty, unit) => addNet(unit, -qty));
  }

  // Withdrawals and certificates are never part of an order.
  if (hasEntries(body.withdrawals)) violations.add('unexpectedWithdrawal');
  if (hasEntries(body.certificates)) violations.add('unexpectedCertificate');
  structuralViolations(body, violations);
  // Minting is how some orders mark themselves; burning the wallet's tokens shows
  // up below as value that does not come back.
  violations.delete('unexpectedMint');

  // Collateral is lost only if a script fails, but a builder can make it fail.
  let ownCollateral = 0n;
  const ownCollateralAssets = new Map<string, bigint>();
  for (const c of body.collaterals ?? []) {
    const held = ownUtxos.get(refOf(c));
    if (!held) continue;
    ownCollateral += lovelaceOf(held.value);
    assetMapOf(held.value).forEach((qty, unit) => ownCollateralAssets.set(unit, (ownCollateralAssets.get(unit) ?? 0n) + qty));
  }
  if (ownCollateral > 0n || ownCollateralAssets.size > 0) {
    const ret = body.collateralReturn;
    const returnIsOwn = !!ret && own.has(canonicalAddress(String(ret.address)));
    const returned = returnIsOwn ? lovelaceOf(ret?.value) : 0n;
    const returnedAssets = returnIsOwn ? assetMapOf(ret?.value) : new Map<string, bigint>();
    if (ownCollateral - returned > MAX_COLLATERAL_AT_RISK_LOVELACE) violations.add('unexpectedCollateral');
    for (const [unit, qty] of ownCollateralAssets) {
      if ((returnedAssets.get(unit) ?? 0n) < qty) violations.add('unexpectedCollateral');
    }
  }

  const fee = BigInt(body.fee ?? 0n);
  if (fee > MAX_BUILT_TX_FEE_LOVELACE) violations.add('feeTooHigh');
  for (const [unit, outflow] of net) {
    if (outflow <= 0n) continue;
    const allowed = (bound.maxOutflow.get(unit) ?? 0n) + (unit === 'lovelace' ? fee : 0n);
    if (outflow > allowed) violations.add('spendExceeded');
  }
  return [...violations];
}

/** Thrown when a built transaction is not what the flow asked for. Nothing was signed. */
export class TxIntentMismatchError extends Error {
  readonly violations: TxIntentViolation[];
  constructor(message: string, violations: TxIntentViolation[]) {
    super(message);
    this.name = 'TxIntentMismatchError';
    this.violations = violations;
  }
}
