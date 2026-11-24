/**
 * Gero's own SOL send (extension pages only): `SOLANA_SEND_QUOTE` and `SEND_SOLANA`.
 *
 * The page sends only the recipient, the amount and a fee level. The worker reads the
 * sender, the balance and the priority price itself, applies `checkSolTransfer`, takes a
 * recent blockhash from Nexus, signs in the worker and submits through Nexus. Gero Sync
 * then reports the transaction like any other.
 *
 * A hardware wallet (Ledger, Trezor, Keystone: solanaHardwarePolicy.ts) signs in the page, so
 * its send is two steps: `PREPARE_SOLANA_SEND` runs the same checks, builds the transfer message
 * and holds it for that account; the page has the device sign those bytes and
 * `SUBMIT_SOLANA_SEND` takes only the signature. The worker checks it is the account's signature
 * over the message it built, assembles the transaction and submits it. The page never supplies
 * the bytes that are sent.
 */
import { SolanaApi } from '@/api/solana-api';
import WalletStore from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import {
  buildSolTransferMessage,
  compactU16,
  estimateSolTransferFee,
  MAX_TRANSACTION_BYTES,
  verifySolanaSignature,
} from '@/chains/solana/solanaTransaction';
import { base58Decode, base58Encode } from '@/chains/solana/solanaBase58';
import { bytesToBase64 } from '@/chrome/solanaDappTx';
import { parseRawAmount } from '@/chains/solana/solanaAmount';
import {
  checkSolTransfer,
  priorityPriceFor,
  type SolanaFeeLevel,
  type SolanaSendRefusal,
} from '@/chains/solana/solanaSendRules';

/** The part of WalletBg this module uses. */
export interface SolanaSendWallet {
  chain: string;
  network: string;
  publicKey: string;
  signSolanaTransfer(
    params: { to: string; lamports: bigint; recentBlockhash: string; computeUnitPriceMicroLamports?: bigint },
    password?: string,
    prfSecret?: Uint8Array,
  ): Promise<{ signature: string; base64: string }>;
}

export type SolanaSendErrorCode =
  | SolanaSendRefusal | 'NOT_SOLANA' | 'INVALID_REQUEST' | 'BUILD_FAILED' | 'SUBMIT_FAILED' | 'SEND_EXPIRED' | 'BAD_SIGNATURE';

export class SolanaSendError extends Error {
  constructor(readonly code: SolanaSendErrorCode) {
    super(code);
  }
}

export interface SolanaSendQuote {
  /** Lamports the transfer pays at each level. Decimal strings. */
  fees: Record<SolanaFeeLevel, string>;
  /** Priority price per level, micro-lamports per compute unit. Decimal strings. */
  prices: Record<SolanaFeeLevel, string>;
  /** false when Nexus's fee sample could not be read: both levels then pay the base fee only. */
  live: boolean;
}

const LEVELS: SolanaFeeLevel[] = ['standard', 'fast'];

function requireSolana(wallet: SolanaSendWallet | null | undefined): SolanaSendWallet {
  if (!wallet || wallet.chain !== Blockchain.SOLANA) throw new SolanaSendError('NOT_SOLANA');
  return wallet;
}

function knownBalance(): bigint | null {
  const lamports = WalletStore.state.solana?.lamports;
  return lamports == null ? null : parseRawAmount(lamports);
}

export async function quoteSolanaSend(
  wallet: SolanaSendWallet | null | undefined,
  api: Pick<SolanaApi, 'getFees'> = new SolanaApi(requireSolana(wallet).network),
): Promise<SolanaSendQuote> {
  requireSolana(wallet);
  const fees = await api.getFees().catch(() => undefined);
  const prices = fees?.prioritizationFeeMicroLamports;
  const quote: SolanaSendQuote = { fees: { standard: '0', fast: '0' }, prices: { standard: '0', fast: '0' }, live: !!prices };
  for (const level of LEVELS) {
    const price = priorityPriceFor(level, prices);
    quote.prices[level] = price.toString();
    quote.fees[level] = estimateSolTransferFee(price).toString();
  }
  return quote;
}

