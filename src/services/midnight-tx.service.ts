/**
 * Midnight transaction orchestration (browser/options context).
 *
 * Three pipelines coexist here:
 *
 *  - Unshielded NIGHT transfer: Nexus builds the unproven tx (NIGHT UTxO
 *    selection + offer + change — public data, indexer view is canonical).
 *    BG then DUST-balances + signs (needs the user's real dust secret +
 *    NightExternal key). Nexus's `/tx/submit` relay forwards the signed-
 *    but-unproven hex to the sidecar's `/tx/finalize`, which proves + binds
 *    + submits via `midnight.sendMnTransaction`.
 *
 *  - Shielded NIGHT transfer (future): wallet owns the entire pre-prove
 *    pipeline (notes are encrypted to the user's Zswap key; nobody else can
 *    see them). BG builds + balances + signs; Nexus proves + submits.
 *
 *  - DUST registration (Path A — NIGHT-for-DUST): server builds with a
 *    throwaway dust secret (first-time registration is fee-free), BG signs
 *    the single intent segment, Nexus splices + submits. See bottom of file.
 *
 */

import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { getMidnightApi } from '@/api/midnight-api';
import { midnightStore } from '@/stores/midnightStore';
import { resolveZkpaasUrl, buildZkpaasHeaders, isZkpaasConfigured } from '@/chains/midnight/midnightZkpaas';
import type {
  BuildMidnightTxRequest,
  MidnightSegmentToSign,
  SubmitMidnightTxResponse,
} from '@/api/midnight-api';

export interface SignedSegment {
  index: number;
  signatureHex: string;
}

export interface MidnightSendCredentials {
  password?: string;
  /** Raw PRF output bytes from a WebAuthn ceremony (PRF/PassKey wallets). */
  prfSecret?: Uint8Array;
}

/**
 * High-level stages of an unshielded send, in order. Drives the send
 * dialog's progress timeline. The `working` stage is the single BG
 * balance+sign round-trip; the dialog splits it into "sync DUST" vs "sign"
 * using the live `midnightStore.sendProgress` percentage the BG broadcasts.
 *
 * `provingLocal` / `provingZkpaas` are shielded-only: emitted instead of
 * `working` when `midnightStore.proofServer.mode` is `local` (WP-P2) or
 * `zkpaas` respectively, since in those modes the single BG round-trip is
 * dominated by the wallet-side ZK-proving step (10-25s+) rather than the
 * comparatively fast build+sign. Two distinct stages so the timeline can
 * honestly say WHERE the proof is being generated.
 */
export type MidnightSendStage =
  | 'authorizing'
  | 'building'
  | 'working'
  | 'provingLocal'
  | 'provingZkpaas'
  | 'submitting'
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
): Promise<SignedSegment[]> {
  const response = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SIGN_MIDNIGHT_SEGMENTS,
    data: {
      segments,
      password: credentials.password,
      prfSecret: credentials.prfSecret ? Array.from(credentials.prfSecret) : undefined,
    },
  }) as { data: { success: boolean; signatures?: SignedSegment[]; error?: string } };

  if (!response?.data?.success) {
    throw new Error(response?.data?.error || 'Midnight signing failed');
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
 * signed-but-unproven hex ready for the sidecar's prove+submit step.
 */
async function balanceAndSignInBg(
  unprovenTxHex: string,
  ttlMs: number,
  credentials: MidnightSendCredentials,
): Promise<string> {
  const response = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.BALANCE_AND_SIGN_MIDNIGHT_UNSHIELDED_TX,
    data: {
      unprovenTxHex,
      ttlMs,
      password: credentials.password,
      prfSecret: credentials.prfSecret ? Array.from(credentials.prfSecret) : undefined,
    },
  }) as { data: { success: boolean; signedTxHex?: string; error?: string } };

  if (!response?.data?.success || !response.data.signedTxHex) {
    throw new Error(response?.data?.error || 'Midnight balance/sign failed');
  }
  return response.data.signedTxHex;
}

/**
 * Step 4: POST the signed-but-unproven tx to Nexus's `/tx/submit` relay.
 * Nexus forwards to the sidecar's `/tx/finalize` which proves + binds +
 * submits via `midnight.sendMnTransaction` and returns `{txHash, status}`.
 */
async function submitSignedTx(
  network: string,
  signedTxHex: string,
  waitFor: 'Submitted' | 'InBlock' | 'Finalized' = 'InBlock',
): Promise<SubmitMidnightTxResponse> {
  const api = getMidnightApi(network);
  return api.submitMidnightTx({ signedTxHex, waitFor });
}

