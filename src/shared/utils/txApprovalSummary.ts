import { Cardano } from '@cardano-sdk/core';
import { paymentScriptHash } from '@/chrome/nftMarket/marketGuard';
import { reviveOwnListings, type OwnListing } from '@/chrome/nftMarket/ownListings';
import { inputRefOf, scriptSpentInputRefs } from './txIntentGuard';

/**
 * What a dApp signTx approval must show: every effect of the transaction the
 * user is about to sign, derived from the decoded body (the same bytes the
 * signer hashes). Pure and UI-free so the side panel and the popup fallback
 * render the same thing and it can be unit tested.
 *
 * Ownership is judged against the wallet's own credentials (key hashes from
 * WalletStore keys), never against anything the dApp supplies.
 */

export interface ApprovalAssetInfo {
  name: string;
  decimals: number;
}

export interface ApprovalContext {
  /** bech32 addresses of the wallet's external (receive) keys. */
  paymentAddresses: ReadonlySet<string>;
  /** bech32 addresses of the wallet's internal (change) keys. */
  changeAddresses: ReadonlySet<string>;
  /** Payment key hashes (hex) the wallet can sign for. */
  ownPaymentKeyHashes: ReadonlySet<string>;
  /** Stake key hashes (hex) the wallet can sign for. */
  ownStakeKeyHashes: ReadonlySet<string>;
  /** Reward accounts (stake1… / stake_test1…) of the wallet. */
  ownRewardAccounts: ReadonlySet<string>;
  /** DRep key hashes (hex) of the wallet. */
  ownDrepKeyHashes: ReadonlySet<string>;
  /** Constitutional-committee hot key hashes (hex) of the wallet. */
  ownCcHotKeyHashes: ReadonlySet<string>;
  /** Network of the active wallet, or null when unknown. */
  walletNetworkId: Cardano.NetworkId | null;
  resolveAsset(unit: string): ApprovalAssetInfo;
  /**
   * The wallet's UTxOs (collateral included). With them the summary counts what
   * the wallet's own inputs put in; without them it falls back to an estimate
   * from the outputs, fee and deposits.
   */
  ownUtxos?: readonly Cardano.Utxo[];
  /** Protocol deposits for certificates that do not carry their own amount. */
  deposits?: ApprovalDeposits;
  /**
   * The wallet's own, verified Gero listings by `txId#index` (lower case), read from
   * `walletStore.listedListings` and revived (`approvalMarketContext`). An input in this map is
   * "your listing": its NFT and price come from the datum the wallet stored, never from the
   * transaction. A listing UTxO not in it (someone else's, or a fake naming the wallet) is not.
   */
  ownListings: ReadonlyMap<string, OwnListing>;
  /**
   * The payment script hashes (lower-case hex) of every deployed version of the Gero listing
   * contract on the wallet's network, from `networks.resolveNftMarketDeployments`. An output paid
   * to one of them, whatever its stake part, creates a market listing. Empty where the market is
   * unsupported.
   */
  listingScriptHashes: ReadonlySet<string>;
}

/** The market part of an {@link ApprovalContext}: the wallet's listings and the listing scripts. */
export type ApprovalMarketContext = Pick<ApprovalContext, 'ownListings' | 'listingScriptHashes'>;

export interface ApprovalDeposits {
  /** keyDeposit, for the pre-Conway stake (de)registration certificates. */
  stakeKey?: bigint;
  /** poolDeposit, locked by a pool registration. */
  pool?: bigint;
}

export type ApprovalOutputKind = 'change' | 'payment' | 'external';

export interface ApprovalAsset {
  unit: string;
  label: string;
  quantity: string;
  formattedQuantity: string;
}

export interface ApprovalOutput {
  address: string;
  ada: string;
  lovelace: bigint;
  kind: ApprovalOutputKind;
  isOwn: boolean;
  assets: ApprovalAsset[];
}

