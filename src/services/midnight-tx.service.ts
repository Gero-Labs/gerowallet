/**
 * Midnight transaction orchestration (browser/options context).
 *
 * Three pipelines coexist here:
 *
 *  - Unshielded NIGHT transfer: Nexus builds the unproven tx (NIGHT UTxO
 *    selection + offer + change — public data, indexer view is canonical).
 *    BG then DUST-balances + signs (needs the user's real dust secret +
 *    NightExternal key) and proves the one proof it needs, the DUST fee: on
 *    this device in Gero Cloud mode (midnightDeviceProver.ts), else on the
 *    user's proof server. Nexus's `/tx/submit-proven` relays the finished,
 *    witness-free tx. (Gero Cloud's `/tx/submit` → sidecar `/tx/finalize`,
 *    which receives the DUST secret, is left only for an unsealed tx a dapp
 *    submits itself.)
 *
 *  - Shielded transfer: wallet owns the entire pre-prove pipeline (notes are
 *    encrypted to the user's Zswap key; nobody else can see them). BG builds
 *    + balances + signs; in Gero Cloud mode Nexus proves + submits
 *    (`/tx/prove-and-submit`, consent-gated) unless the
 *    `isMidnightShieldedDeviceProvingEnabled` flag proves it here.
 *
 *  - DUST registration (Path A — NIGHT-for-DUST): server builds with a
 *    throwaway dust secret (first-time registration is fee-free), BG signs
 *    the single intent segment, Nexus splices + submits. See bottom of file.
 *
 */

import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { StaleApprovalError } from '@/shared/composables/useApprovalFreshness';
import { getMidnightApi } from '@/api/midnight-api';
import { midnightStore } from '@/stores/midnightStore';
import { assertNativeNightConversionSupported, validateShieldedTokenType } from '@/chains/midnight/midnightTokenCapabilities';
import {
  resolveProvingTarget,
  walletProverFor,
  type ProvingUnconfiguredTarget,
  type WalletProver,
  type WalletProvingRequest,
} from '@/chains/midnight/midnightProvingTarget';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { hasMidnightProvingConsent, type MidnightRemoteProver } from '@/chains/midnight/midnightProvingConsent';
import type {
  BuildMidnightTxRequest,
  MidnightSegmentToSign,
  MidnightTxOutput,
  SubmitMidnightTxResponse,
} from '@/api/midnight-api';
import i18n from '@/plugins/i18n';
import {
  MIDNIGHT_BUILT_TX_LEDGER_UNSUPPORTED,
  MIDNIGHT_BUILT_TX_MISMATCH,
  MIDNIGHT_BUILT_TX_UNREADABLE,
  type MidnightBuiltTxRefusal,
} from '@/chains/midnight/midnightBuiltTxGuard';
import { MIDNIGHT_LEDGER_CHANGED, MIDNIGHT_LEDGER_UNKNOWN } from '@/chains/midnight/midnightLedger';
import { isMidnightApiError, type MidnightApiErrorKind } from '@/api/midnightApiError';
import { assertMidnightWritesOpen } from '@/chains/midnight/midnightWriteStatus';
import { submitWithBusyRetry, type BusyRetryOptions, type MidnightBusyHandlers } from './midnightBusyRetry';

export interface SignedSegment {
  index: number;
  signatureHex: string;
}

export interface MidnightSendCredentials {
  password?: string;
  /** Raw PRF output bytes from a WebAuthn ceremony (PRF/PassKey wallets). */
  prfSecret?: Uint8Array;
}

function assertCurrentApproval(current: () => boolean): void {
  if (!current()) throw new StaleApprovalError();
}

const BUILT_TX_REFUSAL_COPY: Record<MidnightBuiltTxRefusal, string> = {
  [MIDNIGHT_BUILT_TX_MISMATCH]: 'txGuard.builtTxMismatch',
  [MIDNIGHT_BUILT_TX_UNREADABLE]: 'txGuard.builtTxUnreadable',
  [MIDNIGHT_BUILT_TX_LEDGER_UNSUPPORTED]: 'midnight.errors.updateRequired',
};

/**
 * The background refused to sign a transaction Nexus built, before signing
 * anything. `code` says why: it does not match the request, it cannot be read,
 * or it is for a newer ledger than this build signs with.
 */
export class MidnightBuiltTxRefusedError extends Error {
  readonly code: MidnightBuiltTxRefusal;
  constructor(code: MidnightBuiltTxRefusal) {
    super(String(i18n.t(BUILT_TX_REFUSAL_COPY[code])));
    this.name = 'MidnightBuiltTxRefusedError';
    this.code = code;
  }
}

/** The chain's ledger couldn't be read, or changed while the transaction was prepared. */
const LEDGER_REFUSAL_COPY: Record<string, string> = {
  [MIDNIGHT_LEDGER_UNKNOWN]: 'midnight.errors.ledgerUnknown',
  [MIDNIGHT_LEDGER_CHANGED]: 'midnight.errors.ledgerMismatch',
};

/**
 * The wallet SDK's fee-balancing shortfall: `InsufficientFundsError` names the
 * token it could not balance, and the DUST fee's is `dust`. Exactly that message,
 * so a shortfall of NIGHT or another token (which names its token type) keeps its
 * own message.
 */
const DUST_SHORTFALL = /^Insufficient Funds: could not balance dust$/;