/**
 * Orchestrate the four-step unshielded NIGHT transfer:
 *   1. getWalletKeys      → publicKeyHex + addressHex
 *   2. buildUnshielded    → Nexus builds unproven NIGHT tx
 *   3. balanceAndSignInBg → BG adds DUST fee inputs + signs each input
 *   4. submitSignedTx     → Nexus relays to sidecar /tx/finalize (prove + submit)
 */
export async function sendUnshieldedNight(
  network: string,
  baseRequest: Omit<BuildMidnightTxRequest, 'publicKeyHex' | 'addressHex'>,
  credentials: MidnightSendCredentials,
  onStage?: (stage: MidnightSendStage) => void,
): Promise<SubmitMidnightTxResponse> {
  onStage?.('authorizing');
  const { publicKeyHex, addressHex } = await getWalletKeys(credentials);
  onStage?.('building');
  const built = await buildUnshielded(network, { ...baseRequest, publicKeyHex, addressHex });
  onStage?.('working');
  const signedTxHex = await balanceAndSignInBg(built.unprovenTxHex, baseRequest.ttlMs, credentials);
  onStage?.('submitting');
  const result = await submitSignedTx(network, signedTxHex);
  onStage?.('done');
  return result;
}

/**
 * Phase-2 DApp-connector `makeTransfer`: run steps 1-3 of the unshielded NIGHT
 * transfer (getWalletKeys → Nexus build → BG DUST-balance + sign) and STOP —
 * do NOT submit. Returns the signed-but-unproven hex.
 *
 * The dapp is expected to submit the returned tx via the connector's own
 * `submitTransaction`, which relays to Nexus `/tx/submit` → sidecar
 * `/tx/finalize` (prove + bind + submit). This is literally
 * `sendUnshieldedNight` minus step 4, so it reuses the exact build+sign path
 * the dashboard send uses — no separate tx-building logic.
 */
export async function buildAndSignUnshieldedTransfer(
  network: string,
  baseRequest: Omit<BuildMidnightTxRequest, 'publicKeyHex' | 'addressHex'>,
  credentials: MidnightSendCredentials,
): Promise<{ tx: string }> {
  const { publicKeyHex, addressHex } = await getWalletKeys(credentials);
  const built = await buildUnshielded(network, { ...baseRequest, publicKeyHex, addressHex });
  const signedTxHex = await balanceAndSignInBg(built.unprovenTxHex, baseRequest.ttlMs, credentials);
  return { tx: signedTxHex };
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
): Promise<void> {
  try {
    await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.ADD_MIDNIGHT_PENDING_TX,
      data: { hash, amount: amount.toString(), counterparty, isShielded },
    });
  } catch {
    /* optimistic-only — gero-sync will deliver the confirmed entry anyway */
  }
}

// ─── Shielded NIGHT send ──────────────────────────────────────────────────────

/**
 * Shielded recipient + amount. `tokenType` defaults to native NIGHT.
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
  proving?: { url: string; headers?: Record<string, string> },
): Promise<{ signedTxHex: string; proven: boolean }> {
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
    },
  }) as { data: { success: boolean; signedTxHex?: string; proven?: boolean; error?: string } };

  if (!response?.data?.success || !response.data.signedTxHex) {
    throw new Error(response?.data?.error || 'Midnight shielded build/sign failed');
  }
  return { signedTxHex: response.data.signedTxHex, proven: !!response.data.proven };
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
  constructor(public readonly url: string) {
    super(`Proof server not reachable at ${url || '(not configured)'}`);
    this.name = 'ProofServerUnreachableError';
  }
}

/**
 * Resolve the user's proof-server preference into a wallet-side proving
 * target: the base URL (+ Arkhia auth headers for zkPaaS), which progress
 * stage to surface, and how strict the health preflight should be. `null`
 * means "prove remotely via Gero Cloud" (mode `remote`).
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
): { url: string; headers?: Record<string, string>; stage: MidnightSendStage; lenientHealth: boolean } | null {
  const ps = midnightStore.proofServer;
  if (ps.mode === 'local') {
    return { url: ps.localUrl, stage: 'provingLocal', lenientHealth: false };
  }
  if (ps.mode === 'zkpaas') {
    const url = resolveZkpaasUrl(network, ps);
    if (!isZkpaasConfigured(ps) || !url) {
      throw new ProofServerUnreachableError(url);
    }
    return {
      url, headers: buildZkpaasHeaders(ps), stage: 'provingZkpaas', lenientHealth: true,
    };
  }
  return null;
}

/**
 * Fast pre-auth preflight for the send/convert dialogs (WP-P5 pattern):
 * `true` when the current proof-server preference can accept a send right
 * now — remote always can (Gero Cloud isn't wallet-checked), local/zkpaas
 * must answer their health check and zkPaaS must be configured at all.
 * Never throws; the dialogs turn `false` into the two-action fallback
 * ("Open settings" / "Use Gero Cloud for this transaction") without
 * flashing the full progress timeline for a doomed send.
 */
