/**
 * Midnight transaction orchestration (browser/options context).
 *
 * Two pipelines coexist here:
 *
 *  - Unshielded NIGHT transfer (CURRENT): BG service worker builds + DUST-fee-
 *    balances + signs the tx via `UnshieldedWallet`+`DustWallet`, then ships
 *    the signed-but-unproven hex to Nexus's `/tx/submit`. Nexus → sidecar's
 *    `/tx/finalize` produces the ZK proof, binds the tx, and submits to the
 *    Midnight RPC node. The fee step must run inside BG because
 *    `balanceTransactions(dustSecretKey, …)` cryptographically needs the
 *    user's real DUST secret to derive spend nullifiers. Same architecture
 *    as Lace.
 *
 *  - DUST registration (Path A — NIGHT-for-DUST): server builds with a
 *    throwaway dust secret (first-time registration is fee-free), BG signs
 *    the single intent segment, Nexus splices + submits. See bottom of file.
 *
 * Phase 3 (shielded) will add a separate proof step.
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

/**
 * BG builds + DUST-fee-balances + signs the unshielded NIGHT transfer using
 * the user's real role-derived keys (NightExternal + DustSecret). Returns the
 * signed-but-unproven tx hex; sidecar's `/tx/finalize` handles ZK proving and
 * submission. Amounts go over the wire as decimal strings because BigInt
 * can't ride `chrome.runtime.sendMessage`.
 */
async function buildAndSignUnshieldedTxInBg(
  outputs: Array<{ address: string; amount: bigint; token: 'NIGHT' }>,
  ttlMs: number,
  credentials: MidnightSendCredentials,
): Promise<string> {
  const response = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.BUILD_AND_SIGN_MIDNIGHT_UNSHIELDED_TX,
    data: {
      outputs: outputs.map((o) => ({ address: o.address, amount: o.amount.toString(), token: o.token })),
      ttlMs,
      password: credentials.password,
      prfSecret: credentials.prfSecret ? Array.from(credentials.prfSecret) : undefined,
    },
  }) as { data: { success: boolean; signedTxHex?: string; error?: string } };

  if (!response?.data?.success || !response.data.signedTxHex) {
    throw new Error(response?.data?.error || 'Midnight tx build/sign failed');
  }
  return response.data.signedTxHex;
}

/**
 * POST a signed-but-unproven tx hex to Nexus's `/tx/submit` relay. Nexus
 * forwards to the sidecar's `/tx/finalize`, which proves + binds + submits to
 * the Midnight RPC node and returns the txHash + finality status.
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
 * Convenience wrapper: BG build+sign → submit. One WebAuthn / password prompt
 * (the credentials are consumed inside BG; nothing else needs them).
 */
export async function sendUnshieldedNight(
  network: string,
  baseRequest: Omit<BuildMidnightTxRequest, 'publicKeyHex' | 'addressHex'>,
  credentials: MidnightSendCredentials,
): Promise<SubmitMidnightTxResponse> {
  const outputs = baseRequest.outputs.map((o) => ({
    address: o.address,
    amount: BigInt(o.amount),
    token: 'NIGHT' as const,
  }));
  const signedTxHex = await buildAndSignUnshieldedTxInBg(outputs, baseRequest.ttlMs, credentials);
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