/** Say a background refusal in the user's language. Other errors pass through. */
export function backgroundError(error: string | undefined, fallback: string): Error {
  if (error && Object.prototype.hasOwnProperty.call(BUILT_TX_REFUSAL_COPY, error)) {
    return new MidnightBuiltTxRefusedError(error as MidnightBuiltTxRefusal);
  }
  if (error && Object.prototype.hasOwnProperty.call(LEDGER_REFUSAL_COPY, error)) {
    return new Error(String(i18n.t(LEDGER_REFUSAL_COPY[error])));
  }
  // Whichever wallet pays the fee, the sender's own or a sponsor: the copy names neither.
  if (error && DUST_SHORTFALL.test(error.trim())) {
    return new Error(String(i18n.t('midnight.errors.dustInsufficient')));
  }
  return new Error(error || fallback);
}

/**
 * High-level stages of an unshielded send, in order. Drives the send
 * dialog's progress timeline. The `working` stage is the single BG
 * balance+sign round-trip; the dialog splits it into "sync DUST" vs "sign"
 * using the live `midnightStore.sendProgress` percentage the BG broadcasts.
 *
 * `provingDevice` / `provingLocal` / `provingZkpaas` follow `working` when
 * the wallet proves the tx itself: on this device (Gero Cloud mode), on the
 * local proof server (WP-P2) or via Arkhia zkPaaS. The single BG round-trip
 * then includes the ZK-proving step (6-25 s for a DUST fee, a minute or more
 * for a private send) rather than only the comparatively fast build+sign.
 * Distinct stages so the timeline can honestly say WHERE the proof is made.
 */
export type MidnightSendStage =
  | 'authorizing'
  | 'building'
  | 'working'
  | 'provingDevice'
  | 'provingLocal'
  | 'provingZkpaas'
  | 'submitting'
  // The submit request also proves: Gero Cloud proves the transaction on the way through.
  | 'provingCloud'
  // Gero Cloud answered busy (503 MIDNIGHT_PROVER_BUSY): counting down to resubmit the same bytes.
  | 'waiting'
  | 'done';

/**
 * Retrieve publicKeyHex + addressHex via BG. Fast path if already stored in
 * the wallet record; slow path decrypts the mnemonic once and persists.
 * Credentials are only needed for the slow path (legacy wallets).
 */
export async function getWalletKeys(
  credentials: MidnightSendCredentials,
): Promise<{ publicKeyHex: string; addressHex: string }> {
  const response = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.GET_MIDNIGHT_WALLET_KEYS,
    data: {
      password: credentials.password,
      prfSecret: credentials.prfSecret ? Array.from(credentials.prfSecret) : undefined,
    },
  }) as { data: { success: boolean; publicKeyHex?: string; addressHex?: string; error?: string } };

  if (!response?.data?.success || !response.data.publicKeyHex || !response.data.addressHex) {
    throw new Error(response?.data?.error || 'Failed to retrieve Midnight wallet keys');
  }
  return {
    publicKeyHex: response.data.publicKeyHex,
    addressHex: response.data.addressHex,
  };
}

/**
 * Sign intent-hash segments locally via BG (used by DUST registration which
 * still pre-collects a single signature server-side, then submits as a
 * splice). The PRF secret bytes are shipped as a regular array because
 * `chrome.runtime.sendMessage` can't serialise a `Uint8Array` directly.
 */
export async function signSegments(
  segments: MidnightSegmentToSign[],
  credentials: MidnightSendCredentials,
  unprovenTxHex: string,
  /** The DUST address the registration is for; the background checks Nexus's transaction against it. */
  dustReceiverAddressBech32: string,
): Promise<SignedSegment[]> {
  const response = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SIGN_MIDNIGHT_SEGMENTS,
    data: {
      segments,
      unprovenTxHex,
      dustReceiverAddressBech32,
      password: credentials.password,
      prfSecret: credentials.prfSecret ? Array.from(credentials.prfSecret) : undefined,
    },
  }) as { data: { success: boolean; signatures?: SignedSegment[]; error?: string } };

  if (!response?.data?.success) {
    throw backgroundError(response?.data?.error, 'Midnight signing failed');
  }
  return response.data.signatures ?? [];
}

/** Step 2: Nexus builds the unproven NIGHT-transfer tx. */
async function buildUnshielded(
  network: string,
  request: BuildMidnightTxRequest,
): Promise<{ unprovenTxHex: string; txHash: string }> {
  const api = getMidnightApi(network);
  const built = await api.buildUnshieldedTx(request);
  return { unprovenTxHex: built.unprovenTxHex, txHash: built.txHash };
}

/**
 * Step 3: BG DUST-balances the unproven tx (needs the user's dust secret to
 * derive spend nullifiers) and signs each unshielded input. Returns the
 * signed-but-unproven hex ready for the sidecar's prove+submit step. With `proving`, BG
 * also proves + binds locally and can then name the tx's ledger hash.
 */
