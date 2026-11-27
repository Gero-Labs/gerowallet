/**
 * The i18n key of every code the invitation screens can show, in one place (as `create/messages.ts`),
 * so a spec checks each exists in every language and no screen builds a key it cannot list.
 */
import type { ResolveProblem } from '@/services/vaultInvites/resolveCosigner';
import type { InviteClientCode } from './inviteClient';
import { TIME_KEYS } from './inviteTime';

export const INVITE_PROBLEM_KEYS: Readonly<Record<InviteClientCode, string>> = {
  NOT_FOUND: 'gerovault.invite.problem.NOT_FOUND',
  INVALID_INPUT: 'gerovault.invite.problem.INVALID_INPUT',
  INVALID_NAME: 'gerovault.create.labelRule',
  LOCKED: 'gerovault.invite.problem.LOCKED',
  WRONG_PASSWORD: 'gerovault.create.own.problem.wrongPassword',
  WALLET_LOCKED: 'gerovault.create.own.problem.locked',
  NOT_SUPPORTED: 'gerovault.create.own.problem.notSupported',
  WRONG_NETWORK: 'gerovault.invite.problem.WRONG_NETWORK',
  NOT_ADDRESSED: 'gerovault.invite.problem.NOT_ADDRESSED',
  NOT_BACKED_UP: 'gerovault.invite.problem.NOT_BACKED_UP',
  TOO_MANY_PENDING: 'gerovault.create.own.problem.tooManyPending',
  INDEX_SPACE_EXHAUSTED: 'gerovault.create.own.problem.indexSpace',
  INVALID_HISTORY: 'gerovault.create.own.problem.history',
  EXPIRED: 'gerovault.invite.problem.EXPIRED',
  REVOKED: 'gerovault.invite.problem.REVOKED',
  ALREADY_ANSWERED: 'gerovault.invite.problem.ALREADY_ANSWERED',
  ALREADY_JOINED: 'gerovault.invite.problem.ALREADY_JOINED',
  LIMIT_EXCEEDED: 'gerovault.invite.problem.LIMIT_EXCEEDED',
  RATE_LIMITED: 'gerovault.invite.problem.RATE_LIMITED',
  SLOT_TAKEN: 'gerovault.invite.problem.SLOT_TAKEN',
  TERMS_LOCKED: 'gerovault.invite.problem.TERMS_LOCKED',
  BROKEN_SERVER: 'gerovault.invite.problem.BROKEN_SERVER',
  REFUSED: 'gerovault.invite.problem.REFUSED',
  NETWORK: 'gerovault.invite.problem.NETWORK',
  SERVER: 'gerovault.invite.problem.SERVER',
  UNAVAILABLE: 'gerovault.create.own.problem.unavailable',
  CANCELLED: 'gerovault.create.own.problem.cancelled',
};

export const RESOLVE_PROBLEM_KEYS: Readonly<Record<ResolveProblem, string>> = {
  EMPTY: 'gerovault.invite.resolve.EMPTY',
  NOT_AN_ADDRESS: 'gerovault.invite.resolve.NOT_AN_ADDRESS',
  WRONG_NETWORK: 'gerovault.invite.resolve.WRONG_NETWORK',
  NO_STAKE_KEY: 'gerovault.invite.resolve.NO_STAKE_KEY',
  SCRIPT_STAKE_KEY: 'gerovault.invite.resolve.SCRIPT_STAKE_KEY',
  HANDLE_NOT_FOUND: 'gerovault.invite.resolve.HANDLE_NOT_FOUND',
  HANDLE_UNAVAILABLE: 'gerovault.invite.resolve.HANDLE_UNAVAILABLE',
  SELF: 'gerovault.invite.resolve.SELF',
};

export function inviteProblemKey(code: string): string {
  return (INVITE_PROBLEM_KEYS as Record<string, string>)[code] ?? INVITE_PROBLEM_KEYS.SERVER;
}

/** "Gero Sync is busy. Retrying in N s." (a 429 from gero-sync), by how long is left. */
export const BUSY_KEYS = { seconds: 'gerovault.invite.busy.seconds', minutes: 'gerovault.invite.busy.minutes' } as const;

/** The busy line for a wait that ends at `until` (ms): seconds under two minutes, minutes above. */
export function busyMessage(until: number, now: number): { key: string; n: number } {
  const seconds = Math.max(1, Math.ceil((until - now) / 1000));
  return seconds < 120 ? { key: BUSY_KEYS.seconds, n: seconds } : { key: BUSY_KEYS.minutes, n: Math.ceil(seconds / 60) };
}

/** Other lines of the invitation screens that no code maps to. */
export const INVITE_NOTE_KEYS: readonly string[] = ['gerovault.invite.card.reminded', 'gerovault.invite.setup.duplicate', ...Object.values(BUSY_KEYS)];

/** Every key above, for the catalog spec. */
export const ALL_INVITE_MESSAGE_KEYS: readonly string[] = [...new Set([...Object.values(INVITE_PROBLEM_KEYS), ...Object.values(RESOLVE_PROBLEM_KEYS), ...TIME_KEYS, ...INVITE_NOTE_KEYS])];
