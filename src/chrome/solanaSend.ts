/**
 * Gero's own SOL send (extension pages only): `SOLANA_SEND_QUOTE` and `SEND_SOLANA`.
 *
 * The page sends only the recipient, the amount and a fee level. The worker reads the
 * sender, the balance and the priority price itself, applies `checkSolTransfer`, takes a
 * recent blockhash from Nexus, signs in the worker and submits through Nexus. Gero Sync
 * then reports the transaction like any other.
 */
import { SolanaApi } from '@/api/solana-api';
import WalletStore from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import { estimateSolTransferFee } from '@/chains/solana/solanaTransaction';
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

export type SolanaSendErrorCode = SolanaSendRefusal | 'NOT_SOLANA' | 'INVALID_REQUEST' | 'BUILD_FAILED' | 'SUBMIT_FAILED';

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

export async function sendSolana(
  wallet: SolanaSendWallet | null | undefined,
  request: SolanaSendRequest,
  api: Pick<SolanaApi, 'getFees' | 'getBalance' | 'getChainTip' | 'submit'> = new SolanaApi(requireSolana(wallet).network),
): Promise<{ signature: string }> {
  const sender = requireSolana(wallet);
  const { recipientAddress, lamports: rawLamports, feeLevel, password, privateKeyBytes } = request;
  if (typeof recipientAddress !== 'string' || typeof rawLamports !== 'string' || !/^\d+$/.test(rawLamports)) {
    throw new SolanaSendError('INVALID_REQUEST');
  }
  if (feeLevel !== 'standard' && feeLevel !== 'fast') throw new SolanaSendError('INVALID_REQUEST');
  if (password !== undefined && typeof password !== 'string') throw new SolanaSendError('INVALID_REQUEST');
  if (privateKeyBytes !== undefined && !Array.isArray(privateKeyBytes)) throw new SolanaSendError('INVALID_REQUEST');
  const lamports = BigInt(rawLamports);

  const fees = await api.getFees().catch(() => undefined);
  const priority = priorityPriceFor(feeLevel, fees?.prioritizationFeeMicroLamports);
  // Sending less than the rent-exempt minimum to an empty account fails on chain, so ask.
  // An unreadable recipient skips that rule rather than blocking the send.
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

  let signed: { signature: string; base64: string };
  try {
    const tip = await api.getChainTip();
    const prfSecret = privateKeyBytes ? new Uint8Array(privateKeyBytes as number[]) : undefined;
    signed = await sender.signSolanaTransfer(
      { to: recipientAddress, lamports, recentBlockhash: tip.blockhash, computeUnitPriceMicroLamports: priority },
      password as string | undefined,
      prfSecret,
    );
    prfSecret?.fill(0);
  } catch (error) {
    if (error instanceof SolanaSendError) throw error;
    // A wrong password, a refused PassKey or a mismatched record: the page shows its own text.
    throw Object.assign(new SolanaSendError('BUILD_FAILED'), { cause: error });
  }

  try {
    const signature = await api.submit(signed.base64);
    return { signature: signature || signed.signature };
  } catch (error) {
    throw Object.assign(new SolanaSendError('SUBMIT_FAILED'), { cause: error });
  }
}

/** The code a page sees for a failed quote or send: a known code, or BUILD_FAILED (never raw text). */
export function solanaSendErrorCode(error: unknown): SolanaSendErrorCode {
  if (error instanceof SolanaSendError) return error.code;
  return 'BUILD_FAILED';
}