async function balanceAndSignInBg(
  unprovenTxHex: string,
  ttlMs: number,
  intendedOutputs: readonly MidnightTxOutput[],
  credentials: MidnightSendCredentials,
  sponsor?: MidnightSponsor,
  proving?: WalletProvingRequest,
): Promise<SignedInBg> {
  const response = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.BALANCE_AND_SIGN_MIDNIGHT_UNSHIELDED_TX,
    data: {
      unprovenTxHex,
      ttlMs,
      // What was asked of Nexus: the background signs only a transaction that is exactly this.
      intendedOutputs: intendedOutputs.map(({ address, amount, token }) => ({ address, amount, token })),
      proving,
      password: credentials.password,
      prfSecret: credentials.prfSecret ? Array.from(credentials.prfSecret) : undefined,
      // Uint8Array can't cross Chrome messaging; the sponsor's PRF output goes
      // as a plain array, same as the sender's above.
      sponsor: sponsor
        ? {
          walletId: sponsor.walletId,
          password: sponsor.password,
          prfSecret: sponsor.prfSecret ? Array.from(sponsor.prfSecret) : undefined,
        }
        : undefined,
    },
  }) as { data: SignedInBgReply };

  if (!response?.data?.success || !response.data.signedTxHex) {
    throw backgroundError(response?.data?.error, 'Midnight balance/sign failed');
  }
  if (proving && !response.data.proven) throw new Error('Wallet-side proving requested but BG returned an unproven tx');
  return signedInBg(response.data);
}

/** What the background hands back for a built, signed (and maybe proven) tx. */
interface SignedInBg {
  signedTxHex: string;
  proven: boolean;
  ledgerTxHash?: string;
  /** Ledger identifiers, to find the tx on chain if the submit reply is lost. */
  txIdentifiers?: string[];
}

type SignedInBgReply = Partial<SignedInBg> & { success: boolean; error?: string };

function signedInBg(data: SignedInBgReply): SignedInBg {
  return {
    signedTxHex: data.signedTxHex ?? '',
    proven: !!data.proven,
    ledgerTxHash: data.ledgerTxHash,
    txIdentifiers: Array.isArray(data.txIdentifiers) ? data.txIdentifiers.filter((id) => typeof id === 'string') : undefined,
  };
}

/**
 * Step 4: POST the tx to Nexus. A proven tx goes to `/tx/submit-proven`
 * (relayed as is); a signed-but-unproven one (the one-off Gero Cloud
 * fallback) to `/tx/submit`, whose sidecar `/tx/finalize` proves + binds +
 * submits. Either way a lost reply is settled by finding the tx on chain, and
 * a busy prover (503 MIDNIGHT_PROVER_BUSY) gets the same bytes again
 * (midnightBusyRetry.ts).
 */
async function submitSignedTx(
  network: string,
  signed: SignedInBg,
  waitFor: 'Submitted' | 'InBlock' | 'Finalized' = 'InBlock',
  busy: Omit<BusyRetryOptions, 'sleep' | 'now'> = {},
): Promise<SubmitMidnightTxResponse> {
  const api = getMidnightApi(network);
  const watch = { identifiers: signed.txIdentifiers };
  return submitWithBusyRetry(() => (signed.proven
    ? api.submitProvenMidnightTx({ signedTxHex: signed.signedTxHex, waitFor }, watch)
    : api.submitMidnightTx({ signedTxHex: signed.signedTxHex, waitFor }, watch)), busy);
}

/**
 * Attach the ledger hash the wallet's own prover produced when the relay did
 * not report one. Exactly one side ever has it: the sidecar on the remote
 * paths (`/tx/submit`, `/tx/prove-and-submit`), the wallet on the proven path
 * (`/tx/submit-proven` forwards the bytes unparsed). A Nexus that predates the
 * field leaves the remote result without one — callers then fall back to the
 * extrinsic hash (see historyHashForSubmittedTx).
 */
function withLedgerTxHash(result: SubmitMidnightTxResponse, local: string | undefined): SubmitMidnightTxResponse {
  const ledgerTxHash = result.ledgerTxHash || local;
  return ledgerTxHash ? { ...result, ledgerTxHash } : result;
}

/**
 * Orchestrate the four-step unshielded NIGHT transfer:
 *   1. getWalletKeys      → publicKeyHex + addressHex
 *   2. buildUnshielded    → Nexus builds unproven NIGHT tx
 *   3. balanceAndSignInBg → BG adds DUST fee inputs, signs each input and
 *                           proves the fee (this device / the user's server)
 *   4. submitSignedTx     → Nexus relays the finished tx (/tx/submit-proven)
 */
/**
 * Another wallet the user owns, paying this transaction's DUST fee.
 *
 * The credential is that wallet's own — never the sender's — and is used once
 * in the background to derive a DUST seed. Nothing is retained between sends.
 */
export interface MidnightSponsor {
  readonly walletId: number;
  readonly password?: string;
  readonly prfSecret?: Uint8Array;
}

