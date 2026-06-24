// Strike Finance v2 API — Builder Connect
//
// Two unauthenticated endpoints used to bind a freshly-generated Ed25519 API
// wallet to a Strike account. The API-wallet header signing scheme used by the
// rest of the v2 API only works AFTER an account has been associated, so these
// two calls intentionally bypass the authenticated `strikeClient` interceptor
// and use a plain axios instance pinned to the same base URL.
//
// Flow (per Strike auth skill spec):
//   1. POST /auth/builder/request-signature
//        body: { address, chain: "cardano", public_key, code, max_fee_bps }
//        resp: { nonce, message_to_sign }
//   2. <user signs `message_to_sign` with their Cardano wallet (CIP-8)>
//   3. POST /auth/builder/verify-signature
//        body: { address, chain: "cardano", nonce, wallet_signature }
//        resp: { account_id, builder_code, max_fee_bps,
//                api_wallet_id, api_wallet_public_key, api_wallet_created_at }

import axios, { type AxiosInstance } from 'axios';

// ---------------------------------------------------------------------------
// Base URL — kept in sync with strike-v2.client.ts
// ---------------------------------------------------------------------------

// @ts-ignore — Vite env
const STRIKE_API_BASE: string = import.meta.env.VITE_STRIKE_API_URL || 'https://api.strikefinance.org';

const builderClient: AxiosInstance = axios.create({
  baseURL: STRIKE_API_BASE,
  timeout: 30_000,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StrikeChain = 'cardano';

export interface BuilderRequestSignatureRequest {
  /** Bech32 payment address of the user's Cardano wallet (e.g. addr1…). */
  address: string;
  chain: StrikeChain;
  /** Hex-encoded Ed25519 public key of the API wallet to bind (64 chars). */
  public_key: string;
  /** Per-integrator builder code identifying this wallet to Strike. */
  code: string;
  /** Maximum fee in basis points the builder is allowed to charge. */
  max_fee_bps: number;
}

export interface BuilderRequestSignatureResponse {
  /** Server-issued nonce that must be echoed back in verify-signature. */
  nonce: string;
  /** Plain-text message the user must sign with their Cardano wallet. */
  message_to_sign: string;
}

export interface BuilderVerifySignatureRequest {
  address: string;
  chain: StrikeChain;
  nonce: string;
  /** Wallet signature over `message_to_sign`. For Cardano this is a
   *  CIP-8 / COSE_Sign1 envelope serialised in a backend-accepted shape. */
  wallet_signature: string;
}

export interface BuilderVerifySignatureResponse {
  account_id: string;
  builder_code: string;
  max_fee_bps: number;
  api_wallet_id: string;
  api_wallet_public_key: string;
  /** ISO-8601 or Unix timestamp string — backend dependent. */
  api_wallet_created_at: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Step 1 of builder connect — request a `message_to_sign` from Strike that
 * binds the supplied API-wallet public key + builder code to this user.
 */
export async function requestBuilderSignature(
  req: BuilderRequestSignatureRequest,
): Promise<BuilderRequestSignatureResponse> {
  // Mainnet's request-signature uses a strict JSON decoder. The builder fee field
  // is named `fee_share_bps` (REQUIRED) on mainnet — NOT `max_fee_bps` as in the
  // testnet builder-reference. This is the Gero builder fee (revenue), in basis
  // points, declared at connect time.
  const { data } = await builderClient.post<BuilderRequestSignatureResponse>(
    '/auth/builder/request-signature',
    {
      address: req.address,
      chain: req.chain,
      public_key: req.public_key,
      code: req.code,
      fee_share_bps: req.max_fee_bps,
    },
  );
  return data;
}

/**
 * Step 3 of builder connect — submit the user's wallet signature back to
 * Strike. On success the response carries `account_id` + the freshly-issued
 * API-wallet metadata, which the caller should persist alongside the
 * encrypted private key.
 */
export async function verifyBuilderSignature(
  req: BuilderVerifySignatureRequest,
): Promise<BuilderVerifySignatureResponse> {
  const { data } = await builderClient.post<BuilderVerifySignatureResponse>(
    '/auth/builder/verify-signature',
    req,
  );
  return data;
}
