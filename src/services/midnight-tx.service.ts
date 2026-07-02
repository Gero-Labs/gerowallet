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
 * See `docs/superpowers/plans/2026-05-26-midnight-tx-asymmetric-split.md`.
 */

import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { getMidnightApi } from '@/api/midnight-api';
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
): Promise<SubmitMidnightTxResponse> {
  const { publicKeyHex, addressHex } = await getWalletKeys(credentials);
  const built = await buildUnshielded(network, { ...baseRequest, publicKeyHex, addressHex });
  const signedTxHex = await balanceAndSignInBg(built.unprovenTxHex, baseRequest.ttlMs, credentials);
  return submitSignedTx(network, signedTxHex);
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
 * ShieldedWallet.transferTransaction → signed-but-unproven hex). Caller
 * MUST already hold user consent for sending the witness data through
 * Gero Cloud proving — gate on `midnightStore.shieldedProvingConsent` at
 * the UI layer (Step 5).
 */
async function buildAndSignShieldedInBg(
  outputs: ReadonlyArray<ShieldedTransferOutput>,
  credentials: MidnightSendCredentials,
): Promise<string> {
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
    },
  }) as { data: { success: boolean; signedTxHex?: string; error?: string } };

  if (!response?.data?.success || !response.data.signedTxHex) {
    throw new Error(response?.data?.error || 'Midnight shielded build/sign failed');
  }
  return response.data.signedTxHex;
}

/**
 * Two-step shielded NIGHT transfer:
 *   1. buildAndSignShieldedInBg → BG produces signed-but-unproven tx hex.
 *      (The "build" step lives in the wallet because shielded notes are
 *      encrypted to the user's Zswap key — no server can see them.)
 *   2. api.proveAndSubmitMidnightTx → Nexus relays to sidecar
 *      /tx/prove-and-submit which proves + binds + submits.
 *
 * Privacy gate: the caller is responsible for surfacing the consent dialog
 * (Step 5) before invoking. By the time this function runs, the user has
 * already accepted that witness data ships to Gero Cloud for proving.
 */
export async function sendShieldedNight(
  network: string,
  outputs: ReadonlyArray<ShieldedTransferOutput>,
  credentials: MidnightSendCredentials,
  waitFor: 'Submitted' | 'InBlock' | 'Finalized' = 'InBlock',
): Promise<SubmitMidnightTxResponse> {
  if (outputs.length === 0) {
    throw new Error('sendShieldedNight: at least one output is required');
  }
  const signedTxHex = await buildAndSignShieldedInBg(outputs, credentials);
  const api = getMidnightApi(network);
  return api.proveAndSubmitMidnightTx({ signedTxHex, waitFor });
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
    // role is always NightExternal for DUST registration (per Lace's
    // `signDustRegistration` callback in `dependencies.ts:425`).
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