export async function sendUnshieldedNight(
  network: string,
  baseRequest: Omit<BuildMidnightTxRequest, 'publicKeyHex' | 'addressHex'>,
  credentials: MidnightSendCredentials,
  onStage?: (stage: MidnightSendStage) => void,
  sponsor?: MidnightSponsor,
  forceRemote = false,
  current: () => boolean = () => true,
  /** Countdown and still-busy prompt when Gero Cloud is busy (midnightBusyRetry.ts). */
  busy: MidnightBusyHandlers = {},
): Promise<SubmitMidnightTxResponse> {
  assertCurrentApproval(current);
  // Sends on a paused network stop here, before keys or the build (midnightWriteGate.ts).
  await assertMidnightWritesOpen(network);
  assertCurrentApproval(current);
  const target = resolveWalletProvingTarget(network, 'unshielded', forceRemote);
  assertWalletProving(target);
  if (target && target.prover !== 'device') await assertProverReachable(target, current);
  assertCurrentApproval(current);
  onStage?.('authorizing');
  const { publicKeyHex, addressHex } = await getWalletKeys(credentials);
  assertCurrentApproval(current);
  onStage?.('building');
  const built = await buildUnshielded(network, { ...baseRequest, publicKeyHex, addressHex });
  assertCurrentApproval(current);
  onStage?.('working');
  // On this device the fee proof follows the DUST sync and signing inside the
  // same BG call, which reports it through `sendProgress` (phase 'proving'),
  // so the timeline keeps its sync and sign steps.
  if (target && target.prover !== 'device') onStage?.(target.stage);
  const signed = await balanceAndSignInBg(
    built.unprovenTxHex, baseRequest.ttlMs, baseRequest.outputs, credentials, sponsor, target?.request,
  );
  assertCurrentApproval(current);
  // An unproven transaction is proved by Gero Cloud inside the submit request.
  // While Gero Cloud is busy the timeline waits, then proves again on each resubmit.
  const attemptStage: MidnightSendStage = signed.proven ? 'submitting' : 'provingCloud';
  onStage?.(attemptStage);
  const result = await submitSignedTx(network, signed, 'InBlock', {
    ...busy,
    ttlMs: baseRequest.ttlMs,
    isCurrent: current,
    onWait: () => onStage?.('waiting'),
    onAttempt: () => onStage?.(attemptStage),
  });
  onStage?.('done');
  return withLedgerTxHash(result, signed.ledgerTxHash);
}

/**
 * DApp-connector `makeTransfer`: build, DUST-balance and sign the unshielded
 * transfer, and do NOT submit. Proving follows the user's own preference,
 * exactly like a dashboard send, and the wallet always seals the tx here:
 *   - Gero Cloud mode: the DUST fee is proven on this device.
 *   - local / zkPaaS: proven on that server.
 * The dapp gets a sealed tx and its `submitTransaction` goes to
 * `/tx/submit-proven`; no proving data reaches Gero. (On Stagenet, which this
 * device cannot prove, Gero Cloud mode still returns an unproven tx and the
 * approval UI requires the user's Gero Cloud consent first.)
 * An unusable local/zkPaaS preference throws ProofServerUnreachableError
 * rather than silently falling back to Gero Cloud.
 */
export async function buildAndSignUnshieldedTransfer(
  network: string,
  baseRequest: Omit<BuildMidnightTxRequest, 'publicKeyHex' | 'addressHex'>,
  credentials: MidnightSendCredentials,
  /** The prover the user approved this transfer for; the build refuses if it changed. */
  expectedProver?: WalletProver,
  current: () => boolean = () => true,
): Promise<{ tx: string }> {
  assertCurrentApproval(current);
  await assertMidnightWritesOpen(network);
  assertCurrentApproval(current);
  const target = resolveWalletProvingTarget(network, 'unshielded');
  assertWalletProving(target, expectedProver);
  if (target && target.prover !== 'device') await assertProverReachable(target, current);
  assertCurrentApproval(current);
  const { publicKeyHex, addressHex } = await getWalletKeys(credentials);
  assertCurrentApproval(current);
  const built = await buildUnshielded(network, { ...baseRequest, publicKeyHex, addressHex });
  assertCurrentApproval(current);
  const { signedTxHex } = await balanceAndSignInBg(
    built.unprovenTxHex, baseRequest.ttlMs, baseRequest.outputs, credentials, undefined, target?.request,
  );
  assertCurrentApproval(current);
  return { tx: signedTxHex };
}

/**
 * DApp-connector `balanceUnsealedTransaction`: the background funds,
 * fee-pays, signs and SEALS the dapp's proven, unbound tx. The dapp submits
 * the returned hex through the connector's own `submitTransaction`, which
 * routes a sealed tx to Nexus's submit-proven relay.
 */
export async function balanceConnectorTransaction(
  network: string,
  tx: string,
  credentials: MidnightSendCredentials,
  current: () => boolean = () => true,
): Promise<{ tx: string }> {
  assertCurrentApproval(current);
  // Paused for a network upgrade (midnightWriteGate.ts): stop before keys, as makeTransfer does.
  await assertMidnightWritesOpen(network);
  assertCurrentApproval(current);
  const response = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.BALANCE_MIDNIGHT_CONNECTOR_TX,
    data: {
      tx,
      password: credentials.password,
      prfSecret: credentials.prfSecret ? Array.from(credentials.prfSecret) : undefined,
    },
  }) as { data: { success: boolean; tx?: string; error?: string } };
  assertCurrentApproval(current);
  if (!response?.data?.success || !response.data.tx) {
    throw backgroundError(response?.data?.error, 'Midnight balancing failed');
  }
  return { tx: response.data.tx };
}

/**
 * DApp-connector `makeIntent`: the background builds the approved swap intent
 * from `request` (the dapp's validated request, as the approval showed it),
 * re-validating it first, and returns it sealed.
 */