export async function checkWalletProvingPreflight(network: string): Promise<boolean> {
  let target: ReturnType<typeof resolveWalletProvingTarget>;
  try {
    target = resolveWalletProvingTarget(network);
  } catch {
    // zkPaaS selected but not configured (no key, no override URL).
    return false;
  }
  if (!target) return true;
  const { checkProofServerHealth } = await import('@/chains/midnight/midnightLocalProver');
  return checkProofServerHealth(target.url, {
    headers: target.headers,
    acceptNotFound: target.lenientHealth,
  });
}

/**
 * Shielded NIGHT transfer, branching on the user's proof-server preference
 * (`midnightStore.proofServer`, WP-P1):
 *
 *   Remote (default): unchanged path.
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
): Promise<SubmitMidnightTxResponse> {
  if (outputs.length === 0) {
    throw new Error('sendShieldedNight: at least one output is required');
  }
  const api = getMidnightApi(network);

  const target = forceRemote ? null : resolveWalletProvingTarget(network);
  if (target) {
    const { checkProofServerHealth } = await import('@/chains/midnight/midnightLocalProver');
    const healthy = await checkProofServerHealth(target.url, {
      headers: target.headers,
      acceptNotFound: target.lenientHealth,
    });
    if (!healthy) {
      throw new ProofServerUnreachableError(target.url);
    }
    onStage?.(target.stage);
    const { signedTxHex, proven } = await buildAndSignShieldedInBg(
      outputs, credentials, { url: target.url, headers: target.headers },
    );
    if (!proven) {
      // Defensive: the BG only skips proving when `proving` is absent from
      // the request, which it never is on this branch. Should be
      // unreachable — fail loudly rather than silently submit an unproven
      // tx to the submit-proven endpoint.
      throw new Error('Wallet-side proving requested but BG returned an unproven tx');
    }
    onStage?.('submitting');
    const result = await api.submitProvenMidnightTx({ signedTxHex, waitFor });
    onStage?.('done');
    return result;
  }

  onStage?.('working');
  const { signedTxHex } = await buildAndSignShieldedInBg(outputs, credentials);
  onStage?.('submitting');
  const result = await api.proveAndSubmitMidnightTx({ signedTxHex, waitFor });
  onStage?.('done');
  return result;
}

// ─── Shield conversion (public NIGHT -> private NIGHT) ───────────────────────
//
// WP-SH4. Unshield
// (private -> public) is intentionally NOT wired here yet — ground rule 16:
// no real shield has succeeded on-chain yet, so there is
// nothing to unshield to test against.

/**
 * BG builds + signs the SHIELD direction of a shield/unshield conversion —
 * moves `amount` of public NIGHT into a brand-new shielded output at the
 * wallet's own shielded address (`buildAndSignMidnightShield` in
 * walletBg.ts / `buildAndSignShield` in midnightShieldSwapBuilder.ts). No
 * recipient: shield always moves value between the wallet's own two
 * addresses. Same response shape as {@link buildAndSignShieldedInBg} —
 * reused rather than forked.
 */
async function buildAndSignShieldInBg(
  amount: bigint,
  credentials: MidnightSendCredentials,
  proving?: { url: string; headers?: Record<string, string> },
): Promise<{ signedTxHex: string; proven: boolean }> {
  const response = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.BUILD_AND_SIGN_MIDNIGHT_SHIELD_TX,
    data: {
      amount: amount.toString(),
      password: credentials.password,
      prfSecret: credentials.prfSecret ? Array.from(credentials.prfSecret) : undefined,
      proving,
    },
  }) as { data: { success: boolean; signedTxHex?: string; proven?: boolean; error?: string } };

  if (!response?.data?.success || !response.data.signedTxHex) {
    throw new Error(response?.data?.error || 'Midnight shield build/sign failed');
  }
  return { signedTxHex: response.data.signedTxHex, proven: !!response.data.proven };
}

/**
 * Shield conversion (public NIGHT -> private/shielded NIGHT), branching on
 * the user's proof-server preference exactly like {@link sendShieldedNight}
 * — shield's shielded half proves through the identical ShieldedWallet
 * pipeline as a plain shielded send (see midnightShieldSwapBuilder.ts's file
 * header), so the same local/zkPaaS/remote routing, health preflight, and
 * `ProofServerUnreachableError` fallback apply unchanged. No recipient or
 * output list: the amount always moves from the wallet's own public address
 * to its own shielded address.
 *
 * `forceRemote` mirrors sendShieldedNight's one-off "use Gero Cloud for this
 * transaction" fallback (WP-P5) — same meaning, same caller contract.
 */
