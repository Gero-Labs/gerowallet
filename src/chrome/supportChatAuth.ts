/**
 * Support-chat identity handshake (background only).
 *
 * <p>Proves control of a wallet to Nexus WITHOUT revealing anything to Chatwoot:
 * Nexus issues a nonce, the wallet CIP-8 (COSE_Sign1) signs the challenge subject
 * with its STAKE key — the same machinery the cross-device wallet-control proof
 * uses (see `services/crossDevice/registerProof.ts` and `walletBg.signData`) — and
 * Nexus returns a pseudonymous Chatwoot identifier + HMAC. The stake address never
 * leaves the wallet↔Nexus leg; the chat itself only ever sees the pseudonym.
 *
 * <p>SECURITY: the wallet must NEVER blind-sign a server-supplied string with its
 * stake key. Two guards bound what can be signed, and together they mean the only
 * server-controlled bytes are an opaque token from a restricted alphabet:
 * <ol>
 *   <li>the nonce must match {@link NONCE_PATTERN} — no pipes, whitespace,
 *       newlines, or other separators that could smuggle structure into the
 *       subject, and a bounded length; and</li>
 *   <li>the returned `message` must equal the subject we rebuild locally from the
 *       domain, OUR stake address, and that nonce, byte for byte.</li>
 * </ol>
 * A hostile Nexus therefore cannot steer the signature at a payload of its own
 * shape — the domain prefix and address are ours, and the tail is constrained.
 *
 * <p>Runs in the background service worker because that is the only context that
 * can reach the wallet's private keys.
 */

import axios, { type AxiosInstance } from 'axios';
import type { SupportChatVerifiedIdentity } from '@/services/support/identityCache';

export type { SupportChatVerifiedIdentity };

/** Domain-separated challenge subject. Mirrors DEVICE_REGISTER_DOMAIN's shape. */
export const SUPPORT_CHALLENGE_DOMAIN = 'gero-support/v1';

/**
 * The only server-chosen bytes that reach the signer. URL-safe base64 alphabet,
 * bounded length: no `|` (the subject separator), no whitespace/newlines, no
 * control characters — so a nonce cannot fake extra subject fields.
 */
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
export const SUPPORT_CHALLENGE_PATH = '/api/support/chat/challenge';
export const SUPPORT_VERIFY_PATH = '/api/support/chat/verify';

/**
 * Nexus is reached through gero-backend's proxy (VITE_NEXUS_URL), exactly like
 * every other first-party client (see `api/agent.client.ts`).
 */
export const supportAuthAxiosInstance: AxiosInstance = axios.create({
  baseURL: import.meta.env['VITE_NEXUS_URL'] || '',
  timeout: 20_000,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
});

/** CIP-30 `signData` result: COSE_Sign1 + COSE_Key, both hex. */
export type SupportSignFn = (payloadHex: string) => Promise<{ signature: string; key: string }>;

export interface SupportHandshakeParams {
  /** bech32 reward address (`stake1…`) of the active Cardano wallet. */
  stakeAddress: string;
  sign: SupportSignFn;
}

/** The exact string the stake key signs. Pipe-joined, domain-separated. */
export function buildSupportChallengeSubject(stakeAddress: string, nonce: string): string {
  return `${SUPPORT_CHALLENGE_DOMAIN}|${stakeAddress}|${nonce}`;
}

function utf8ToHex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function statusOf(error: unknown): number | undefined {
  const res = (error as { response?: { status?: number } } | null)?.response;
  return typeof res?.status === 'number' ? res.status : undefined;
}

interface ChallengeResponse {
  nonce?: string;
  message?: string;
}

interface VerifyResponse {
  identifier?: string;
  identifierHash?: string;
  displayName?: string;
}

async function requestChallenge(stakeAddress: string): Promise<{ nonce: string; message: string }> {
  const { data } = await supportAuthAxiosInstance.post<ChallengeResponse>(SUPPORT_CHALLENGE_PATH, { stakeAddress });
  const nonce = data?.nonce;
  const message = data?.message;
  if (!nonce || !message) throw new Error('Support challenge response incomplete');
  // Constrain the one server-chosen component BEFORE it is folded into a string
  // the stake key will sign (see the module note on the two guards).
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error('Support challenge nonce malformed. Refusing to sign');
  }
  // Never sign a server-chosen payload: the subject must be exactly what we expect.
  if (message !== buildSupportChallengeSubject(stakeAddress, nonce)) {
    throw new Error('Support challenge subject mismatch. Refusing to sign');
  }
  return { nonce, message };
}