export async function buildConnectorIntent(
  network: string,
  request: { desiredInputs: unknown; desiredOutputs: unknown; options: unknown },
  credentials: MidnightSendCredentials,
  current: () => boolean = () => true,
): Promise<{ tx: string }> {
  assertCurrentApproval(current);
  // Paused for a network upgrade (midnightWriteGate.ts): stop before keys, as makeTransfer does.
  await assertMidnightWritesOpen(network);
  assertCurrentApproval(current);
  const response = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.BUILD_MIDNIGHT_CONNECTOR_INTENT,
    data: {
      ...request,
      password: credentials.password,
      prfSecret: credentials.prfSecret ? Array.from(credentials.prfSecret) : undefined,
    },
  }) as { data: { success: boolean; tx?: string; error?: string; code?: string } };
  assertCurrentApproval(current);
  if (!response?.data?.success || !response.data.tx) {
    // `code` is a connector error code (InsufficientFunds) the panel relays on decline.
    // A ledger refusal (MIDNIGHT_LEDGER_UNKNOWN) is said in the user's language, as on a send.
    throw Object.assign(backgroundError(response?.data?.error, 'Building the intent failed'), { code: response?.data?.code });
  }
  return { tx: response.data.tx };
}

/**
 * Optimistically insert a just-submitted tx into the store as `pending` so it
 * shows in history immediately, before gero-sync indexes and pushes it back.
 * Best-effort: a failure here is silent (gero-sync backfills the confirmed
 * entry regardless, and its hash-normalized dedup replaces this pending row).
 */
export async function addPendingMidnightTx(
  hash: string,
  amount: bigint,
  counterparty: string,
  isShielded: boolean,
  token: string = 'NIGHT',
  /** The sending wallet's unshielded address: the background records the row only for that wallet. */
  fromAddress?: string,
  /**
   * Whether `hash` is the ledger hash (the one the indexer and the history feed
   * know). The submit routes return the extrinsic hash as `txHash` and the
   * ledger hash, best effort, as `ledgerTxHash`; a row keyed by the extrinsic
   * hash can't be looked up or matched later.
   */
  ledgerHash = false,
): Promise<void> {
  try {
    await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.ADD_MIDNIGHT_PENDING_TX,
      data: { hash, amount: amount.toString(), counterparty, isShielded, token, fromAddress, ledgerHash },
    });
  } catch {
    /* optimistic-only — gero-sync will deliver the confirmed entry anyway */
  }
}

// ─── Shielded NIGHT send ──────────────────────────────────────────────────────

/**
 * Shielded recipient + amount. A shielded asset requires its explicit token color.
 * Outputs are serialised as decimal strings on the wire because Chrome
 * messaging can't carry BigInt; BG re-parses to bigint.
 */
export interface ShieldedTransferOutput {
  receiverAddress: string;
  amount: bigint;
  tokenType?: string;
}

/**
 * BG builds + signs the shielded tx (mnemonic decrypt → ZswapSecretKeys →
 * ShieldedWallet.transferTransaction). Without `proving`, returns a
 * signed-but-unproven hex and caller MUST already hold user consent for
 * sending the witness data through Gero Cloud proving — gate on
 * `midnightStore.shieldedProvingConsent` at the UI layer (Step 5). With
 * `proving` (WP-P2 local mode, or zkPaaS with auth `headers`), BG
 * additionally proves + binds against the given proof server before
 * returning. Consent rule: only `local` skips the cloud consent (witness
 * data never leaves the machine); zkPaaS ships witness data to Arkhia and
 * is consent-gated by the caller exactly like `remote`.
 */
async function buildAndSignShieldedInBg(
  outputs: ReadonlyArray<ShieldedTransferOutput>,
  credentials: MidnightSendCredentials,
  proving?: WalletProvingRequest,
  sponsor?: MidnightSponsor,
): Promise<SignedInBg> {
  const response = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.BUILD_AND_SIGN_MIDNIGHT_SHIELDED_TX,
    data: {
      outputs: outputs.map((o) => ({
        receiverAddress: o.receiverAddress,
        amount: o.amount.toString(),
        tokenType: o.tokenType,
      })),
      password: credentials.password,
      prfSecret: credentials.prfSecret ? Array.from(credentials.prfSecret) : undefined,
      proving,
      sponsor: sponsor ? {
        walletId: sponsor.walletId, password: sponsor.password,
        prfSecret: sponsor.prfSecret ? Array.from(sponsor.prfSecret) : undefined,
      } : undefined,
    },
  }) as { data: SignedInBgReply };

  if (!response?.data?.success || !response.data.signedTxHex) {
    throw backgroundError(response?.data?.error, 'Midnight shielded build/sign failed');
  }
  return signedInBg(response.data);
}

/**
 * Thrown by {@link sendShieldedNight} when the selected wallet-side proof
 * server (local docker or Arkhia zkPaaS) failed its preflight — the health
 * check didn't answer within the timeout, or zkPaaS is selected without a
 * usable API key/endpoint. Distinct from a generic `Error` so the send
 * dialog (WP-P5) can render the two-action fallback ("Open settings" /
 * "Use Gero Cloud for this transaction") instead of a generic failure toast.
 */
export class ProofServerUnreachableError extends Error {
  /**
   * @param reason Why the configured prover was refused before any health
   *   check ran, when that is what happened. Set only for the `unconfigured`
   *   resolver outcomes: `zkpaas-unconfigured` (no API key and no override
   *   URL) and `local-profile-mismatch` (a local server started for the other
   *   ledger line — running and answering, just not for this network). Omitted
   *   when a server was actually contacted and failed its health check. The
   *   send dialog keys its fallback copy off this so a profile mismatch says
   *   "switch the profile" rather than "start the server". Never set for Gero
   *   Cloud: `remote` mode resolves to `{ kind: 'cloud' }` and does not reach
   *   this error at all.
   */
  constructor(
    public readonly url: string,
    public readonly reason?: ProvingUnconfiguredTarget['reason'],
  ) {
    super('Proof server not reachable or incompatible with the selected network');
    this.name = 'ProofServerUnreachableError';
  }
}

