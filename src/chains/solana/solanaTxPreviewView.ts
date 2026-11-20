// How the side panel shows a SolanaTxPreview: signed amounts and the i18n key of each warning.
// Pure, so the wording a user signs against is tested.
import { formatUnits, SOL_DECIMALS } from './solanaAmount';
import type { SolanaPreviewWarning, SolanaTxPreview } from './solanaTxPreview';

export interface SolanaChangeRow {
  /** 'SOL' or the token's mint. */
  asset: string;
  isSol: boolean;
  /** "+1.5" / "−0.25" (true minus sign), trailing zeros trimmed. */
  amount: string;
  direction: 'in' | 'out';
}

/** A signed raw amount as "+x" / "−x"; null for zero. */
export function signedUnits(raw: string, decimals: number): { amount: string; direction: 'in' | 'out' } | null {
  if (!/^-?\d+$/.test(raw)) return null;
  const negative = raw.startsWith('-');
  const magnitude = negative ? raw.slice(1) : raw;
  if (/^0+$/.test(magnitude)) return null;
  return { amount: `${negative ? '−' : '+'}${formatUnits(magnitude, decimals)}`, direction: negative ? 'out' : 'in' };
}

export function solanaChangeRows(preview: Pick<SolanaTxPreview, 'solChange' | 'tokenChanges'>): SolanaChangeRow[] {
  const rows: SolanaChangeRow[] = [];
  const sol = preview.solChange === null ? null : signedUnits(preview.solChange, SOL_DECIMALS);
  if (sol) rows.push({ asset: 'SOL', isSol: true, ...sol });
  for (const token of preview.tokenChanges) {
    const change = signedUnits(token.change, token.decimals);
    if (change) rows.push({ asset: token.mint, isSol: false, ...change });
  }
  return rows;
}

/** The i18n key that says what a warning means for the user. */
export function solanaWarningKey(warning: SolanaPreviewWarning): string {
  switch (warning.code) {
    case 'ASSIGNS_WALLET':
    case 'WALLET_OWNER_CHANGED':
      return 'solana.dapp.warn.assignsWallet';
    case 'GIVES_TOKEN_AUTHORITY':
    case 'TOKEN_ACCOUNT_OWNER_CHANGED':
      return 'solana.dapp.warn.givesTokenAccount';
    case 'NONCE_AUTHORITY':
      return 'solana.dapp.warn.nonceAuthority';
    case 'TOKEN_DELEGATE':
      return warning.unlimited ? 'solana.dapp.warn.delegateUnlimited' : 'solana.dapp.warn.delegate';
    case 'TOKEN_DELEGATE_SET':
      return 'solana.dapp.warn.delegate';
    case 'CLOSES_TO_OTHER':
      return 'solana.dapp.warn.closesToOther';
    case 'DURABLE_NONCE':
      return 'solana.dapp.warn.durableNonce';
    case 'SIMULATION_FAILED':
      return 'solana.dapp.warn.simulationFailed';
    case 'SIMULATION_UNAVAILABLE':
      return 'solana.dapp.warn.simulationUnavailable';
    case 'NOT_ALL_ACCOUNTS_CHECKED':
      return 'solana.dapp.warn.notAllChecked';
    case 'UNKNOWN_PROGRAMS':
      return 'solana.dapp.warn.unknownPrograms';
  }
}

/** Critical warnings first, each key once. */
export function solanaWarningRows(preview: Pick<SolanaTxPreview, 'warnings'>): Array<{ key: string; critical: boolean }> {
  const seen = new Set<string>();
  const rows: Array<{ key: string; critical: boolean }> = [];
  for (const critical of [true, false]) {
    for (const w of preview.warnings) {
      if ((w.severity === 'critical') !== critical) continue;
      const key = solanaWarningKey(w);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ key, critical });
    }
  }
  return rows;
}
