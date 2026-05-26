/**
 * Midnight transaction orchestration (browser/options context).
 *
 * Mirrors the Cardano send pipeline (build at Nexus → sign locally → submit
 * via Nexus relay) but with Midnight-specific signing semantics: the SDK's
 * `signSegment` callback expects per-segment BIP-340 signatures from the
 * user's role-derived key (NightExternal for unshielded, Zswap for shielded).
 *
 * Lifecycle:
 *   1. `getWalletKeys` → BG fast-path or single mnemonic decrypt to get publicKeyHex + addressHex
 *   2. `buildUnshielded` → POST to Nexus, receive `unprovenTxHex` + `segmentsToSign[]`
 *   3. `signSegments` → BG decrypts mnemonic, derives NightExternal key, signs each segment
 *   4. `submit` → POST envelope `{ fromAddress, publicKeyHex, addressHex, unprovenTxHex, signatures }`
 *      (hex-encoded JSON) to Nexus's `/tx/submit` relay; Nexus calls sidecar `/tx/finalize`
 *      which calls `signUnprovenTransaction` synchronously then submits to Substrate RPC.
 *
 * **Phase 1 scope**: unshielded build + sign + submit. Shielded + proof
 * generation deferred to Phase 3.
 *
 * See `docs/superpowers/plans/2026-05-05-midnight-tx-build.md`.
 */

import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { getMidnightApi } from '@/api/midnight-api';
import type {
  BuildMidnightTxRequest,
  BuildMidnightTxResponse,
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

/** Step 2: Nexus builds an `UnprovenTransaction` for unshielded NIGHT. */
export async function buildUnshielded(
  network: string,
  request: BuildMidnightTxRequest,
): Promise<BuildMidnightTxResponse> {
  const api = getMidnightApi(network);
  return api.buildUnshieldedTx(request);
}

/**
 * Step 3: sign all intent-hash segments locally via BG. The PRF secret (if
 * present) is shipped as a regular array because chrome.runtime.sendMessage
 * can't serialise a `Uint8Array` directly — BG reconstructs it on the other
 * side.
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

/**
 * Step 4: encode the `SignedTxEnvelope` JSON as hex and POST to Nexus's
 * `/tx/submit` relay through BG. Nexus calls the sidecar `/tx/finalize` which
 * calls `signUnprovenTransaction` synchronously (draining the pre-collected
 * signature map by visit order) then submits the resulting extrinsic to the
 * Midnight Substrate RPC node.
 *
 * Wire format: hex(JSON({ fromAddress, publicKeyHex, addressHex, unprovenTxHex, signatures }))
 * Matches `SignedTxEnvelope` on the Nexus Java side (`MidnightTxSubmitService`).
 */
export async function submit(
  envelope: {
    fromAddress: string;
    publicKeyHex: string;
    addressHex: string;
    unprovenTxHex: string;
    signatures: SignedSegment[];
  },
  waitFor: 'Submitted' | 'InBlock' | 'Finalized' = 'InBlock',
): Promise<SubmitMidnightTxResponse> {
  const signedTxHex = Buffer.from(JSON.stringify(envelope), 'utf8').toString('hex');
  const response = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SUBMIT_MIDNIGHT_TX,
    data: { signedTxHex, waitFor },
  }) as { data: { success: boolean; result?: SubmitMidnightTxResponse; error?: string } };

  if (!response?.data?.success || !response.data.result) {
    throw new Error(response?.data?.error || 'Midnight submission failed');
  }
  return response.data.result;
}

/**
 * Convenience wrapper: get keys → build → sign → submit.
 *
 * For PRF wallets the single `prfSecret` bytes are reused across the
 * `getWalletKeys` (slow-path only) and `signSegments` BG calls — the user
 * completes one WebAuthn gesture in the UI, and the bytes flow through.
 * For password wallets the password is similarly reused.
 */
export async function sendUnshieldedNight(
  network: string,
  baseRequest: Omit<BuildMidnightTxRequest, 'publicKeyHex' | 'addressHex'>,
  credentials: MidnightSendCredentials,
): Promise<SubmitMidnightTxResponse> {
  const { publicKeyHex, addressHex } = await getWalletKeys(credentials);

  const request: BuildMidnightTxRequest = { ...baseRequest, publicKeyHex, addressHex };
  const built = await buildUnshielded(network, request);
  const signatures = await signSegments(built.segmentsToSign, credentials);

  return submit({
    fromAddress: baseRequest.fromAddress,
    publicKeyHex,
    addressHex,
    unprovenTxHex: built.unprovenTxHex,
    signatures,
  });
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

/**
 * Path A — DEREGISTER the wallet's NIGHT UTxOs from DUST generation.
 *
 * Symmetric to {@link registerNightForDust}: build → sign (single payload,
 * NightExternal role) → submit (reuses /dust/submit-night-registration; the
 * on-chain extrinsic is the same midnight.sendMnTransaction runtime call).
 */
export async function deregisterNightForDust(
  network: string,
  args: { fromAddress: string; ttlMs?: number },
  credentials: MidnightSendCredentials,
): Promise<SubmitNightDustRegistrationResponse> {
  const { publicKeyHex, addressHex } = await getWalletKeys(credentials);

  const api = getMidnightApi(network);
  const built = await api.buildNightDustDeregistrationTx({
    fromAddress: args.fromAddress,
    publicKeyHex,
    addressHex,
    ttlMs: args.ttlMs ?? (Date.now() + 24 * 60 * 60 * 1000),
  });

  const signed = await signSegments(
    [{ index: 1, role: 'NightExternal', dataHex: built.signaturePayloadHex }],
    credentials,
  );
  if (signed.length !== 1) {
    throw new Error('Expected exactly one signature for DUST deregistration');
  }

  return api.submitNightDustRegistrationTx({
    unprovenTxHex: built.unprovenTxHex,
    signatureHex: signed[0].signatureHex,
  });
}