/** A resolved wallet-side prover: what the background is asked to prove with. */
type WalletProvingTarget =
  | { prover: 'device'; request: { device: true }; stage: 'provingDevice' }
  | {
    prover: 'local' | 'zkpaas';
    request: { url: string; headers?: Record<string, string> };
    stage: 'provingLocal' | 'provingZkpaas';
    lenientHealth: boolean;
  };

/**
 * Whether private (shielded) sends prove on this device in Gero Cloud mode.
 * Off by default; read in the page, where the flag store lives.
 */
export function shieldedOnDevice(): boolean {
  return featureFlagsStore.isMidnightShieldedDeviceProvingEnabled();
}

/**
 * Which prover a send of `kind` uses right now (`walletProverFor` with the
 * stored preference and the shielded flag). The send dialogs ask this to
 * decide whether a consent notice is needed, so they and the send path can
 * never disagree. `forceRemote` is the one-off fallback from a local or zkPaaS
 * server that did not answer: the send proves as in Gero Cloud mode, which for
 * a public send still means this device.
 */
export function walletProverForSend(network: string, kind: 'unshielded' | 'shielded', forceRemote = false): WalletProver {
  const mode = forceRemote ? 'remote' : midnightStore.proofServer.mode;
  return walletProverFor(network, { mode }, kind, { shieldedOnDevice: shieldedOnDevice() });
}

/**
 * Resolve the send's prover into what the background proves with: this
 * device, or a proof server's base URL (+ Arkhia auth headers for zkPaaS)
 * with the progress stage to surface and how strict the health preflight
 * is. `null` means "prove remotely via Gero Cloud": a private send without
 * the shielded flag, or Stagenet, which this device cannot prove.
 *
 * zkPaaS health is lenient about 404 — the Arkhia gateway relays the
 * native `/prove`/`/check` endpoints but `/health` isn't a documented part
 * of its surface, so "reachable but no health route" must not block sends
 * (see checkProofServerHealth). A zkPaaS selection with no API key and no
 * override URL throws {@link ProofServerUnreachableError} immediately: same
 * fast-fail + same dialog fallback as an unreachable server.
 */
function resolveWalletProvingTarget(
  network: string,
  kind: 'unshielded' | 'shielded',
  forceRemote = false,
): WalletProvingTarget | null {
  const prover = walletProverForSend(network, kind, forceRemote);
  if (prover === 'device') return { prover, request: { device: true }, stage: 'provingDevice' };
  if (prover === 'cloud') return null;
  // `unconfigured` covers both zkPaaS-without-a-key and a local server whose
  // circuit family doesn't match the network (see resolveProvingTarget).
  const target = resolveProvingTarget(network, midnightStore.proofServer);
  if (target.kind === 'unconfigured') {
    throw new ProofServerUnreachableError(target.url, target.reason);
  }
  if (target.kind !== 'server') return null;
  return {
    prover: target.mode,
    request: { url: target.url, headers: target.headers },
    stage: target.mode === 'zkpaas' ? 'provingZkpaas' : 'provingLocal',
    lenientHealth: target.lenientHealth,
  };
}

export type { WalletProver };

function proverOf(target: WalletProvingTarget | null): WalletProver {
  return target ? target.prover : 'cloud';
}

/**
 * Health preflight for a proof server; the device needs none. Callers skip
 * the call (not just its body) when there is nothing to check, so a Gero
 * Cloud or device send reaches the background without an extra await.
 */
async function assertProverReachable(target: WalletProvingTarget | null, current: () => boolean): Promise<void> {
  if (!target || target.prover === 'device') return;
  const { checkProofServerHealth } = await import('@/chains/midnight/midnightLocalProver');
  assertCurrentApproval(current);
  const healthy = await checkProofServerHealth(target.request.url, {
    headers: target.request.headers,
    acceptNotFound: target.lenientHealth,
  });
  assertCurrentApproval(current);
  if (!healthy) throw new ProofServerUnreachableError(target.request.url);
}

/** A remote prover would receive proof inputs the user has not agreed to send it. */
export class ProvingConsentRequiredError extends Error {
  constructor(public readonly provider: MidnightRemoteProver) {
    super(`Proving with ${provider === 'zkpaas' ? 'Arkhia zkPaaS' : 'Gero Cloud'} needs your consent first`);
    this.name = 'ProvingConsentRequiredError';
  }
}

/** The proof-server setting changed between the user's approval and the build. */
export class ProvingPreferenceChangedError extends Error {
  constructor() {
    super('The proof-server setting changed during approval. Review the transaction again.');
    this.name = 'ProvingPreferenceChangedError';
  }
}

/**
 * Last gate before any credential is used to build a transaction that a
 * prover will see (PRIV-01). Consent dialogs run first, but authentication
 * (a PassKey popup) can take a minute and the proof-server setting can change
 * meanwhile, so the decision is re-made here, against the prover this send
 * would actually use:
 *   - `expected` (what the user approved) must still be the prover;
 *   - a remote prover (Gero Cloud, Arkhia zkPaaS) needs its recorded consent.
 *     This device and a local server see nothing leave the machine.
 */