export async function shieldNight(
  network: string,
  amount: bigint,
  credentials: MidnightSendCredentials,
  waitFor: 'Submitted' | 'InBlock' | 'Finalized' = 'InBlock',
  onStage?: (stage: MidnightSendStage) => void,
  forceRemote = false,
): Promise<SubmitMidnightTxResponse> {
  if (amount <= 0n) {
    throw new Error('shieldNight: amount must be positive');
  }
  const api = getMidnightApi(network);

  const target = forceRemote ? null : resolveWalletProvingTarget(network);
  if (target) {
    const { checkProofServerHealth } = await import('@/chains/midnight/midnightLocalProver');
    const healthy = await checkProofServerHealth(target.url, {
      headers: target.headers,
      acceptNotFound: target.lenientHealth,
    });
    if (!healthy) {
      throw new ProofServerUnreachableError(target.url);
    }
    onStage?.(target.stage);
    const { signedTxHex, proven } = await buildAndSignShieldInBg(
      amount, credentials, { url: target.url, headers: target.headers },
    );
    if (!proven) {
      // Defensive: mirrors sendShieldedNight's identical guard — should be
      // unreachable since `proving` is always set on this branch.
      throw new Error('Wallet-side proving requested but BG returned an unproven tx');
    }
    onStage?.('submitting');
    const result = await api.submitProvenMidnightTx({ signedTxHex, waitFor });
    onStage?.('done');
    return result;
  }

  onStage?.('working');
  const { signedTxHex } = await buildAndSignShieldInBg(amount, credentials);
  onStage?.('submitting');
  const result = await api.proveAndSubmitMidnightTx({ signedTxHex, waitFor });
  onStage?.('done');
  return result;
}

// ─── Path A — NIGHT-for-DUST registration ─────────────────────────────────────
//
// Registers the wallet's own NIGHT UTxOs to generate DUST for the wallet's
// own dust address. Signed locally with the NightExternal key (same key
// used for unshielded sends). No Cardano interaction.
//
// Flow:
//   1. getWalletKeys → publicKeyHex + addressHex (cached or slow-path)
//   2. buildNightDustRegistrationTx → Nexus sidecar builds via DustWallet,
//      returns unproven tx + a single signature payload (intent #1, segment 1)
//   3. signSegments → BG signs the payload with NightExternal (same path as send)
//   4. submitNightDustRegistrationTx → Nexus splices the signature + submits
//      to substrate

/**
 * Discriminated outcome of a DUST-registration attempt. Modelled after the
 * Dynamic.xyz Midnight SDK's `registerDust()` status enum
 * (`registered | already_registered | already_has_dust | no_utxos`), which
 * turns the raw "No NIGHT UTxOs available" 400 into a state the UI can render
 * as a helpful next-step instead of a scary error toast. We surface the two
 * states our nexus registration call can distinguish cleanly:
 *   - `registered`     — the tx was built, signed, and submitted
 *   - `no_night_utxos` — the wallet holds no unshielded NIGHT; it must be
 *                        funded before DUST can be generated (this is the
 *                        exact 400 we hit on a freshly-created preprod wallet)
 *   - `failed`         — any other error; `message` carries the detail
 *
 * "already registered" / "already has dust" aren't distinguished here because
 * nexus doesn't return a distinct code for them on the build call; the dialog
 * already knows the on-chain registration status separately (its status pill)
 * and gates the CTA on it, so a re-register attempt is prevented upstream.
 */
export type DustRegistrationStatus = 'registered' | 'no_night_utxos' | 'failed';

export interface DustRegistrationOutcome {
  status: DustRegistrationStatus;
  /** Present on `registered`. */
  txHash?: string;
  /** Human-readable detail for `no_night_utxos` / `failed`. */
  message?: string;
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
    );
    if (signed.length !== 1) {
      throw new Error('Expected exactly one signature for DUST registration');
    }

    const res = await api.submitNightDustRegistrationTx({
      unprovenTxHex: built.unprovenTxHex,
      signatureHex: signed[0].signatureHex,
    });
    return { status: 'registered', txHash: res.txHash };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // The "no NIGHT" case is a normal business state (fund the wallet first),
    // not a failure — classify it so the dialog can show the right guidance.
    if (NO_NIGHT_UTXOS_PATTERN.test(message)) {
      return { status: 'no_night_utxos', message };
    }
    return { status: 'failed', message };
  }
}
