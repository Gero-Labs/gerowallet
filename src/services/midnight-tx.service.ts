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
  SubmitNightDustRegistrationResponse,
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

export async function registerNightForDust(
  network: string,
  args: {
    fromAddress: string;
    dustReceiverAddressBech32: string;
    /** Tx TTL (epoch ms). Defaults to now + 24h. */
    ttlMs?: number;
  },
  credentials: MidnightSendCredentials,
): Promise<SubmitNightDustRegistrationResponse> {
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

  return api.submitNightDustRegistrationTx({
    unprovenTxHex: built.unprovenTxHex,
    signatureHex: signed[0].signatureHex,
  });
}