function assertWalletProving(target: WalletProvingTarget | null, expected?: WalletProver): void {
  const prover = proverOf(target);
  if (expected && expected !== prover) throw new ProvingPreferenceChangedError();
  if ((prover === 'cloud' || prover === 'zkpaas') && !hasMidnightProvingConsent(midnightStore.shieldedProvingConsent, prover)) {
    throw new ProvingConsentRequiredError(prover);
  }
}

/**
 * Fast pre-auth preflight for the send/convert dialogs (WP-P5 pattern):
 * `true` when the current proof-server preference can accept a send of `kind`
 * right now — Gero Cloud and this device always can, local/zkpaas must answer
 * their health check and zkPaaS must be configured at all.
 * Never throws; the dialogs turn `false` into the two-action fallback
 * ("Open settings" / "Use Gero Cloud for this transaction") without
 * flashing the full progress timeline for a doomed send.
 */
export async function checkWalletProvingPreflight(network: string, kind: 'unshielded' | 'shielded'): Promise<boolean> {
  let target: WalletProvingTarget | null;
  try {
    target = resolveWalletProvingTarget(network, kind);
  } catch {
    // zkPaaS selected but not configured (no key, no override URL).
    return false;
  }
  if (!target || target.prover === 'device') return true;
  const { checkProofServerHealth } = await import('@/chains/midnight/midnightLocalProver');
  return checkProofServerHealth(target.request.url, {
    headers: target.request.headers,
    acceptNotFound: target.lenientHealth,
  });
}

/**
 * Shielded NIGHT transfer, branching on the user's proof-server preference
 * (`midnightStore.proofServer`, WP-P1):
 *
 *   Remote (default, Gero Cloud; the consent notice names the coin secret key).
 *     1. buildAndSignShieldedInBg → BG produces signed-but-unproven tx hex.
 *        (The "build" step lives in the wallet because shielded notes are
 *        encrypted to the user's Zswap key — no server can see them.)
 *     2. api.proveAndSubmitMidnightTx → Nexus relays to sidecar
 *        /tx/prove-and-submit which proves + binds + submits.
 *     Privacy gate: the caller is responsible for surfacing the consent
 *     dialog (Step 5) before invoking. By the time this function runs, the
 *     user has already accepted that witness data ships to Gero Cloud for
 *     proving.
 *
 *   This device (remote mode with the off-by-default
 *   `isMidnightShieldedDeviceProvingEnabled` flag): as below, minus the
 *   health check; the BG proves the Zswap and DUST circuits here
 *   (midnightDeviceProver.ts), so Gero receives no secret.
 *
 *   Local / zkPaaS (wallet-side proving, see resolveWalletProvingTarget):
 *     1. Preflight the proof server's health; throws
 *        {@link ProofServerUnreachableError} fast rather than starting a
 *        send that would only fail after a long build. Local needs no cloud
 *        consent (witness data never leaves the machine); zkPaaS ships the
 *        witness to Arkhia's TEE service, so callers gate it on the same
 *        consent as remote.
 *     2. buildAndSignShieldedInBg (with `proving`) → BG builds, signs, AND
 *        proves + binds against that server; returns a finalized tx hex.
 *     3. api.submitProvenMidnightTx → Nexus relays to the sidecar's
 *        /tx/submit-proven (WP-P3), which submits WITHOUT re-proving.
 *
 * `forceRemote` (WP-P5): the send dialog's "Use Gero Cloud for this
 * transaction" fallback — offered when the user's stored preference is
 * `local`/`zkpaas` but the server didn't answer its preflight — needs to
 * send exactly one transaction through the remote path WITHOUT flipping the
 * stored `proofServer.mode` (that mode toggle is a deliberate, separate user
 * action in Settings, not an implicit side effect of a one-off fallback).
 * Callers must still gate this on cloud consent themselves, same as the
 * default remote path.
 */
export async function sendShieldedNight(
  network: string,
  outputs: ReadonlyArray<ShieldedTransferOutput>,
  credentials: MidnightSendCredentials,
  waitFor: 'Submitted' | 'InBlock' | 'Finalized' = 'InBlock',
  onStage?: (stage: MidnightSendStage) => void,
  forceRemote = false,
  sponsor?: MidnightSponsor,
  current: () => boolean = () => true,
  /** Countdown and still-busy prompt when Gero Cloud is busy (midnightBusyRetry.ts). */
  busy: MidnightBusyHandlers = {},
): Promise<SubmitMidnightTxResponse> {
  assertCurrentApproval(current);
  if (outputs.length === 0) {
    throw new Error('sendShieldedNight: at least one output is required');
  }
  for (const output of outputs) validateShieldedTokenType(output.tokenType ?? '');
  // The one cheap call the server can refuse, made before the shielded sync and
  // the proving: a fresh status read, then the gate (midnightWriteGate.ts).
  await assertMidnightWritesOpen(network, { refresh: true });
  assertCurrentApproval(current);
  const api = getMidnightApi(network);

  const target = resolveWalletProvingTarget(network, 'shielded', forceRemote);
  assertWalletProving(target);
  if (target) {
    await assertProverReachable(target, current);
    onStage?.(target.stage);
    const signed = await buildAndSignShieldedInBg(outputs, credentials, target.request, sponsor);
    const { signedTxHex, proven, ledgerTxHash } = signed;
    assertCurrentApproval(current);
    if (!proven) {
      // Defensive: the BG only skips proving when `proving` is absent from
      // the request, which it never is on this branch. Should be
      // unreachable — fail loudly rather than silently submit an unproven
      // tx to the submit-proven endpoint.
      throw new Error('Wallet-side proving requested but BG returned an unproven tx');
    }
    onStage?.('submitting');
    const result = await submitWithBusyRetry(
      () => api.submitProvenMidnightTx({ signedTxHex, waitFor }, { identifiers: signed.txIdentifiers }),
      { ...busy, isCurrent: current, onWait: () => onStage?.('waiting'), onAttempt: () => onStage?.('submitting') },
    );
    onStage?.('done');
    return withLedgerTxHash(result, ledgerTxHash);
  }

  onStage?.('working');
  const { signedTxHex, txIdentifiers } = await buildAndSignShieldedInBg(outputs, credentials, undefined, sponsor);
  assertCurrentApproval(current);
  // Gero Cloud proves inside this request; a busy prover gets the same bytes again.
  onStage?.('provingCloud');
  const result = await submitWithBusyRetry(
    () => api.proveAndSubmitMidnightTx({ signedTxHex, waitFor }, { identifiers: txIdentifiers }),
    { ...busy, isCurrent: current, onWait: () => onStage?.('waiting'), onAttempt: () => onStage?.('provingCloud') },
  );
  onStage?.('done');
  return result;
}