export interface SolanaSendRequest {
  recipientAddress?: unknown;
  lamports?: unknown;
  feeLevel?: unknown;
  password?: unknown;
  privateKeyBytes?: unknown;
}

interface CheckedTransfer {
  to: string;
  lamports: bigint;
  priority: bigint;
}

/** The request's transfer, refused unless it passes checkSolTransfer against what the worker reads. */
async function checkedTransfer(
  sender: SolanaSendWallet,
  request: SolanaSendRequest,
  api: Pick<SolanaApi, 'getFees' | 'getBalance'>,
): Promise<CheckedTransfer> {
  const { recipientAddress, lamports: rawLamports, feeLevel } = request;
  if (typeof recipientAddress !== 'string' || typeof rawLamports !== 'string' || !/^\d+$/.test(rawLamports)) {
    throw new SolanaSendError('INVALID_REQUEST');
  }
  if (feeLevel !== 'standard' && feeLevel !== 'fast') throw new SolanaSendError('INVALID_REQUEST');
  const lamports = BigInt(rawLamports);

  const fees = await api.getFees().catch(() => undefined);
  const priority = priorityPriceFor(feeLevel, fees?.prioritizationFeeMicroLamports);
  // Sending less than the rent-exempt minimum to an empty account fails on chain, so ask.
  // An unreadable recipient (null) refuses only an amount below that minimum, with its own
  // code: such a transfer could fail on chain after the user signed it.
  const recipientBalance = await api.getBalance(recipientAddress).then((b) => b.lamports).catch(() => null);
  const refusal = checkSolTransfer({
    from: sender.publicKey,
    to: recipientAddress,
    lamports,
    balance: knownBalance(),
    priorityMicroLamports: priority,
    recipientBalance,
  });
  if (refusal) throw new SolanaSendError(refusal);
  return { to: recipientAddress, lamports, priority };
}

async function submitSigned(api: Pick<SolanaApi, 'submit'>, base64: string, fallbackSignature: string): Promise<{ signature: string }> {
  try {
    const signature = await api.submit(base64);
    return { signature: signature || fallbackSignature };
  } catch (error) {
    throw Object.assign(new SolanaSendError('SUBMIT_FAILED'), { cause: error });
  }
}

export async function sendSolana(
  wallet: SolanaSendWallet | null | undefined,
  request: SolanaSendRequest,
  api: Pick<SolanaApi, 'getFees' | 'getBalance' | 'getChainTip' | 'submit'> = new SolanaApi(requireSolana(wallet).network),
): Promise<{ signature: string }> {
  const sender = requireSolana(wallet);
  const { password, privateKeyBytes } = request;
  if (password !== undefined && typeof password !== 'string') throw new SolanaSendError('INVALID_REQUEST');
  if (privateKeyBytes !== undefined && !Array.isArray(privateKeyBytes)) throw new SolanaSendError('INVALID_REQUEST');
  const { to, lamports, priority } = await checkedTransfer(sender, request, api);

  let signed: { signature: string; base64: string };
  const prfSecret = privateKeyBytes ? new Uint8Array(privateKeyBytes as number[]) : undefined;
  try {
    const tip = await api.getChainTip();
    signed = await sender.signSolanaTransfer(
      { to, lamports, recentBlockhash: tip.blockhash, computeUnitPriceMicroLamports: priority },
      password as string | undefined,
      prfSecret,
    );
  } catch (error) {
    if (error instanceof SolanaSendError) throw error;
    // A wrong password, a refused PassKey or a mismatched record: the page shows its own text.
    throw Object.assign(new SolanaSendError('BUILD_FAILED'), { cause: error });
  } finally {
    prfSecret?.fill(0);
    if (Array.isArray(privateKeyBytes)) privateKeyBytes.fill(0);
  }

  return submitSigned(api, signed.base64, signed.signature);
}