export interface ApprovalCertificate {
  type: Cardano.CertificateType;
  /** Full bech32 pool id, when the certificate names a pool. */
  poolId?: string;
  depositAda?: string;
  /** 'alwaysAbstain' | 'alwaysNoConfidence' for the sentinel DRep targets. */
  drepSentinel?: 'alwaysAbstain' | 'alwaysNoConfidence';
  /** Full CIP-129 DRep id for a delegation to a specific DRep. */
  drepId?: string;
  /** Whether the certificate's stake credential is the wallet's own; null when the certificate has none. */
  stakeCredentialIsOwn: boolean | null;
  /** 'paid' when the certificate locks `depositAda`, 'refunded' when it returns it. */
  depositDirection?: 'paid' | 'refunded';
  /** Reward account a pool registration's deposit is refunded to. */
  refundAccount?: string;
  /**
   * For a deposit the transaction pays: whether its refund comes back to the
   * wallet (false: someone else gets it back). Null when it cannot be told.
   */
  refundIsOwn?: boolean | null;
}

export interface ApprovalWithdrawal {
  rewardAccount: string;
  ada: string;
  lovelace: bigint;
  isOwn: boolean;
}

export type ApprovalVoteChoice = 'yes' | 'no' | 'abstain';

export interface ApprovalVote {
  voterType: Cardano.VoterType;
  voterHash: string;
  /** True only for a DRep / CC-hot key voter the wallet owns. */
  isOwnVoter: boolean;
  actions: Array<{ txId: string; index: number; vote: ApprovalVoteChoice }>;
}

export interface ApprovalProposal {
  actionType: string;
  depositAda: string;
  rewardAccount: string;
  isOwnRewardAccount: boolean;
}

export interface ApprovalMint {
  label: string;
  formattedQuantity: string;
  isBurn: boolean;
}

/** An input of the transaction that is one of the wallet's own Gero listings. */
export interface ApprovalListedInput {
  /** The listing UTxO, `txId#index`. */
  ref: string;
  /** Policy id and asset name (hex) of the listed NFT, from the stored listing. */
  unit: string;
  /** The NFT's display name (`ctx.resolveAsset`). */
  label: string;
  /** The price the wallet's stored datum lists it at, in lovelace. */
  priceLovelace: bigint;
}

export interface TxApprovalSummary {
  outputs: ApprovalOutput[];
  feeAda: string;
  withdrawals: ApprovalWithdrawal[];
  certificates: ApprovalCertificate[];
  mints: ApprovalMint[];
  votes: ApprovalVote[];
  proposals: ApprovalProposal[];
  collateralCount: number;
  collateralReturn: ApprovalOutput | null;
  totalCollateralAda: string | null;
  referenceInputCount: number;
  requiredSigners: Array<{ keyHash: string; isOwn: boolean }>;
  hasMetadata: boolean;
  validityStartSlot: number | null;
  ttlSlot: number | null;
  /** body.network_id is set and differs from the wallet's network. */
  bodyNetworkMismatch: boolean;
  /** Any output (own included) or the collateral return is on another network. */
  outputNetworkMismatch: boolean;
  /** A certificate acts on a stake credential the wallet doesn't own. */
  hasForeignStakeCertificate: boolean;
  /**
   * What the wallet stands to lose if a script fails: its own collateral
   * inputs minus what returns to it. Null when the inputs can't be resolved.
   */
  collateralAtRiskAda: string | null;
  /**
   * Inputs that are neither the wallet's known UTxOs nor spent by a script.
   * When any exist, `youPayAda` is an estimate from the outputs, fee and deposits.
   */
  unmatchedInputCount: number;
  /**
   * A deposit is paid whose refund goes to someone else, or the wallet's
   * collateral returns to an address that is not its own. Sign waits for an
   * explicit acknowledgement.
   */
  requiresForeignValueAck: boolean;
  /**
   * Conway `donation` (body field 22): ADA moved to the treasury, paid by the
   * wallet and never returned. Null when the body carries none.
   */
  treasuryDonationAda: string | null;
  /**
   * Own Gero listings this transaction spends (cancel or reprice), in input order. Taken from the
   * wallet's stored listings, never from the transaction's own data. Empty for a transaction that
   * spends none of them.
   */
  listedInputs: ApprovalListedInput[];
  /** An output is paid to a Gero listing script (a listing is created, whoever owns it). */
  createsListing: boolean;
  /** How many outputs are paid to a Gero listing script. */
  createdListingCount: number;
  totals: {
    totalSendingAda: string;
    feeAda: string;
    /** Only the wallet's own withdrawals offset what the user pays. */
    ownWithdrawalAda?: string;
    youPayAda: string;
    isInternal: boolean;
  };
  isInternal: boolean;
}