// ─── Shield conversion (public NIGHT -> private NIGHT) ───────────────────────
//
// WP-SH4. Unshield
// (private -> public) is intentionally NOT wired here yet — ground rule 16:
// no real shield has succeeded on-chain yet, so there is
// nothing to unshield to test against.

/** Compatibility entry point: fail before credentials or network calls. */
export async function shieldNight(
  _network: string,
  _amount: bigint,
  _credentials: MidnightSendCredentials,
  _waitFor: 'Submitted' | 'InBlock' | 'Finalized' = 'InBlock',
  _onStage?: (stage: MidnightSendStage) => void,
  _forceRemote = false,
): Promise<SubmitMidnightTxResponse> {
  return assertNativeNightConversionSupported();
}

/**
 * Result of native NIGHT registration for DUST generation. `submitted`: the
 * server took the transaction; it is not registered until the chain shows it
 * (the dialog keeps a pending state until then, midnightDustRegistrationPending.ts).
 */
export type DustRegistrationStatus = 'submitted' | 'no_night_utxos' | 'failed';

export interface DustRegistrationOutcome {
  status: DustRegistrationStatus;
  /** Present on `submitted`. */
  txHash?: string;
  /** Present on `submitted`: how far the server saw it go (`Submitted`, `InBlock`, `Finalized`). */
  submitStatus?: string;
  /** Human-readable detail for `no_night_utxos` / `failed`. */
  message?: string;
  /** For a `failed` server answer: what it means (midnightApiError.ts). */
  errorKind?: MidnightApiErrorKind;
}

/** Nexus/sidecar phrasing for the "wallet holds no NIGHT" case. */
const NO_NIGHT_UTXOS_PATTERN = /no night utxos available/i;

export async function registerNightForDust(
  network: string,
  args: {
    fromAddress: string;
    dustReceiverAddressBech32: string;
    /** Tx TTL (epoch ms). Defaults to now + 24h. */
    ttlMs?: number;
  },
  credentials: MidnightSendCredentials,
): Promise<DustRegistrationOutcome> {
  try {
    await assertMidnightWritesOpen(network);
    const { publicKeyHex, addressHex } = await getWalletKeys(credentials);

    const api = getMidnightApi(network);
    const built = await api.buildNightDustRegistrationTx({
      fromAddress: args.fromAddress,
      publicKeyHex,
      addressHex,
      dustReceiverAddressBech32: args.dustReceiverAddressBech32,
      ttlMs: args.ttlMs ?? (Date.now() + 24 * 60 * 60 * 1000),
    });

    // Sign the single payload with the existing NightExternal segment-signing
    // BG handler. Wrap the single payload as a one-element segments array;
    // role is always NightExternal for DUST registration (per the Midnight
    // reference implementation's `signDustRegistration` callback).
    const signed = await signSegments(
      [{ index: 1, role: 'NightExternal', dataHex: built.signaturePayloadHex }],
      credentials,
      built.unprovenTxHex,
      args.dustReceiverAddressBech32,
    );
    if (signed.length !== 1) {
      throw new Error('Expected exactly one signature for DUST registration');
    }

    const res = await api.submitNightDustRegistrationTx({
      unprovenTxHex: built.unprovenTxHex,
      signatureHex: signed[0].signatureHex,
    });
    // Any 200 is "submitted", whatever its status says: registered is what the
    // chain shows later, not what the submit route answered.
    return { status: 'submitted', txHash: res.txHash, submitStatus: res.status };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Classify by the server's own sentence; `message` is already the readable one.
    const serverMessage = isMidnightApiError(e) ? (e.serverMessage ?? '') : message;
    // The "no NIGHT" case is a normal business state (fund the wallet first),
    // not a failure — classify it so the dialog can show the right guidance.
    if (NO_NIGHT_UTXOS_PATTERN.test(serverMessage)) {
      return { status: 'no_night_utxos', message };
    }
    return { status: 'failed', message, ...(isMidnightApiError(e) ? { errorKind: e.kind } : {}) };
  }
}