/**
 * How long a prepared hardware send waits for its signature. Its blockhash expires on chain
 * after about a minute anyway (Nexus's preflight then refuses it: nothing is sent); this only
 * bounds how long the worker holds the message.
 */
export const SOLANA_HARDWARE_SEND_TTL_MS = 5 * 60_000;

interface PendingHardwareSend {
  message: Uint8Array;
  expires: number;
}

/** One prepared send per account (`network:address`); a new prepare replaces it. Worker memory only. */
const pendingHardwareSends = new Map<string, PendingHardwareSend>();

const pendingKey = (wallet: SolanaSendWallet) => `${wallet.network}:${wallet.publicKey}`;

/** The transfer message a hardware wallet signs for this request (`PREPARE_SOLANA_SEND`). */
export async function prepareSolanaHardwareSend(
  wallet: SolanaSendWallet | null | undefined,
  request: SolanaSendRequest,
  api: Pick<SolanaApi, 'getFees' | 'getBalance' | 'getChainTip'> = new SolanaApi(requireSolana(wallet).network),
  now = Date.now(),
): Promise<{ message: number[] }> {
  const sender = requireSolana(wallet);
  const { to, lamports, priority } = await checkedTransfer(sender, request, api);
  let message: Uint8Array;
  try {
    const tip = await api.getChainTip();
    message = buildSolTransferMessage({
      from: sender.publicKey, to, lamports, recentBlockhash: tip.blockhash, computeUnitPriceMicroLamports: priority,
    });
  } catch (error) {
    throw Object.assign(new SolanaSendError('BUILD_FAILED'), { cause: error });
  }
  // Drop sends no account came back for (another account's, or one abandoned before signing).
  for (const [key, pending] of pendingHardwareSends) if (pending.expires <= now) pendingHardwareSends.delete(key);
  pendingHardwareSends.set(pendingKey(sender), { message, expires: now + SOLANA_HARDWARE_SEND_TTL_MS });
  return { message: Array.from(message) };
}

/**
 * Submits the prepared send with the device's signature (`SUBMIT_SOLANA_SEND`). The signature
 * must be the account's over the exact message the worker built. A wrong signature keeps the
 * prepared send (the user may sign again); a submit uses it up.
 */
export async function submitSolanaHardwareSend(
  wallet: SolanaSendWallet | null | undefined,
  request: { signature?: unknown },
  api: Pick<SolanaApi, 'submit'> = new SolanaApi(requireSolana(wallet).network),
  now = Date.now(),
): Promise<{ signature: string }> {
  const sender = requireSolana(wallet);
  const raw = request.signature;
  if (!Array.isArray(raw) || raw.length !== 64 || !raw.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw new SolanaSendError('INVALID_REQUEST');
  }
  const signature = Uint8Array.from(raw as number[]);
  const key = pendingKey(sender);
  const pending = pendingHardwareSends.get(key);
  if (!pending || pending.expires <= now) {
    pendingHardwareSends.delete(key);
    throw new SolanaSendError('SEND_EXPIRED');
  }
  if (!verifySolanaSignature(signature, pending.message, base58Decode(sender.publicKey))) {
    throw new SolanaSendError('BAD_SIGNATURE');
  }
  pendingHardwareSends.delete(key);
  const transaction = new Uint8Array(1 + 64 + pending.message.length);
  transaction.set(compactU16(1), 0);
  transaction.set(signature, 1);
  transaction.set(pending.message, 65);
  if (transaction.length > MAX_TRANSACTION_BYTES) throw new SolanaSendError('BUILD_FAILED');
  return submitSigned(api, bytesToBase64(transaction), base58Encode(signature));
}

/** Drops every prepared hardware send (tests). */
export function clearSolanaHardwareSends(): void {
  pendingHardwareSends.clear();
}

/** The code a page sees for a failed quote or send: a known code, or BUILD_FAILED (never raw text). */
export function solanaSendErrorCode(error: unknown): SolanaSendErrorCode {
  if (error instanceof SolanaSendError) return error.code;
  return 'BUILD_FAILED';
}
