// Accounts and simulations as Nexus answers them (`POST /api/sol/accounts`, `POST
// /api/sol/txs/simulate`), read strictly: the preview rests on them, so a row that is not
// what it should be throws instead of being guessed at. Lamports are kept exact (the JSON is
// read with them quoted first: they can exceed Number.MAX_SAFE_INTEGER).
import { isValidSolanaAddress } from './solanaKeyManager';

export interface SolanaRemoteAccount {
  address: string;
  exists: boolean;
  lamports: bigint | null;
  /** Owner program. */
  owner: string | null;
  /** The node's parser, e.g. 'spl-token', 'address-lookup-table'. */
  program: string | null;
  /** The node's decoded data ({ type, info }), or null when it could not decode the account. */
  parsed: { type?: unknown; info?: unknown } | null;
}

export interface SolanaRemoteSimulation {
  success: boolean;
  err: unknown;
  logs: string[];
  unitsConsumed: number | null;
  before: SolanaRemoteAccount[];
  /** Null when the simulation failed (Nexus reports nothing to compare). */
  after: SolanaRemoteAccount[] | null;
}

export class SolanaNexusShapeError extends Error {
  constructor(what: string) {
    super(`Unexpected Nexus answer: ${what}`);
    this.name = 'SolanaNexusShapeError';
  }
}

/** Quotes every `"lamports": <digits>` so JSON.parse keeps it exact. */
export function quoteLamports(json: string): string {
  return json.replace(/"lamports"\s*:\s*(\d+)/g, '"lamports":"$1"');
}

function readAccount(value: unknown, expected: string): SolanaRemoteAccount {
  if (!value || typeof value !== 'object') throw new SolanaNexusShapeError('account');
  const v = value as Record<string, unknown>;
  if (v['address'] !== expected) throw new SolanaNexusShapeError('account order');
  if (v['exists'] !== true) {
    return { address: expected, exists: false, lamports: null, owner: null, program: null, parsed: null };
  }
  const lamports = v['lamports'];
  if (lamports != null && !(typeof lamports === 'string' && /^\d+$/.test(lamports))) throw new SolanaNexusShapeError('lamports');
  const owner = v['owner'];
  if (owner != null && !isValidSolanaAddress(owner)) throw new SolanaNexusShapeError('owner');
  const parsed = v['parsed'];
  return {
    address: expected,
    exists: true,
    lamports: lamports == null ? null : BigInt(lamports as string),
    owner: (owner as string | null | undefined) ?? null,
    program: typeof v['program'] === 'string' ? v['program'] : null,
    parsed: parsed && typeof parsed === 'object' ? parsed as SolanaRemoteAccount['parsed'] : null,
  };
}

function readAccounts(value: unknown, expected: readonly string[]): SolanaRemoteAccount[] {
  if (!Array.isArray(value) || value.length !== expected.length) throw new SolanaNexusShapeError('account count');
  return value.map((row, i) => readAccount(row, expected[i]));
}

/** `POST /api/sol/accounts`: the accounts, in the order asked. */
export function parseSolanaAccounts(json: string, expected: readonly string[]): SolanaRemoteAccount[] {
  const body: unknown = JSON.parse(quoteLamports(json));
  if (!body || typeof body !== 'object') throw new SolanaNexusShapeError('accounts');
  return readAccounts((body as Record<string, unknown>)['accounts'], expected);
}

/** `POST /api/sol/txs/simulate`, for the accounts asked. */
export function parseSolanaSimulation(json: string, expected: readonly string[]): SolanaRemoteSimulation {
  const body: unknown = JSON.parse(quoteLamports(json));
  if (!body || typeof body !== 'object') throw new SolanaNexusShapeError('simulation');
  const b = body as Record<string, unknown>;
  if (typeof b['success'] !== 'boolean') throw new SolanaNexusShapeError('success');
  const before = b['before'] as Record<string, unknown> | undefined;
  const after = b['after'];
  const logs = Array.isArray(b['logs']) ? b['logs'].filter((l): l is string => typeof l === 'string') : [];
  return {
    success: b['success'],
    err: b['err'] ?? null,
    logs,
    unitsConsumed: typeof b['unitsConsumed'] === 'number' ? b['unitsConsumed'] : null,
    before: readAccounts(before?.['accounts'], expected),
    after: b['success'] && after != null ? readAccounts(after, expected) : null,
  };
}

/** A token account's parsed fields, or null when `account` is not one. */
export function tokenAccountInfo(account: SolanaRemoteAccount | undefined): { mint: string; owner: string; amount: bigint; decimals: number; delegate: string | null } | null {
  if (!account?.exists || !account.parsed || account.parsed.type !== 'account') return null;
  if (account.program !== 'spl-token' && account.program !== 'spl-token-2022') return null;
  const info = account.parsed.info as Record<string, unknown> | undefined;
  const amount = (info?.['tokenAmount'] as Record<string, unknown> | undefined) ?? {};
  const mint = info?.['mint'];
  const owner = info?.['owner'];
  const raw = amount['amount'];
  const decimals = amount['decimals'];
  if (!isValidSolanaAddress(mint) || !isValidSolanaAddress(owner) || typeof raw !== 'string' || !/^\d+$/.test(raw)
    || typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  const delegate = info?.['delegate'];
  return { mint, owner, amount: BigInt(raw), decimals, delegate: isValidSolanaAddress(delegate) ? delegate : null };
}

export const ADDRESS_LOOKUP_TABLE_PROGRAM = 'AddressLookupTab1e1111111111111111111111111';

/** A lookup table's addresses, or null unless `account` is one owned by the lookup-table program. */
export function lookupTableAddresses(account: SolanaRemoteAccount | undefined): string[] | null {
  if (!account?.exists || account.owner !== ADDRESS_LOOKUP_TABLE_PROGRAM || !account.parsed) return null;
  const addresses = (account.parsed.info as Record<string, unknown> | undefined)?.['addresses'];
  if (!Array.isArray(addresses) || !addresses.every((a) => isValidSolanaAddress(a))) return null;
  return addresses as string[];
}