/** 6 decimals, trailing zeros trimmed but at least 2 kept (bigint, no float math). */
export function formatLovelace(lovelace: bigint): string {
  const negative = lovelace < 0n;
  const abs = negative ? -lovelace : lovelace;
  const whole = abs / 1_000_000n;
  let frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

export function formatTokenQuantity(rawQuantity: string, decimals: number): string {
  if (!rawQuantity) return '0';
  if (decimals <= 0) return rawQuantity;
  try {
    const raw = BigInt(rawQuantity);
    const negative = raw < 0n;
    const absRaw = negative ? -raw : raw;
    const divisor = 10n ** BigInt(decimals);
    const intStr = (absRaw / divisor).toString();
    const fracPart = absRaw % divisor;
    if (fracPart === 0n) return negative ? `-${intStr}` : intStr;
    const fracStr = fracPart.toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${negative ? '-' : ''}${intStr}.${fracStr}`;
  } catch {
    return rawQuantity;
  }
}

function entries(map: unknown): Array<[string, unknown]> {
  if (!map) return [];
  if (map instanceof Map) return Array.from(map.entries()).map(([k, v]) => [String(k), v]);
  if (typeof map === 'object') return Object.entries(map as Record<string, unknown>);
  return [];
}

function addressNetworkId(address: string): Cardano.NetworkId | null {
  try {
    const parsed = Cardano.Address.fromString(address);
    return parsed ? parsed.getNetworkId() : null;
  } catch {
    return null;
  }
}

function stakeCredentialHash(cert: Cardano.Certificate): string | null {
  const c = cert as { stakeCredential?: { hash?: unknown } };
  return c.stakeCredential && typeof c.stakeCredential.hash === 'string' ? c.stakeCredential.hash : null;
}

function coinsOf(txOut: Cardano.TxOut | undefined): bigint {
  try {
    return BigInt(String(txOut?.value?.coins ?? 0));
  } catch {
    return 0n;
  }
}

const PAYS_DEPOSIT: ReadonlySet<string> = new Set([
  Cardano.CertificateType.StakeRegistration,
  Cardano.CertificateType.Registration,
  Cardano.CertificateType.StakeRegistrationDelegation,
  Cardano.CertificateType.VoteRegistrationDelegation,
  Cardano.CertificateType.StakeVoteRegistrationDelegation,
  Cardano.CertificateType.RegisterDelegateRepresentative,
  Cardano.CertificateType.PoolRegistration,
]);
const REFUNDS_DEPOSIT: ReadonlySet<string> = new Set([
  Cardano.CertificateType.StakeDeregistration,
  Cardano.CertificateType.Unregistration,
  Cardano.CertificateType.UnregisterDelegateRepresentative,
]);

/**
 * The deposit a certificate locks or returns. Conway certificates carry the
 * amount; the pre-Conway stake certificates and a pool registration use the
 * protocol's keyDeposit / poolDeposit. (A pool re-registration locks nothing,
 * which the transaction alone can't tell, so the pool deposit is an upper bound.)
 */
function certificateDeposit(
  cert: Cardano.Certificate,
  deposits: ApprovalDeposits | undefined,
): { lovelace: bigint; direction: 'paid' | 'refunded' } | null {
  const type = cert.__typename as string;
  const direction = PAYS_DEPOSIT.has(type) ? 'paid' : REFUNDS_DEPOSIT.has(type) ? 'refunded' : null;
  if (!direction) return null;
  let lovelace: bigint | undefined;
  if ('deposit' in cert && cert.deposit != null) lovelace = BigInt(cert.deposit as unknown as bigint);
  else if (type === Cardano.CertificateType.PoolRegistration) lovelace = deposits?.pool;
  else lovelace = deposits?.stakeKey;
  return lovelace !== undefined && lovelace > 0n ? { lovelace, direction } : null;
}

/**
 * Whether the deposit a certificate concerns is refunded to the wallet: a pool's
 * to its reward account, a DRep's to whoever controls the DRep credential, a
 * stake registration's to the stake credential.
 */
function refundIsOwn(cert: Cardano.Certificate, ctx: ApprovalContext, stakeCredentialIsOwn: boolean | null): boolean | null {
  if (cert.__typename === Cardano.CertificateType.PoolRegistration) {
    const account = (cert as Cardano.PoolRegistrationCertificate).poolParameters?.rewardAccount;
    return account ? ctx.ownRewardAccounts.has(String(account)) : null;
  }
  const drepCredential = (cert as { dRepCredential?: { hash?: unknown } }).dRepCredential;
  if (drepCredential && typeof drepCredential.hash === 'string') {
    return ctx.ownDrepKeyHashes.has(drepCredential.hash.toLowerCase());
  }
  return stakeCredentialIsOwn;
}

function voteChoice(vote: Cardano.Vote): ApprovalVoteChoice {
  if (vote === Cardano.Vote.yes) return 'yes';
  if (vote === Cardano.Vote.no) return 'no';
  return 'abstain';
}

/**
 * How the transaction touches the Gero market, for the approval screen. A dApp transaction that
 * spends one of the wallet's own listings or puts something at a listing script is signable once
 * the user approves it, so this preview is the user's only protection there. It follows the signing
 * guard's own rules (marketGuard.ts `findMarketTouch`): inputs only (reference inputs and
 * collateral are not spent), outputs at a deployed script whatever the stake part.
 *
 * What is shown for a spent listing is the wallet's stored one, matched by reference: nothing the
 * dApp wrote in the transaction decides the NFT or the price, and a listing UTxO the wallet did not
 * verify as its own (a stranger's, or a fake that names the wallet) is simply not "yours".
 */
function marketEffects(
  tx: Cardano.Tx,
  outputs: readonly ApprovalOutput[],
  ctx: ApprovalContext,
): { listedInputs: ApprovalListedInput[]; createdListingCount: number } {
  const listedInputs: ApprovalListedInput[] = [];
  if (ctx.ownListings.size > 0) {
    const ownByRef = new Map<string, OwnListing>();
    for (const [ref, listing] of ctx.ownListings) ownByRef.set(ref.toLowerCase(), listing);
    const seen = new Set<string>();
    for (const input of tx.body.inputs ?? []) {
      const ref = inputRefOf(input);
      const listing = ownByRef.get(ref);
      if (!listing || seen.has(ref)) continue;
      seen.add(ref);
      listedInputs.push({
        ref,
        unit: listing.unit,
        label: ctx.resolveAsset(listing.unit).name,
        priceLovelace: BigInt(listing.datum.price),
      });
    }
  }

  let createdListingCount = 0;
  if (ctx.listingScriptHashes.size > 0) {
    for (const output of outputs) {
      const hash = paymentScriptHash(output.address);
      if (hash && ctx.listingScriptHashes.has(hash.toLowerCase())) createdListingCount += 1;
    }
  }
  return { listedInputs, createdListingCount };
}

export function buildTxApprovalSummary(tx: Cardano.Tx, ctx: ApprovalContext): TxApprovalSummary {
  const body = tx.body;

  const classify = (address: string): ApprovalOutputKind => {
    if (ctx.changeAddresses.has(address)) return 'change';
    if (ctx.paymentAddresses.has(address)) return 'payment';
    return 'external';
  };

  const toOutput = (o: Cardano.TxOut): ApprovalOutput => {
    const address = String(o.address);
    const kind = classify(address);
    const lovelace = BigInt(o.value?.coins ?? 0n);
    const assets: ApprovalAsset[] = entries(o.value?.assets).map(([unit, quantity]) => {
      const info = ctx.resolveAsset(unit);
      const raw = String(quantity);
      return { unit, label: info.name, quantity: raw, formattedQuantity: formatTokenQuantity(raw, info.decimals) };
    });
    return { address, ada: formatLovelace(lovelace), lovelace, kind, isOwn: kind !== 'external', assets };
  };

  const outputs = (body.outputs ?? []).map(toOutput);
  const feeLovelace = BigInt(body.fee ?? 0n);

  const withdrawals: ApprovalWithdrawal[] = (body.withdrawals ?? []).map((w) => {
    const lovelace = BigInt(w.quantity ?? 0n);
    const rewardAccount = String(w.stakeAddress);
    return { rewardAccount, ada: formatLovelace(lovelace), lovelace, isOwn: ctx.ownRewardAccounts.has(rewardAccount) };
  });

  let depositsPaidLovelace = 0n;
  let ownRefundsLovelace = 0n;
  const certificates: ApprovalCertificate[] = ((body.certificates ?? []) as Cardano.Certificate[]).map((cert) => {
    const row: ApprovalCertificate = {
      type: cert.__typename as Cardano.CertificateType,
      stakeCredentialIsOwn: null,
    };
    const stakeHash = stakeCredentialHash(cert);
    if (stakeHash !== null) row.stakeCredentialIsOwn = ctx.ownStakeKeyHashes.has(stakeHash);
    if ('poolId' in cert && cert.poolId) row.poolId = String(cert.poolId);
    if (cert.__typename === Cardano.CertificateType.PoolRegistration) {
      const params = (cert as Cardano.PoolRegistrationCertificate).poolParameters;
      if (params?.id) row.poolId = String(params.id);
      if (params?.rewardAccount) row.refundAccount = String(params.rewardAccount);
    }
    const deposit = certificateDeposit(cert, ctx.deposits);
    if (deposit) {
      row.depositAda = formatLovelace(deposit.lovelace);
      row.depositDirection = deposit.direction;
      const toWallet = refundIsOwn(cert, ctx, row.stakeCredentialIsOwn);
      if (deposit.direction === 'paid') {
        depositsPaidLovelace += deposit.lovelace;
        row.refundIsOwn = toWallet;
      } else if (toWallet === true) {
        ownRefundsLovelace += deposit.lovelace;
      }
    }
    if ('dRep' in cert && cert.dRep) {
      const drep = cert.dRep as Cardano.DelegateRepresentative;
      if (Cardano.isDRepAlwaysAbstain(drep)) row.drepSentinel = 'alwaysAbstain';
      else if (Cardano.isDRepAlwaysNoConfidence(drep)) row.drepSentinel = 'alwaysNoConfidence';
      else if (Cardano.isDRepCredential(drep)) {
        try {
          row.drepId = String(Cardano.DRepID.cip129FromCredential(drep));
        } catch {
          row.drepId = String(drep.hash);
        }
      }
    }
    return row;
  });

  const mints: ApprovalMint[] = entries(body.mint).map(([unit, quantity]) => {
    const qty = BigInt(String(quantity));
    const info = ctx.resolveAsset(unit);
    const abs = qty < 0n ? -qty : qty;
    return { label: info.name, formattedQuantity: formatTokenQuantity(abs.toString(), info.decimals), isBurn: qty < 0n };
  });

  const votes: ApprovalVote[] = (body.votingProcedures ?? []).map(({ voter, votes: voterVotes }) => {
    const voterHash = String(voter.credential.hash);
    const isOwnVoter =
      (voter.__typename === Cardano.VoterType.dRepKeyHash && ctx.ownDrepKeyHashes.has(voterHash)) ||
      (voter.__typename === Cardano.VoterType.ccHotKeyHash && ctx.ownCcHotKeyHashes.has(voterHash));
    return {
      voterType: voter.__typename,
      voterHash,
      isOwnVoter,
      actions: voterVotes.map((v) => ({
        txId: String(v.actionId.id),
        index: v.actionId.actionIndex,
        vote: voteChoice(v.votingProcedure.vote),
      })),
    };
  });

  const proposals: ApprovalProposal[] = (body.proposalProcedures ?? []).map((p) => {
    const rewardAccount = String(p.rewardAccount);
    depositsPaidLovelace += BigInt(p.deposit ?? 0n);
    return {
      actionType: String(p.governanceAction.__typename),
      depositAda: formatLovelace(BigInt(p.deposit ?? 0n)),
      rewardAccount,
      isOwnRewardAccount: ctx.ownRewardAccounts.has(rewardAccount),
    };
  });

  const collateralCount = (body.collaterals ?? []).length;
  const collateralReturn = body.collateralReturn ? toOutput(body.collateralReturn) : null;
  const totalCollateralAda = body.totalCollateral != null ? formatLovelace(BigInt(body.totalCollateral)) : null;

  const ownUtxoByRef = new Map<string, Cardano.TxOut>();
  for (const [txIn, txOut] of ctx.ownUtxos ?? []) ownUtxoByRef.set(inputRefOf(txIn), txOut);

  // The wallet's own collateral, and what it loses if a script fails: all of
  // it, less what the collateral return gives back to one of its addresses.
  const collateralHeld = (body.collaterals ?? []).map((c) => ownUtxoByRef.get(inputRefOf(c)));
  const ownCollateralLovelace = collateralHeld.reduce((sum, held) => sum + coinsOf(held), 0n);
  const returnedToOwn = collateralReturn?.isOwn ? collateralReturn.lovelace : 0n;
  let collateralAtRiskAda: string | null = null;
  if (collateralCount > 0 && ctx.ownUtxos && collateralHeld.every((held) => !!held)) {
    const atRisk = ownCollateralLovelace - returnedToOwn;
    collateralAtRiskAda = formatLovelace(atRisk < 0n ? 0n : atRisk);
  }
  // Without the wallet's UTxOs, assume the collateral is the wallet's own.
  const holdsOwnCollateral = collateralCount > 0 && (!ctx.ownUtxos || collateralHeld.some((held) => !!held));
  const referenceInputCount = (body.referenceInputs ?? []).length;
  const requiredSigners = (body.requiredExtraSignatures ?? []).map((h) => {
    const keyHash = String(h);
    return {
      keyHash,
      isOwn: ctx.ownPaymentKeyHashes.has(keyHash) || ctx.ownStakeKeyHashes.has(keyHash)
        || ctx.ownDrepKeyHashes.has(keyHash) || ctx.ownCcHotKeyHashes.has(keyHash),
    };
  });

  const hasMetadata = !!body.auxiliaryDataHash;
  const validityStartSlot = body.validityInterval?.invalidBefore != null ? Number(body.validityInterval.invalidBefore) : null;
  const ttlSlot = body.validityInterval?.invalidHereafter != null ? Number(body.validityInterval.invalidHereafter) : null;

  const bodyNetworkMismatch = ctx.walletNetworkId !== null && body.networkId !== undefined && body.networkId !== ctx.walletNetworkId;
  const outputNetworkMismatch = ctx.walletNetworkId !== null
    && [...outputs, ...(collateralReturn ? [collateralReturn] : [])].some((o) => {
      const id = addressNetworkId(o.address);
      return id !== null && id !== ctx.walletNetworkId;
    });

  const hasForeignStakeCertificate = certificates.some((c) => c.stakeCredentialIsOwn === false);

  const totalSendingLovelace = outputs.reduce((sum, o) => (o.isOwn ? sum : sum + o.lovelace), 0n);
  const ownWithdrawalLovelace = withdrawals.reduce((sum, w) => (w.isOwn ? sum + w.lovelace : sum), 0n);
  // A treasury donation leaves the wallet like a payment, so it is part of
  // what the user pays and a donating transaction is never "internal".
  const donationLovelace = body.donation != null ? BigInt(body.donation) : 0n;

  // What leaves the wallet. With the wallet's UTxOs known this is exact: its own
  // inputs minus what comes back to its own addresses (deposits, fee and every
  // payment included). Otherwise, or when an input is neither the wallet's nor a
  // script's, estimate from the body: outputs to others, fee, donation and the
  // deposits paid, less only the wallet's own withdrawals and refunds.
  const scriptSpent = scriptSpentInputRefs(tx);
  let ownInputLovelace = 0n;
  let unmatchedInputCount = 0;
  for (const input of body.inputs ?? []) {
    const ref = inputRefOf(input);
    const held = ownUtxoByRef.get(ref);
    if (held) ownInputLovelace += coinsOf(held);
    else if (!scriptSpent.has(ref)) unmatchedInputCount += 1;
  }
  const { listedInputs, createdListingCount } = marketEffects(tx, outputs, ctx);
  const ownOutputLovelace = outputs.reduce((sum, o) => (o.isOwn ? sum + o.lovelace : sum), 0n);
  const youPayLovelace = ctx.ownUtxos && unmatchedInputCount === 0
    ? ownInputLovelace - ownOutputLovelace
    : feeLovelace + totalSendingLovelace + donationLovelace + depositsPaidLovelace - ownWithdrawalLovelace - ownRefundsLovelace;

  const requiresForeignValueAck =
    certificates.some((c) => c.depositDirection === 'paid' && c.refundIsOwn === false)
    || proposals.some((p) => !p.isOwnRewardAccount)
    || (holdsOwnCollateral && !!collateralReturn && !collateralReturn.isOwn);

  const isInternal = outputs.length > 0 && outputs.every((o) => o.isOwn)
    && certificates.length === 0 && mints.length === 0 && collateralCount === 0
    && votes.length === 0 && proposals.length === 0 && withdrawals.every((w) => w.isOwn)
    && donationLovelace === 0n;

  const feeAda = formatLovelace(feeLovelace);
  return {
    outputs,
    feeAda,
    withdrawals,
    certificates,
    mints,
    votes,
    proposals,
    collateralCount,
    collateralReturn,
    totalCollateralAda,
    referenceInputCount,
    requiredSigners,
    hasMetadata,
    validityStartSlot,
    ttlSlot,
    bodyNetworkMismatch,
    outputNetworkMismatch,
    hasForeignStakeCertificate,
    collateralAtRiskAda,
    unmatchedInputCount: ctx.ownUtxos ? unmatchedInputCount : 0,
    requiresForeignValueAck,
    treasuryDonationAda: donationLovelace > 0n ? formatLovelace(donationLovelace) : null,
    listedInputs,
    createsListing: createdListingCount > 0,
    createdListingCount,
    totals: {
      totalSendingAda: formatLovelace(totalSendingLovelace),
      feeAda,
      ownWithdrawalAda: ownWithdrawalLovelace > 0n ? formatLovelace(ownWithdrawalLovelace) : undefined,
      youPayAda: formatLovelace(youPayLovelace < 0n ? 0n : youPayLovelace),
      isInternal,
    },
    isInternal,
  };
}

/** Ownership context from the wallet's derived key set (WalletStore.state.keys). */
export function approvalContextFromKeys(
  keys: {
    payment?: Array<{ address?: string; cred: string }>;
    change?: Array<{ address?: string; cred: string }>;
    stake?: Array<{ address?: string; cred: string }>;
    drep105?: Array<{ cred: string }>;
    drep129?: Array<{ cred: string }>;
    ccHot?: Array<{ cred: string }>;
  } | null | undefined,
  walletNetworkId: Cardano.NetworkId | null,
  resolveAsset: (unit: string) => ApprovalAssetInfo,
  extras: { ownUtxos?: readonly Cardano.Utxo[]; deposits?: ApprovalDeposits; market?: ApprovalMarketContext } = {},
): ApprovalContext {
  const addrs = (list?: Array<{ address?: string }>) => new Set((list ?? []).map((k) => k.address).filter((a): a is string => !!a));
  const creds = (...lists: Array<Array<{ cred: string }> | undefined>) =>
    new Set(lists.flatMap((l) => (l ?? []).map((k) => String(k.cred).toLowerCase())));
  return {
    paymentAddresses: addrs(keys?.payment),
    changeAddresses: addrs(keys?.change),
    ownPaymentKeyHashes: creds(keys?.payment, keys?.change),
    ownStakeKeyHashes: creds(keys?.stake),
    ownRewardAccounts: addrs(keys?.stake),
    ownDrepKeyHashes: creds(keys?.drep105, keys?.drep129),
    ownCcHotKeyHashes: creds(keys?.ccHot),
    walletNetworkId,
    resolveAsset,
    ownUtxos: extras.ownUtxos,
    deposits: extras.deposits,
    ownListings: extras.market?.ownListings ?? new Map(),
    listingScriptHashes: extras.market?.listingScriptHashes ?? new Set(),
  };
}

/**
 * The market part of the approval context, for a UI context: the wallet's own listings as the
 * store holds them (`walletStore.listedListings`, whose bigint fields are decimal strings outside
 * the worker, so they are revived here) and the script hashes of the network's deployments
 * (`networks.resolveNftMarketDeployments`). Never gated on the `isNftMarketEnabled` flag: the
 * preview applies whatever the flag says, as the signing guard does. A malformed stored row is
 * skipped; with nothing stored and no deployments both parts are empty and the summary is as
 * it was before the market existed.
 */
export function approvalMarketContext(
  listedListings: unknown,
  deployments: ReadonlyArray<{ scriptHash: string }>,
): ApprovalMarketContext {
  return {
    ownListings: new Map(reviveOwnListings(listedListings).map((listing) => [listing.ref.toLowerCase(), listing])),
    listingScriptHashes: new Set(deployments.map((deployment) => deployment.scriptHash.toLowerCase())),
  };
}

/** Protocol deposits from the epoch parameters, whatever form they arrive in. */
export function approvalDepositsFrom(
  params: { stakeKeyDeposit?: unknown; poolDeposit?: unknown } | null | undefined,
): ApprovalDeposits {
  const toLovelace = (value: unknown): bigint | undefined => {
    if (value == null || value === '') return undefined;
    try {
      return BigInt(String(value));
    } catch {
      return undefined;
    }
  };
  return { stakeKey: toLovelace(params?.stakeKeyDeposit), pool: toLovelace(params?.poolDeposit) };
}

/** TransactionDetailsCard props for a summary (outputs, own withdrawals, totals). */
export function toTransactionDetailsCardProps(summary: TxApprovalSummary, truncate: (value: string) => string) {
  const outputs = summary.outputs.map((o) => ({
    kind: (o.kind === 'external' ? 'external' : o.kind === 'change' ? 'change' : 'own') as 'external' | 'change' | 'own',
    truncatedAddress: truncate(o.address),
    ada: o.ada,
    assets: o.assets.map((a) => ({ unit: a.unit, label: a.label, formattedQuantity: a.formattedQuantity })),
    // Always +N regardless of count; names live in the tooltip.
    assetPillLabel: o.assets.length > 0 ? `+${o.assets.length}` : '',
  }));
  const own = summary.withdrawals.filter((w) => w.isOwn);
  const withdrawal = summary.totals.ownWithdrawalAda && own.length > 0
    ? { truncatedStakeAddress: truncate(own[0].rewardAccount), ada: summary.totals.ownWithdrawalAda }
    : null;
  return {
    outputs,
    withdrawal,
    totals: {
      totalSendingAda: summary.totals.totalSendingAda,
      feeAda: summary.totals.feeAda,
      withdrawalAda: summary.totals.ownWithdrawalAda,
      youPayAda: summary.totals.youPayAda,
      isInternal: summary.totals.isInternal,
    },
  };
}
