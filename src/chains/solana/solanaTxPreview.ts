// The preview a user approves before Gero signs a dApp's Solana transaction. Built in the worker
// from the decoded transaction (solanaTxWire / solanaTxInstructions) and Nexus's simulation of
// it: the wallet's SOL and token balance changes come from comparing its accounts before and
// after, so what a dApp program does inside (a CPI) shows too, not only the instructions the
// wallet can read. Serializable (amounts are decimal strings): it crosses to the side panel.
import type { SolanaResolvedKey } from './solanaTxWire';
import { KNOWN_PROGRAMS, SYSTEM_PROGRAM, type SolanaStaticAnalysis, type SolanaStaticWarning } from './solanaTxInstructions';
import { tokenAccountInfo, type SolanaRemoteSimulation } from './solanaNexusAccounts';

/** Nexus simulates at most this many accounts per call. */
export const SOLANA_SIMULATION_MAX_ACCOUNTS = 32;

export type SolanaSimulationWarning =
  | { code: 'SIMULATION_FAILED'; severity: 'warning' }
  | { code: 'SIMULATION_UNAVAILABLE'; severity: 'warning' }
  | { code: 'NOT_ALL_ACCOUNTS_CHECKED'; severity: 'warning' }
  | { code: 'UNKNOWN_PROGRAMS'; severity: 'warning'; programs: string[] }
  | { code: 'WALLET_OWNER_CHANGED'; severity: 'critical'; newOwner: string }
  | { code: 'TOKEN_ACCOUNT_OWNER_CHANGED'; severity: 'critical'; account: string; newOwner: string }
  | { code: 'TOKEN_DELEGATE_SET'; severity: 'critical'; account: string; delegate: string };

export type SolanaPreviewWarning = SolanaStaticWarning | SolanaSimulationWarning;

export interface SolanaTokenChange {
  mint: string;
  decimals: number;
  /** Signed raw units, e.g. "-2500000". */
  change: string;
}

export interface SolanaTxPreview {
  /** The simulation ran and succeeded, so the balance changes below are known. */
  simulated: boolean;
  /** The wallet's SOL change in lamports (signed), as simulated; null when not simulated. */
  solChange: string | null;
  tokenChanges: SolanaTokenChange[];
  feeLamports: string;
  feePayerIsWallet: boolean;
  programs: Array<{ address: string; name: string | null }>;
  instructionCount: number;
  warnings: SolanaPreviewWarning[];
  /** A critical warning: the user must acknowledge it before signing. */
  requiresAcknowledgement: boolean;
}

/**
 * The accounts to simulate: the wallet first, then every other writable account of the
 * transaction (where its tokens could move), at most SOLANA_SIMULATION_MAX_ACCOUNTS.
 */
export function solanaAccountsToWatch(keys: readonly SolanaResolvedKey[], wallet: string): { accounts: string[]; complete: boolean } {
  const writable = [...new Set(keys.filter((k) => k.writable && k.address !== wallet).map((k) => k.address))];
  const accounts = [wallet, ...writable].slice(0, SOLANA_SIMULATION_MAX_ACCOUNTS);
  return { accounts, complete: writable.length + 1 <= SOLANA_SIMULATION_MAX_ACCOUNTS };
}

export function buildSolanaTxPreview(input: {
  wallet: string;
  analysis: SolanaStaticAnalysis;
  instructionCount: number;
  watched: { accounts: string[]; complete: boolean };
  /** Null when Nexus could not simulate (network, outage): the preview says so. */
  simulation: SolanaRemoteSimulation | null;
}): SolanaTxPreview {
  const { wallet, analysis, watched, simulation } = input;
  const warnings: SolanaPreviewWarning[] = [...analysis.warnings];
  const has = (code: string, account?: string) =>
    warnings.some((w) => w.code === code && (account === undefined || ('account' in w && w.account === account)));

  let solChange: string | null = null;
  const tokenTotals = new Map<string, { decimals: number; change: bigint }>();
  const simulated = !!simulation?.success && !!simulation.after;

  if (!simulation) {
    warnings.push({ code: 'SIMULATION_UNAVAILABLE', severity: 'warning' });
  } else if (!simulated) {
    warnings.push({ code: 'SIMULATION_FAILED', severity: 'warning' });
  } else {
    const before = simulation.before;
    const after = simulation.after as NonNullable<SolanaRemoteSimulation['after']>;
    // The wallet is watched first.
    const walletBefore = before[0];
    const walletAfter = after[0];
    solChange = ((walletAfter?.exists ? walletAfter.lamports ?? 0n : 0n) - (walletBefore?.exists ? walletBefore.lamports ?? 0n : 0n)).toString();
    const ownerBefore = walletBefore?.exists ? walletBefore.owner : SYSTEM_PROGRAM;
    if (walletAfter?.exists && walletAfter.owner && walletAfter.owner !== ownerBefore && !has('ASSIGNS_WALLET')) {
      warnings.push({ code: 'WALLET_OWNER_CHANGED', severity: 'critical', newOwner: walletAfter.owner });
    }
    for (let i = 1; i < watched.accounts.length; i++) {
      const b = tokenAccountInfo(before[i]);
      const a = tokenAccountInfo(after[i]);
      const ownedBefore = b?.owner === wallet;
      const ownedAfter = a?.owner === wallet;
      if (!ownedBefore && !ownedAfter) continue;
      const mint = (a ?? b)!.mint;
      const decimals = (a ?? b)!.decimals;
      const change = (ownedAfter ? a!.amount : 0n) - (ownedBefore ? b!.amount : 0n);
      const total = tokenTotals.get(mint) ?? { decimals, change: 0n };
      total.change += change;
      tokenTotals.set(mint, total);
      const account = watched.accounts[i];
      if (ownedBefore && a && !ownedAfter && !has('GIVES_TOKEN_AUTHORITY', account)) {
        warnings.push({ code: 'TOKEN_ACCOUNT_OWNER_CHANGED', severity: 'critical', account, newOwner: a.owner });
      }
      if (ownedAfter && a?.delegate && a.delegate !== wallet && a.delegate !== b?.delegate && !has('TOKEN_DELEGATE', account)) {
        warnings.push({ code: 'TOKEN_DELEGATE_SET', severity: 'critical', account, delegate: a.delegate });
      }
    }
  }
  if (!watched.complete) warnings.push({ code: 'NOT_ALL_ACCOUNTS_CHECKED', severity: 'warning' });
  if (analysis.unknownPrograms.length) {
    warnings.push({ code: 'UNKNOWN_PROGRAMS', severity: 'warning', programs: analysis.unknownPrograms });
  }

  return {
    simulated,
    solChange,
    tokenChanges: [...tokenTotals.entries()]
      .filter(([, t]) => t.change !== 0n)
      .map(([mint, t]) => ({ mint, decimals: t.decimals, change: t.change.toString() })),
    feeLamports: analysis.feeLamports.toString(),
    feePayerIsWallet: analysis.feePayer === wallet,
    programs: analysis.programs.map((address) => ({ address, name: KNOWN_PROGRAMS[address] ?? null })),
    instructionCount: input.instructionCount,
    warnings,
    requiresAcknowledgement: warnings.some((w) => w.severity === 'critical'),
  };
}
