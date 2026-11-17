import { Network } from '@/models/types';
import { isValidSolanaAddress } from './solanaKeyManager';

const SOLSCAN = 'https://solscan.io';
// A signature is 64 bytes: 87 or 88 base58 characters.
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/** Solscan page of a transaction or an account, or '' for anything that is neither. */
export function solscanUrl(kind: 'tx' | 'account', id: string, network: string): string {
  const valid = kind === 'tx' ? SIGNATURE.test(id) : isValidSolanaAddress(id);
  if (!valid) return '';
  const cluster = network === Network.MAINNET ? '' : '?cluster=devnet';
  return `${SOLSCAN}/${kind}/${id}${cluster}`;
}
