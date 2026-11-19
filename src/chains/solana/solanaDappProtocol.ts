// The Solana dApp connection's shared vocabulary: error codes and shapes, the Wallet Standard
// chain ids, and the checks on byte arrays that cross from the page. Imported by the page
// bundle (inject), the worker and the side panel, so it has no runtime dependencies.

/**
 * Error codes dApps already branch on (Phantom's provider errors, EIP-1193 style):
 * 4001 the user declined, 4100 not connected or not allowed, 4200 not supported,
 * -32602 bad request, -32603 the wallet failed.
 */
export const SolanaDappErrorCode = {
  UserRejected: 4001,
  Unauthorized: 4100,
  Unsupported: 4200,
  InvalidParams: -32602,
  Internal: -32603,
} as const;

export type SolanaDappErrorCodeValue = (typeof SolanaDappErrorCode)[keyof typeof SolanaDappErrorCode];

/** What crosses chrome messaging and `postMessage` (an Error cannot). */
export interface SolanaDappErrorShape {
  type: 'SolanaWalletError';
  code: number;
  message: string;
}

const CODES = new Set<number>(Object.values(SolanaDappErrorCode));

export function solanaDappError(code: SolanaDappErrorCodeValue, message: string): SolanaDappErrorShape {
  return { type: 'SolanaWalletError', code, message };
}

function isSolanaDappErrorShape(value: unknown): value is SolanaDappErrorShape {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v['type'] === 'SolanaWalletError' && typeof v['code'] === 'number' && CODES.has(v['code'])
    && typeof v['message'] === 'string';
}

/**
 * The side panel answers over a port that carries a plain string, so a decline is
 * JSON-encoded (`encodeSolanaPanelError`) and decoded by the worker. Anything that is not
 * such a string becomes `fallback`: only the panel's own explicit decline is UserRejected.
 */
export function encodeSolanaPanelError(code: SolanaDappErrorCodeValue, message: string): string {
  return JSON.stringify(solanaDappError(code, message));
}

export function parseSolanaPanelError(error: unknown, fallback: SolanaDappErrorShape): SolanaDappErrorShape {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  try {
    const parsed: unknown = JSON.parse(text);
    if (isSolanaDappErrorShape(parsed)) return parsed;
  } catch { /* not an encoded Solana error */ }
  return fallback;
}

/** The Error a dApp receives: `code` and `message` as Phantom's provider errors carry them. */
export function toSolanaPageError(error: unknown): Error {
  const shape = isSolanaDappErrorShape(error)
    ? error
    : solanaDappError(SolanaDappErrorCode.Internal, 'The wallet could not complete the request');
  const out = new Error(shape.message) as Error & { code: number };
  out.name = 'SolanaWalletError';
  out.code = shape.code;
  return out;
}

export type SolanaChainId = 'solana:mainnet' | 'solana:devnet';

/** Wallet Standard chain id of a Gero Solana network ('Mainnet' / 'Devnet'). */
export function solanaChainId(network: string | undefined): SolanaChainId {
  return network === 'Mainnet' ? 'solana:mainnet' : 'solana:devnet';
}

/**
 * Bytes sent from the page as a plain array (postMessage and chrome messaging carry no
 * Uint8Array). Null unless it is an array of 0..255 integers no longer than `maxLength`.
 */
export function bytesFromWire(value: unknown, maxLength: number): Uint8Array | null {
  if (!Array.isArray(value) || value.length > maxLength) return null;
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const byte = value[i];
    if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) return null;
    out[i] = byte;
  }
  return out;
}
