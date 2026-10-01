import { Cardano } from '@cardano-sdk/core';

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

function voteChoice(vote: Cardano.Vote): ApprovalVoteChoice {
  if (vote === Cardano.Vote.yes) return 'yes';
  if (vote === Cardano.Vote.no) return 'no';
  return 'abstain';
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

  const certificates: ApprovalCertificate[] = ((body.certificates ?? []) as Cardano.Certificate[]).map((cert) => {
    const row: ApprovalCertificate = {
      type: cert.__typename as Cardano.CertificateType,
      stakeCredentialIsOwn: null,
    };
    const stakeHash = stakeCredentialHash(cert);
    if (stakeHash !== null) row.stakeCredentialIsOwn = ctx.ownStakeKeyHashes.has(stakeHash);
    if ('poolId' in cert && cert.poolId) row.poolId = String(cert.poolId);
    if ('deposit' in cert && cert.deposit != null) row.depositAda = formatLovelace(BigInt(cert.deposit as unknown as bigint));
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
  const youPayLovelace = feeLovelace + totalSendingLovelace - ownWithdrawalLovelace;

  const isInternal = outputs.length > 0 && outputs.every((o) => o.isOwn)
    && certificates.length === 0 && mints.length === 0 && collateralCount === 0
    && votes.length === 0 && proposals.length === 0 && withdrawals.every((w) => w.isOwn);

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
  };
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