async function verify(
  stakeAddress: string,
  nonce: string,
  coseSign1Hex: string,
  coseKeyHex: string,
): Promise<SupportChatVerifiedIdentity> {
  const { data } = await supportAuthAxiosInstance.post<VerifyResponse>(SUPPORT_VERIFY_PATH, {
    stakeAddress,
    nonce,
    coseSign1Hex,
    coseKeyHex,
  });
  if (!data?.identifier || !data?.identifierHash) throw new Error('Support verify response incomplete');
  return {
    identifier: data.identifier,
    identifierHash: data.identifierHash,
    displayName: data.displayName || '',
  };
}

/**
 * Run challenge → sign → verify. A 400 on verify means the nonce expired between
 * the two calls (the user sat on the password prompt), so the whole round is
 * retried ONCE with a fresh nonce. Any other failure — 401 (bad signature), 429
 * (rate limited), network — propagates; the caller must not loop.
 */
export async function runSupportChatHandshake(
  params: SupportHandshakeParams,
): Promise<SupportChatVerifiedIdentity> {
  const { stakeAddress, sign } = params;
  if (!stakeAddress || !stakeAddress.startsWith('stake1')) {
    throw new Error('Support chat requires a Cardano reward address');
  }

  for (let round = 0; round < 2; round++) {
    const { nonce, message } = await requestChallenge(stakeAddress);
    const { signature, key } = await sign(utf8ToHex(message));
    if (!signature || !key) throw new Error('Support challenge signing produced no signature');
    try {
      return await verify(stakeAddress, nonce, signature, String(key));
    } catch (error) {
      const expiredNonce = statusOf(error) === 400 && round === 0;
      if (!expiredNonce) throw error;
    }
  }
  /* istanbul ignore next — the loop either returns or throws */
  throw new Error('Support chat handshake failed');
}

/**
 * The slice of {@link ../chrome/walletBg.WalletBg} the handshake needs. Declared
 * structurally so this stays unit-testable without constructing a real wallet.
 */
export interface SupportChatSigner {
  chain?: string;
  stakeAddress?: string;
  signData(
    address: string,
    payloadHex: string,
    password: string,
    accountIndex: number,
    keys: unknown,
    privateKeyBytes?: Uint8Array,
  ): Promise<{ signature: string; key: unknown }>;
}

export interface SupportChatAuthInput {
  /** Spending password (software wallets). */
  password?: string;
  /** Pre-decrypted root key bytes (PRF / PassKey wallets). */
  privateKeyBytes?: Uint8Array;
}

/** Only Cardano wallets have a reward address to be pseudonymized. */
const CARDANO_CHAIN = 'Cardano';

/**
 * Gate on wallet capability, then run the handshake with the wallet's stake key.
 * Extracted from the background message handler so the guards are testable and the
 * handler stays a thin envelope — mirrors `walletManager.produceDeviceRegisterProof`.
 *
 * Throws on every failure path (locked wallet, wrong chain, no reward address,
 * wrong password, Nexus rejection); the caller maps that to a `success:false` reply.
 */
export async function authenticateSupportChat(
  wallet: SupportChatSigner | null | undefined,
  keys: unknown,
  auth: SupportChatAuthInput,
): Promise<SupportChatVerifiedIdentity> {
  if (!wallet) throw new Error('Support chat requires an unlocked wallet');
  if (wallet.chain !== CARDANO_CHAIN) throw new Error('Support chat requires a Cardano wallet');
  const stakeAddress = wallet.stakeAddress;
  if (!stakeAddress || !stakeAddress.startsWith('stake1')) {
    throw new Error('Support chat requires a wallet with a reward address');
  }
  return runSupportChatHandshake({
    stakeAddress,
    sign: async (payloadHex: string) => {
      const { signature, key } = await wallet.signData(
        stakeAddress,
        payloadHex,
        auth.password ?? '',
        0,
        keys,
        auth.privateKeyBytes,
      );
      return { signature, key: String(key) };
    },
  });
}
