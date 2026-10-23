import type { Wallet } from '@/models/types';
import { accountGroup } from '@/shared/utils/walletAccount';

/** An approved dApp connect prompt: the account the user chose, when they had a choice. */
export interface ConnectApproval {
  accountId?: number;
}

/**
 * A dApp connect prompt counts as approved only on an explicit answer:
 * `data === true` (connect the logged account), or `{ accountId }` naming the
 * account of its group the user picked (#1331). Truthy look-alikes (`{}`, `[]`,
 * a string, an object without a valid id) are a decline or a malformed answer:
 * the popup's Decline button used to send `{ data: {} }`, which the Bitcoin
 * enable handler read as "approved" and connected the site.
 */
export function readConnectApproval(response: { data?: unknown } | null | undefined): ConnectApproval | null {
  const data = response?.data;
  if (data === true) return {};
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const { accountId } = data as { accountId?: unknown };
  return typeof accountId === 'number' && Number.isSafeInteger(accountId) && accountId > 0 ? { accountId } : null;
}

export function isConnectApproval(response: { data?: unknown } | null | undefined): boolean {
  return readConnectApproval(response) !== null;
}

/** Side-panel methods whose approval may name an account to connect. */
const CONNECT_METHODS = new Set(['enable', 'midnight_connect']);

/**
 * The side panel refuses an approval answered after the active wallet changed.
 * One is let through: a connect approval naming the account that is active now.
 * Gero switched to it for that same choice (the duplicate enable() calls a dApp
 * fires get the answer of the first), so the site connects exactly the account
 * the user picked.
 */
export function approvalNamesActiveAccount(method: string, response: { data?: unknown }, activeWalletId: unknown): boolean {
  if (!CONNECT_METHODS.has(method)) return false;
  const accountId = readConnectApproval(response)?.accountId;
  return accountId !== undefined && accountId === activeWalletId;
}

/** What a connect prompt answers when the user approves with `accountId` selected among `accountCount` accounts. */
export function connectApprovalData(accountId: number | undefined, accountCount: number): true | { accountId: number } {
  return accountCount > 1 && accountId !== undefined ? { accountId } : true;
}

/**
 * The record an approval names, when it is an account of the group of the wallet
 * the prompt was shown for. Null for any other id: a page can only ever pick
 * among the accounts the user was offered.
 */
export function connectTarget<T extends Wallet>(accountId: number, shownForId: number | undefined, wallets: Record<number, T>): T | null {
  const shownFor = shownForId !== undefined ? wallets[shownForId] : undefined;
  if (!shownFor) return null;
  return accountGroup(shownFor, wallets).find((account) => account.id === accountId) ?? null;
}

/** What connecting an approved prompt needs from the background. */
export interface ConnectDeps<W extends { id: number }> {
  /** The wallet logged in now. */
  loggedWallet(): W | null;
  /** Every wallet record, by id, from the database. */
  wallets(): Promise<Record<number, Wallet>>;
  /** Logs a record in, as the wallet list does; the wallet then logged in. */
  login(record: Wallet): Promise<W | null>;
  /** Adds `origin` to the record's connected sites. */
  addConnectedDapp(walletId: number, origin: string): Promise<void>;
}

/**
 * Connects `origin` to the account an approved connect prompt names (#1331) and
 * returns that wallet: the logged one, or the account of its group the user
 * picked, logged in first as the account switcher does (inside a group nothing
 * is unlocked again). Null, connecting nothing, when the pick is not an account
 * of the wallet the prompt was shown for, or the switch failed. The background
 * only ever signs for the logged record, so connections stay per account.
 */
export async function connectApprovedAccount<W extends { id: number }>(
  approval: ConnectApproval,
  shownForId: number | undefined,
  origin: string,
  deps: ConnectDeps<W>,
): Promise<W | null> {
  let wallet = deps.loggedWallet();
  if (approval.accountId !== undefined) {
    const target = connectTarget(approval.accountId, shownForId ?? wallet?.id, await deps.wallets());
    if (!target) return null;
    // The logged account itself needs no switch.
    if (target.id !== wallet?.id) {
      wallet = await deps.login(target);
      if (wallet?.id !== target.id) return null;
    }
  }
  if (!wallet) return null;
  await deps.addConnectedDapp(wallet.id, origin);
  return wallet;
}
