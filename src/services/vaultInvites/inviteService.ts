/**
 * GeroVault cosigner invitations, the background side (`PROTOCOL.md` section 6): everything that
 * holds a secret or talks to gero-sync. Pages call it through `GEROVAULT_INVITE_*` messages
 * (`src/chrome/vaultInviteHandlers.ts`) and get views without secrets back.
 *
 * Initiator: start a setup (the vault index and keys of this wallet), invite a cosigner by stake
 * credential, show a one-time QR or copy a link, poll the answers and fill each cosigner slot
 * from an ACCEPT only after its seal, digest, invitation, MAC and signature checked out
 * (`openAcceptResponse`), remind, revoke, cancel.
 * Cosigner: list and open invitations (mailbox or link), accept (next free index, this vault's
 * public keys only, one approval), decline (nothing about the wallet), block.
 *
 * Fail closed: anything gero-sync hands over that does not open and check is dropped and counted,
 * never shown half. An accepted cosigner is Unverified until the GV-61 number is read; nothing here
 * verifies a vault.
 *
 * Dependencies are injected so the whole flow runs in a test with a fake transport.
 */
import {
  MAX_INVITE_LIFETIME_S,
  WIRE_NETWORK,
  acceptDigest,
  acceptMac,
  acceptSubject,
  deriveLinkSecrets,
  encodeDecline,
  encodeInviteLinkPayload,
  encodeInviteLinkUrl,
  encodeRevoke,
  encodeSignedAccept,
  encodeSignedInvite,
  fromBase64Url,
  inviteSubject,
  isUsableX25519Key,
  openAcceptResponse,
  openDeclineResponse,
  openForRecipient,
  openLinkInvite,
  openMailboxInvite,
  openRevoke,
  openSignedInvite,
  openWithLinkKey,
  parseInviteLink,
  revokeHashOf,
  sealForRecipients,
  sealWithLinkKey,
  toBase64Url,
  vaultNetworkOf,
  x25519PublicKey,
  type InviteBody,
  type InviteNetwork,
  type InviteParticipant,
  type ParticipantStatus,
  type SignedInvite,
  type WireDelivery,
} from '@/shared/gerovault/invite';
import { bytesToHex, hexToBytes } from '@/shared/gerovault/cbor';
import { nextVaultIndex, writeLabel, type HeldIndex, type ParticipantIndexHistory, type ReleasedIndex, type VaultNetwork } from '@/shared/gerovault';
import type { Wallet } from '@/models/types';
import { OwnAccountKeyError, canHoldVaultKeys } from '@/modules/gerovault/create/ownAccountKeyFlow';
import { InviteApiError, type InviteApi, type SetupResponse } from './inviteApi';
import type { VaultKeyAuth, VaultKeyMaterial } from './inviteKeys';
import type { InviteRecords, ReceivedState, SetupSlot, StoredLink, StoredReceived, StoredSetup } from './inviteRecords';
import { resolveCosignerEntry, type ResolveProblem, type ResolvedCosigner } from './resolveCosigner';

// -------------------------------------------------------------------------------------------------
// Errors and views

export type InviteErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INVALID_NAME'
  | 'LOCKED'
  | 'WRONG_PASSWORD'
  | 'WALLET_LOCKED'
  | 'NOT_SUPPORTED'
  | 'WRONG_NETWORK'
  | 'NOT_ADDRESSED'
  | 'NOT_BACKED_UP'
  | 'TOO_MANY_PENDING'
  | 'INDEX_SPACE_EXHAUSTED'
  | 'INVALID_HISTORY'
  | 'EXPIRED'
  | 'REVOKED'
  | 'ALREADY_ANSWERED'
  | 'LIMIT_EXCEEDED'
  | 'RATE_LIMITED'
  | 'SLOT_TAKEN'
  | 'TERMS_LOCKED'
  | 'BROKEN_SERVER'
  | 'REFUSED'
  | 'NETWORK'
  | 'SERVER';

export class InviteServiceError extends Error {
  constructor(
    readonly code: InviteErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(`vault invitation: ${code}`);
    this.name = 'InviteServiceError';
  }
}

const fail = (code: InviteErrorCode, details?: Record<string, unknown>): never => {
  throw new InviteServiceError(code, details);
};

export type SlotStatus = 'empty' | 'waiting' | 'accepted' | 'declined' | 'revoked' | 'expired';

export interface SlotView {
  readonly n: number;
  readonly label?: string;
  readonly status: SlotStatus;
  readonly verified: boolean;
  readonly invite?: { readonly inviteId: string; readonly stakeCredential: string; readonly handle?: string; readonly sentAt: number; readonly expiresAt: number; readonly remindedAt?: number };
  readonly accept?: { readonly label: string; readonly stakeCredential: string; readonly payment: string; readonly stake: string; readonly via: 'invite' | 'qr' | 'link'; readonly acceptedAt: number };
}

export interface SetupViewModel {
  readonly setupId: string;
  readonly walletId: number;
  readonly network: VaultNetwork;
  readonly name: string;
  readonly owners: number;
  readonly threshold: number;
  readonly ownIndex: number;
  readonly ownLabel: string;
  readonly ownPayment: string;
  readonly ownStake: string;
  /** Milliseconds. */
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly state: StoredSetup['state'];
  /** The vault payment key is open in the worker: invitations and QR codes need no password now. */
  readonly signerReady: boolean;
  readonly slots: readonly SlotView[];
  readonly links: readonly { readonly joinTokenHash: string; readonly kind: 'qr' | 'link'; readonly expiresAt: number; readonly state: string }[];
  /** Answers gero-sync handed over that did not open or check (never used). */
  readonly refused: number;
  readonly vaultId?: string;
}

export interface AnsweringWallet {
  readonly walletId: number;
  readonly name: string;
  /** The invitation was addressed to this wallet's stake credential. */
  readonly addressed: boolean;
  readonly backedUp: boolean;
}

export interface ReceivedView {
  readonly ref: string;
  readonly source: 'mailbox' | 'link';
  readonly setupId: string;
  readonly network: VaultNetwork;
  readonly state: ReceivedState;
  readonly known: boolean;
  readonly receivedAt: number;
  /** Milliseconds. */
  readonly expiresAt: number;
  readonly endedAt?: number;
  /** A REVOKE opened against this invitation: "Revoked by <inviter>"; otherwise "no longer available". */
  readonly revokedByInviter: boolean;
  readonly digest: string;
  readonly vault: { readonly name: string; readonly threshold: number; readonly owners: number };
  readonly inviter: { readonly label: string; readonly credential: string; readonly handle?: string; readonly payment: string; readonly stake: string };
  readonly participants: readonly { readonly label: string; readonly status: string }[];
  readonly wallets: readonly AnsweringWallet[];
  readonly join?: { readonly walletId: number; readonly ownIndex: number; readonly label: string; readonly payment: string; readonly stake: string; readonly acceptedAt: number; readonly verified: boolean; readonly vaultId?: string };
}

// -------------------------------------------------------------------------------------------------
// Dependencies

export interface InviteWallets {
  all(): Promise<Record<number, Wallet>>;
  /** The key-based stake credential of a Cardano wallet (hex), or null. */
  stakeCredential(wallet: Wallet): string | null;
  /** The wallet's recovery phrase is backed up, or it has none to back up (its `backup` config row). */
  backedUp(walletId: number): Promise<boolean>;
  /** The stake credentials of the contacts of every wallet on `network`, to sort invitations. */
  contactCredentials(network: VaultNetwork): Promise<ReadonlySet<string>>;
}

export interface InviteServiceDeps {
  readonly api: InviteApi;
  readonly records: InviteRecords;
  readonly keys: { open(walletId: number, auth: VaultKeyAuth, index: number): Promise<VaultKeyMaterial> };
  readonly wallets: InviteWallets;
  /** The wallet's vault records: their indexes are taken (`vaultStore.list`). */
  vaultIndexes(walletId: number): Promise<readonly { readonly ownIndex: number; readonly status: string }[]>;
  resolveHandle(handle: string): Promise<string | null>;
  random(n: number): Uint8Array;
  now(): number;
  /** The device invite key was created: publish it (`PUT /device`). */
  onDeviceKeyCreated?(): void;
  log?(message: string): void;
}

const DAY_S = 86_400;
/** A QR lives ten minutes; a copied link as long as its invitation (PROTOCOL 5). */
export const QR_LIFETIME_S = 600;
/** How long the vault payment key stays open in the worker after its credential was given. */
export const SIGNER_TTL_MS = 30 * 60 * 1000;
const HEX16 = /^[0-9a-f]{32}$/;
const HEX28 = /^[0-9a-f]{56}$/;
const REF = /^(?:[0-9a-f]{32}|l[0-9a-f]{64})$/;
const DELETE_AFTER_MS = 30 * DAY_S * 1000;

function bytes(hex: string): Uint8Array {
  const b = hexToBytes(hex);
  if (!b) throw new InviteServiceError('INVALID_INPUT');
  return b;
}

function wireNetwork(network: VaultNetwork): InviteNetwork {
  return WIRE_NETWORK[network] as InviteNetwork;
}

function walletNetwork(wallet: Wallet): VaultNetwork | null {
  const n = String(wallet.network ?? '').toLowerCase();
  return n === 'mainnet' || n === 'preprod' || n === 'preview' ? n : null;
}

function apiFailure(error: unknown, setups?: readonly StoredSetup[]): never {
  if (error instanceof InviteServiceError) throw error;
  if (error instanceof OwnAccountKeyError) {
    if (error.code === 'wrong-password' || error.code === 'cancelled') return fail('WRONG_PASSWORD');
    if (error.code === 'locked') return fail('WALLET_LOCKED');
    if (error.code === 'not-found') return fail('NOT_FOUND');
    return fail('NOT_SUPPORTED');
  }
  if (!(error instanceof InviteApiError)) return fail('NETWORK');
  switch (error.code) {
    case 'not_found':
    case 'forbidden':
      return fail('NOT_FOUND');
    case 'already_answered':
      return fail('ALREADY_ANSWERED');
    case 'expired':
      return fail('EXPIRED');
    case 'revoked':
      return fail('REVOKED');
    case 'too_many_pending': {
      const open = Array.isArray(error.details?.['open']) ? error.details['open'] as unknown[] : [];
      const ids = open.flatMap(o => (o && typeof o === 'object' && typeof (o as { setupId?: unknown }).setupId === 'string' ? [(o as { setupId: string }).setupId] : []));
      return fail('TOO_MANY_PENDING', { open: pendingList(setups ?? [], ids) });
    }
    case 'limit_exceeded':
      return fail('LIMIT_EXCEEDED', { limit: error.details?.['limit'] });
    case 'rate_limited':
      return fail('RATE_LIMITED', error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : undefined);
    case 'invalid_response':
      return fail('BROKEN_SERVER');
    case 'network':
    case 'deferred':
      return fail('NETWORK');
    default:
      return fail(error.status >= 500 ? 'NETWORK' : 'SERVER');
  }
}

/** The setups to offer for cancelling (UX: TOO_MANY_PENDING lists them). Unknown ids show without a name. */
function pendingList(setups: readonly StoredSetup[], serverIds: readonly string[] = []): { setupId: string; name?: string; expiresAt?: number }[] {
  const open = setups.filter(s => s.state === 'open');
  const ids = new Set([...open.map(s => s.setupId), ...serverIds]);
  return [...ids].map(id => {
    const local = open.find(s => s.setupId === id);
    return local ? { setupId: id, name: local.name, expiresAt: local.expiresAt } : { setupId: id };
  });
}

function slotStatus(slot: SetupSlot, nowS: number): SlotStatus {
  if (slot.accept) return 'accepted';
  if (slot.declinedAt !== undefined) return 'declined';
  const invite = slot.invite;
  if (!invite) return 'empty';
  if (invite.state === 'revoked' || invite.state === 'replaced') return 'revoked';
  if (invite.state === 'expired' || (invite.state === 'open' && nowS >= invite.expiresAt)) return 'expired';
  if (invite.state === 'declined') return 'declined';
  return 'waiting';
}

function participantStatus(slot: SetupSlot, nowS: number): ParticipantStatus | null {
  if (slot.accept) return slot.verifiedAt !== undefined ? 'verified' : 'accepted';
  return slotStatus(slot, nowS) === 'waiting' ? 'waiting' : null;
}

// -------------------------------------------------------------------------------------------------

export function createInviteService(deps: InviteServiceDeps) {
  const { api, records } = deps;
  const log = deps.log ?? (() => undefined);
  const nowMs = () => deps.now();
  const nowS = () => Math.floor(deps.now() / 1000);
  const randomHex = (n: number) => bytesToHex(deps.random(n));
  const sessions = new Map<string, { material: VaultKeyMaterial; until: number }>();
  const refusedCounts = new Map<string, number>();

  // One operation at a time: an index is allocated and recorded before the next one reads.
  let chain: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  }

  // ---- device key --------------------------------------------------------------------------

  async function deviceKey(create: boolean): Promise<{ secret: Uint8Array; publicKey: Uint8Array } | null> {
    const stored = await records.deviceKey();
    if (stored) {
      const secret = hexToBytes(stored.secret);
      const publicKey = hexToBytes(stored.publicKey);
      if (secret?.length === 32 && publicKey && isUsableX25519Key(publicKey) && bytesToHex(x25519PublicKey(secret)) === stored.publicKey) {
        return { secret, publicKey };
      }
      log('vault invite key unreadable: a new one is made');
    }
    if (!create) return null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const secret = deps.random(32);
      const publicKey = x25519PublicKey(secret);
      if (!isUsableX25519Key(publicKey)) continue;
      await records.setDeviceKey({ secret: bytesToHex(secret), publicKey: bytesToHex(publicKey), createdAt: nowMs() });
      deps.onDeviceKeyCreated?.();
      return { secret, publicKey };
    }
    return fail('NOT_SUPPORTED');
  }

  async function requireDeviceKey() {
    return (await deviceKey(true)) ?? fail('NOT_SUPPORTED');
  }

  // ---- index allocation --------------------------------------------------------------------

  /** Indexes this wallet holds through invitations: open setups and joined invitations (held), ended ones (released). */
  async function inviteHolds(walletId: number): Promise<{ held: HeldIndex[]; released: ReleasedIndex[] }> {
    const held: HeldIndex[] = [];
    const released: ReleasedIndex[] = [];
    for (const s of await records.setups()) {
      if (s.walletId !== walletId) continue;
      if (s.state === 'open') held.push({ index: s.ownIndex, kind: 'setup' });
      else if (s.state !== 'completed') released.push({ index: s.ownIndex });
    }
    for (const r of await records.receivedAll()) {
      if (r.join?.walletId !== walletId || r.join.vaultId) continue;
      if (r.state === 'accepted') held.push({ index: r.join.ownIndex, kind: 'setup' });
      else released.push({ index: r.join.ownIndex });
    }
    return { held, released };
  }

  async function allocate(walletId: number): Promise<number> {
    let vaults: readonly { ownIndex: number; status: string }[];
    try {
      vaults = await deps.vaultIndexes(walletId);
    } catch {
      return fail('INVALID_HISTORY');
    }
    const holds = await inviteHolds(walletId);
    const history: ParticipantIndexHistory = {
      onChain: [],
      held: [...vaults.map(v => ({ index: v.ownIndex, kind: v.status === 'accepted' ? 'vault' as const : 'candidate' as const })), ...holds.held],
      released: holds.released,
    };
    const allocation = nextVaultIndex(history);
    if (allocation.ok === false) {
      if (allocation.code === 'TOO_MANY_PENDING') return fail('TOO_MANY_PENDING', { open: pendingList(await records.setups()) });
      return fail(allocation.code);
    }
    return allocation.index;
  }

  // ---- wallets -----------------------------------------------------------------------------

  async function walletOf(walletId: unknown): Promise<Wallet> {
    if (typeof walletId !== 'number') return fail('INVALID_INPUT');
    const wallet = (await deps.wallets.all())[walletId];
    if (!wallet) return fail('NOT_FOUND');
    if (!canHoldVaultKeys(wallet)) return fail('NOT_SUPPORTED');
    return wallet;
  }

  async function openKey(walletId: number, auth: VaultKeyAuth, index: number): Promise<VaultKeyMaterial> {
    try {
      return await deps.keys.open(walletId, auth, index);
    } catch (error) {
      return apiFailure(error);
    }
  }

  function remember(setupId: string, material: VaultKeyMaterial): void {
    sessions.get(setupId)?.material.wipe();
    sessions.set(setupId, { material, until: nowMs() + SIGNER_TTL_MS });
  }

  function signer(setupId: string): VaultKeyMaterial | null {
    const s = sessions.get(setupId);
    if (!s) return null;
    if (nowMs() >= s.until) {
      s.material.wipe();
      sessions.delete(setupId);
      return null;
    }
    s.until = nowMs() + SIGNER_TTL_MS;
    return s.material;
  }

  function forget(setupId: string): void {
    sessions.get(setupId)?.material.wipe();
    sessions.delete(setupId);
  }

  // ---- views -------------------------------------------------------------------------------

  function setupView(s: StoredSetup): SetupViewModel {
    const t = nowS();
    const state = s.state === 'open' && nowMs() >= s.expiresAt ? 'expired' : s.state;
    return {
      setupId: s.setupId,
      walletId: s.walletId,
      network: s.network,
      name: s.name,
      owners: s.owners,
      threshold: s.threshold,
      ownIndex: s.ownIndex,
      ownLabel: s.ownLabel,
      ownPayment: s.ownPayment,
      ownStake: s.ownStake,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      state,
      signerReady: state === 'open' && signer(s.setupId) !== null,
      slots: s.slots.map(slot => ({
        n: slot.n,
        ...(slot.label !== undefined ? { label: slot.label } : {}),
        status: slotStatus(slot, t),
        verified: slot.verifiedAt !== undefined,
        ...(slot.invite ? {
          invite: {
            inviteId: slot.invite.inviteId,
            stakeCredential: slot.invite.stakeCredential,
            ...(slot.invite.handle ? { handle: slot.invite.handle } : {}),
            sentAt: slot.invite.issuedAt * 1000,
            expiresAt: slot.invite.expiresAt * 1000,
            ...(slot.invite.remindedAt !== undefined ? { remindedAt: slot.invite.remindedAt } : {}),
          },
        } : {}),
        ...(slot.accept ? {
          accept: {
            label: slot.accept.label,
            stakeCredential: slot.accept.stakeCredential,
            payment: slot.accept.payment,
            stake: slot.accept.stake,
            via: slot.accept.via,
            acceptedAt: slot.accept.acceptedAt * 1000,
          },
        } : {}),
      })),
      links: s.links.map(l => ({ joinTokenHash: l.joinTokenHash, kind: l.kind, expiresAt: l.expiresAt * 1000, state: l.state === 'open' && t >= l.expiresAt ? 'expired' : l.state })),
      refused: refusedCounts.get(s.setupId) ?? 0,
      ...(s.vaultId ? { vaultId: s.vaultId } : {}),
    };
  }

  async function answeringWallets(r: StoredReceived): Promise<AnsweringWallet[]> {
    const network = vaultNetworkOf(r.network);
    const out: AnsweringWallet[] = [];
    for (const wallet of Object.values(await deps.wallets.all())) {
      if (!canHoldVaultKeys(wallet) || walletNetwork(wallet) !== network) continue;
      const credential = deps.wallets.stakeCredential(wallet);
      const addressed = r.addressedTo !== undefined && credential === r.addressedTo;
      // A mailbox invitation is answered by the wallet it was sent to; a link by any wallet here.
      if (r.source === 'mailbox' && !addressed) continue;
      out.push({ walletId: wallet.id, name: wallet.name, addressed, backedUp: await deps.wallets.backedUp(wallet.id).catch(() => false) });
    }
    return out;
  }

  async function receivedView(r: StoredReceived): Promise<ReceivedView> {
    const s = r.summary;
    const expired = r.state === 'open' && nowS() >= s.expiresAt;
    return {
      ref: r.ref,
      source: r.source,
      setupId: r.setupId,
      network: vaultNetworkOf(r.network),
      state: expired ? 'expired' : r.state,
      known: r.known,
      receivedAt: r.receivedAt,
      expiresAt: s.expiresAt * 1000,
      ...(r.endedAt !== undefined ? { endedAt: r.endedAt } : {}),
      revokedByInviter: r.revokeProven === true,
      digest: r.digest,
      vault: { name: s.vaultName, threshold: s.threshold, owners: s.owners },
      inviter: { label: s.inviterLabel, credential: s.inviterCredential, ...(s.inviterHandle ? { handle: s.inviterHandle } : {}), payment: s.inviterPayment, stake: s.inviterStake },
      participants: s.participants,
      wallets: r.state === 'open' ? await answeringWallets(r) : [],
      ...(r.join ? {
        join: {
          walletId: r.join.walletId,
          ownIndex: r.join.ownIndex,
          label: r.join.label,
          payment: r.join.payment,
          stake: r.join.stake,
          acceptedAt: r.join.acceptedAt * 1000,
          verified: r.join.verifiedAt !== undefined,
          ...(r.join.vaultId ? { vaultId: r.join.vaultId } : {}),
        },
      } : {}),
    };
  }

  // ---- setups (initiator) ------------------------------------------------------------------

  async function loadSetup(setupId: unknown): Promise<StoredSetup> {
    if (typeof setupId !== 'string' || !HEX16.test(setupId)) return fail('INVALID_INPUT');
    return (await records.setup(setupId)) ?? fail('NOT_FOUND');
  }

  function openSetup(s: StoredSetup): StoredSetup {
    if (s.state !== 'open') return fail(s.state === 'expired' ? 'EXPIRED' : 'NOT_FOUND');
    if (nowMs() >= s.expiresAt) return fail('EXPIRED');
    return s;
  }

  async function register(s: StoredSetup): Promise<StoredSetup> {
    if (s.registered) return s;
    try {
      await api.createSetup({ setupId: s.setupId, network: wireNetwork(s.network), expiresAt: s.expiresAt });
    } catch (error) {
      return apiFailure(error, await records.setups());
    }
    const next = { ...s, registered: true };
    await records.putSetup(next);
    return next;
  }

  function validTerms(owners: unknown, threshold: unknown): { owners: number; threshold: number } {
    if (typeof owners !== 'number' || !Number.isInteger(owners) || owners < 2 || owners > 20) return fail('INVALID_INPUT');
    if (typeof threshold !== 'number' || !Number.isInteger(threshold) || threshold < 2 || threshold > owners) return fail('INVALID_INPUT');
    return { owners, threshold };
  }

  function labelOf(value: unknown, code: InviteErrorCode = 'INVALID_INPUT'): string {
    try {
      return writeLabel(value);
    } catch {
      return fail(code);
    }
  }

  function inviteBody(s: StoredSetup, target: number | null, expiresAt: number, revokeSecret: Uint8Array, replyKey: Uint8Array, invitee?: string): InviteBody {
    const t = nowS();
    const participants: InviteParticipant[] = s.slots.flatMap(slot => {
      if (slot.n === target) return [];
      const status = participantStatus(slot, t);
      const label = slot.accept?.label ?? slot.label;
      return status && label ? [{ label, status }] : [];
    });
    return {
      network: wireNetwork(s.network),
      setupId: bytes(s.setupId),
      vault: { name: s.name, template: 'standard', threshold: s.threshold, owners: s.owners },
      inviter: { label: s.ownLabel, stakeCredential: bytes(s.ownStakeCredential) },
      ...(invitee ? { invitee: bytes(invitee) } : {}),
      participants: participants.slice(0, Math.min(19, s.owners - 1)),
      replyKey,
      vaultKeys: { payment: bytes(s.ownPayment), stake: bytes(s.ownStake) },
      revokeHash: revokeHashOf(revokeSecret),
      issuedAt: t,
      expiresAt,
    };
  }

  /** The expiry of an invitation issued now: the setup's, at most seven days. */
  function inviteExpiry(s: StoredSetup): number {
    return Math.min(Math.floor(s.expiresAt / 1000), nowS() + MAX_INVITE_LIFETIME_S);
  }

  function sealRandomness(count: number) {
    return {
      contentKey: deps.random(32),
      nonce: deps.random(24),
      wraps: Array.from({ length: count }, () => ({ ephemeralSecret: deps.random(32), nonce: deps.random(24) })),
    };
  }

  async function startSetup(input: { walletId?: unknown; auth?: VaultKeyAuth; name?: unknown; owners?: unknown; threshold?: unknown }) {
    return serial(async () => {
      const wallet = await walletOf(input.walletId);
      const network = walletNetwork(wallet) ?? fail('WRONG_NETWORK');
      const { owners, threshold } = validTerms(input.owners, input.threshold);
      const name = labelOf(input.name, 'INVALID_NAME');
      const ownLabel = (() => {
        try {
          return writeLabel(wallet.name);
        } catch {
          return 'Gero';
        }
      })();
      const ownStakeCredential = deps.wallets.stakeCredential(wallet) ?? fail('NOT_SUPPORTED');
      await requireDeviceKey();
      const index = await allocate(wallet.id);
      const material = await openKey(wallet.id, input.auth ?? {}, index);
      const setupId = randomHex(16);
      const now = nowMs();
      const setup: StoredSetup = {
        v: 1,
        setupId,
        walletId: wallet.id,
        network,
        name,
        owners,
        threshold,
        ownIndex: index,
        ownLabel,
        ownStakeCredential,
        ownPayment: material.payment,
        ownStake: material.stake,
        createdAt: now,
        // gero-sync takes at most 7 days and 5 minutes from its own clock; a minute less leaves room for skew.
        expiresAt: now + MAX_INVITE_LIFETIME_S * 1000 - 60_000,
        registered: false,
        slots: Array.from({ length: owners - 1 }, (_, n) => ({ n })),
        links: [],
        seenResponses: [],
        state: 'open',
      };
      await records.putSetup(setup);
      remember(setupId, material);
      return { setup: setupView(setup), accountKey: material.accountKey };
    });
  }

  async function unlockSetup(input: { setupId?: unknown; auth?: VaultKeyAuth }) {
    const s = openSetup(await loadSetup(input.setupId));
    const material = await openKey(s.walletId, input.auth ?? {}, s.ownIndex);
    if (material.payment !== s.ownPayment || material.stake !== s.ownStake) {
      material.wipe();
      return fail('NOT_SUPPORTED');
    }
    remember(s.setupId, material);
    return { setup: setupView(s), accountKey: material.accountKey };
  }

  /** The name, owners or threshold changed before anyone was invited. */
  async function updateTerms(input: { setupId?: unknown; name?: unknown; owners?: unknown; threshold?: unknown }) {
    const s = openSetup(await loadSetup(input.setupId));
    if (s.slots.some(slot => slot.invite || slot.accept) || s.links.length > 0) return fail('TERMS_LOCKED');
    const { owners, threshold } = validTerms(input.owners, input.threshold);
    const next: StoredSetup = { ...s, name: labelOf(input.name, 'INVALID_NAME'), owners, threshold, slots: Array.from({ length: owners - 1 }, (_, n) => ({ n })) };
    await records.putSetup(next);
    return setupView(next);
  }

  async function resolve(input: { walletId?: unknown; entry?: unknown }): Promise<{ ok: true; value: ResolvedCosigner } | { ok: false; problem: ResolveProblem }> {
    const wallet = await walletOf(input.walletId);
    const network = walletNetwork(wallet) ?? fail('WRONG_NETWORK');
    return resolveCosignerEntry(input.entry, network, { resolveHandle: deps.resolveHandle, ownCredential: deps.wallets.stakeCredential(wallet) ?? undefined });
  }

  async function invite(input: { setupId?: unknown; n?: unknown; stakeCredential?: unknown; handle?: unknown; label?: unknown }) {
    return serial(async () => {
      let s = openSetup(await loadSetup(input.setupId));
      const n = input.n;
      const slot = typeof n === 'number' ? s.slots.find(x => x.n === n) : undefined;
      if (!slot) return fail('INVALID_INPUT');
      if (slot.accept) return fail('SLOT_TAKEN');
      const credential = input.stakeCredential;
      if (typeof credential !== 'string' || !HEX28.test(credential)) return fail('INVALID_INPUT');
      if (credential === s.ownStakeCredential) return fail('INVALID_INPUT');
      if (s.slots.some(x => x.n !== n && x.invite?.stakeCredential === credential && slotStatus(x, nowS()) === 'waiting')) return fail('SLOT_TAKEN');
      const handle = typeof input.handle === 'string' && /^\$[a-z0-9_.-]{1,15}$/.test(input.handle) ? input.handle : undefined;
      const label = input.label === undefined || input.label === '' ? undefined : labelOf(input.label);
      const material = signer(s.setupId) ?? fail('LOCKED');
      const device = await requireDeviceKey();
      s = await register(s);

      let entries: readonly { slot: number; inviteKey: string }[];
      try {
        entries = await api.directory(wireNetwork(s.network), credential);
      } catch (error) {
        return apiFailure(error);
      }
      // A key that is not a usable X25519 key is a broken server: stop (PROTOCOL 6, step 3).
      const recipients = entries.map(e => ({ slot: e.slot, key: hexToBytes(e.inviteKey) ?? new Uint8Array() }));
      if (recipients.some(r => !isUsableX25519Key(r.key))) return fail('BROKEN_SERVER');

      const revokeSecret = deps.random(32);
      const body = inviteBody(s, slot.n, inviteExpiry(s), revokeSecret, device.publicKey, credential);
      const sig = await material.attest(inviteSubject(body));
      const plaintext = encodeSignedInvite(body, sig);
      const sealed = sealForRecipients('INVITE', body.setupId, plaintext, recipients, sealRandomness(5));
      let posted: { inviteId: string; expiresAt: number };
      try {
        posted = await api.postInvite(s.setupId, { stakeCredential: credential, ...sealed });
      } catch (error) {
        return apiFailure(error);
      }
      const digest = inviteSubject(body).digest;
      const fresh = (await records.setup(s.setupId)) ?? s;
      const next: StoredSetup = {
        ...fresh,
        slots: fresh.slots.map(x => (x.n !== slot.n ? x : {
          n: x.n,
          ...(label ?? x.label ? { label: label ?? x.label } : {}),
          invite: {
            inviteId: posted.inviteId,
            stakeCredential: credential,
            ...(handle ? { handle } : {}),
            digest,
            revokeSecret: bytesToHex(revokeSecret),
            issuedAt: body.issuedAt,
            expiresAt: body.expiresAt,
            state: 'open',
          },
        })),
      };
      revokeSecret.fill(0);
      await records.putSetup(next);
      return setupView(next);
    });
  }

  /** A fresh one-time QR (10 minutes) or copyable link (as long as its invitation). */
  async function link(input: { setupId?: unknown; kind?: unknown }) {
    return serial(async () => {
      const kind = input.kind === 'link' ? 'link' : input.kind === 'qr' ? 'qr' : fail('INVALID_INPUT');
      let s = openSetup(await loadSetup(input.setupId));
      if (s.slots.every(slot => slot.accept)) return fail('SLOT_TAKEN');
      const material = signer(s.setupId) ?? fail('LOCKED');
      const device = await requireDeviceKey();
      s = await register(s);

      const cap = deps.random(32);
      const setupIdBytes = bytes(s.setupId);
      const secrets = deriveLinkSecrets(cap, setupIdBytes);
      const revokeSecret = deps.random(32);
      const expiresAt = inviteExpiry(s);
      const body = inviteBody(s, null, expiresAt, revokeSecret, device.publicKey);
      revokeSecret.fill(0);
      const sig = await material.attest(inviteSubject(body));
      const sealed = sealWithLinkKey(setupIdBytes, encodeSignedInvite(body, sig), secrets.contentKey, deps.random(24));
      const exp = kind === 'qr' ? Math.min(nowS() + QR_LIFETIME_S, expiresAt) : expiresAt;
      const joinTokenHash = bytesToHex(secrets.joinTokenHash);
      try {
        await api.putLink(s.setupId, joinTokenHash, { nonce: sealed.nonce, ciphertext: sealed.ciphertext, expiresAt: exp * 1000 });
      } catch (error) {
        return apiFailure(error);
      }
      // The QR on screen is the only one: an older one is withdrawn (one QR per person, UX rule 9).
      const fresh = (await records.setup(s.setupId)) ?? s;
      const withdrawn = kind === 'qr' ? fresh.links.filter(l => l.kind === 'qr' && l.state === 'open') : [];
      for (const old of withdrawn) await api.deleteLink(s.setupId, old.joinTokenHash).catch(() => undefined);
      const stored: StoredLink = {
        joinTokenHash,
        cap: bytesToHex(cap),
        digest: inviteSubject(body).digest,
        kind,
        expiresAt: exp,
        inviteExpiresAt: expiresAt,
        state: 'open',
        createdAt: nowMs(),
      };
      const next: StoredSetup = {
        ...fresh,
        links: [...fresh.links.map(l => (withdrawn.includes(l) ? { ...l, state: 'withdrawn' as const } : l)), stored],
      };
      await records.putSetup(next);
      const linkValue = { network: body.network, setupId: setupIdBytes, replyKey: device.publicKey, cap, exp };
      return {
        setup: setupView(next),
        joinTokenHash,
        payload: encodeInviteLinkPayload(linkValue),
        url: encodeInviteLinkUrl(linkValue),
        expiresAt: exp * 1000,
      };
    });
  }

  /** Opens one response with the reply secret and the context of the invitation or link it answers. */
  async function applyResponse(s: StoredSetup, r: SetupResponse, replySecret: Uint8Array): Promise<StoredSetup | 'refused'> {
    const setupIdBytes = bytes(s.setupId);
    const network = wireNetwork(s.network);
    const slot = r.inviteId ? s.slots.find(x => x.invite?.inviteId === r.inviteId) : undefined;
    const link = r.joinTokenHash ? s.links.find(l => l.joinTokenHash === r.joinTokenHash) : undefined;
    if (!slot && !link) return 'refused';
    const ctx = slot?.invite
      ? { setupId: setupIdBytes, network, inviteDigest: slot.invite.digest, inviteExpiresAt: slot.invite.expiresAt }
      : { setupId: setupIdBytes, network, inviteDigest: link!.digest, inviteExpiresAt: link!.inviteExpiresAt, macKey: deriveLinkSecrets(bytes(link!.cap), setupIdBytes).macKey };

    if (r.kind === 'decline') {
      const opened = openDeclineResponse(r.delivery, replySecret, ctx);
      if (opened.ok === false) return 'refused';
      if (slot) {
        if (slot.accept) return s;
        return { ...s, slots: s.slots.map(x => (x === slot ? { ...x, declinedAt: nowMs(), invite: { ...x.invite!, state: 'declined' } } : x)) };
      }
      return { ...s, links: s.links.map(l => (l === link ? { ...l, state: 'used' } : l)) };
    }

    const opened = await openAcceptResponse(r.delivery, replySecret, ctx, nowS());
    if (opened.ok === false) {
      log(`vault invite: an ACCEPT was refused (${opened.code})`);
      return 'refused';
    }
    const accepted = opened.value;
    if (s.seenResponses.includes(accepted.digest)) return s;
    const payment = bytesToHex(accepted.body.vaultKeys.payment);
    const stake = bytesToHex(accepted.body.vaultKeys.stake);
    // Keys already in the setup (this wallet's, or another cosigner's) are refused (PROTOCOL 4.2).
    const used = new Set([s.ownPayment, s.ownStake, ...s.slots.flatMap(x => (x.accept ? [x.accept.payment, x.accept.stake] : []))]);
    if (used.has(payment) || used.has(stake)) return 'refused';
    const target = slot ?? s.slots.find(x => !x.accept && !x.invite && x.declinedAt === undefined)
      ?? s.slots.find(x => !x.accept && slotStatus(x, nowS()) !== 'waiting');
    if (!target || target.accept) return 'refused';
    const via: 'invite' | 'qr' | 'link' = slot ? 'invite' : link!.kind;
    const next: StoredSetup = {
      ...s,
      seenResponses: [...s.seenResponses, accepted.digest],
      slots: s.slots.map(x => (x !== target ? x : {
        n: x.n,
        label: accepted.body.label,
        ...(x.invite ? { invite: { ...x.invite, state: 'accepted' as const } } : {}),
        accept: {
          label: accepted.body.label,
          stakeCredential: bytesToHex(accepted.body.stakeCredential),
          payment,
          stake,
          digest: accepted.digest,
          acceptedAt: accepted.body.acceptedAt,
          via,
          receivedAt: nowMs(),
        },
      })),
      links: s.links.map(l => (l === link ? { ...l, state: 'used' as const } : l)),
    };
    return next;
  }

  /** Reads the answers gero-sync holds for a setup and fills the slots (fail closed). */
  async function refreshSetup(input: { setupId?: unknown }) {
    return serial(async () => {
      let s = await loadSetup(input.setupId);
      if (s.state === 'open' && nowMs() >= s.expiresAt) {
        s = { ...s, state: 'expired' };
        await records.putSetup(s);
        forget(s.setupId);
      }
      if (s.state !== 'open' || !s.registered) return setupView(s);
      const device = await deviceKey(false);
      if (!device) return setupView(s);
      let answers;
      try {
        answers = await api.responses(s.setupId);
      } catch (error) {
        if (error instanceof InviteApiError && (error.code === 'expired' || error.code === 'not_found')) {
          const ended: StoredSetup = { ...s, state: 'expired' };
          await records.putSetup(ended);
          forget(s.setupId);
          return setupView(ended);
        }
        return apiFailure(error);
      }
      let next = s;
      let refused = 0;
      for (const r of answers.responses) {
        if (next.seenResponses.includes(r.responseId)) continue;
        const applied = await applyResponse(next, r, device.secret);
        if (applied === 'refused') refused++;
        else next = applied;
        next = { ...next, seenResponses: [...next.seenResponses, r.responseId] };
      }
      // Invitation and link states as the server tells them; an answer only from an opened response.
      next = {
        ...next,
        slots: next.slots.map(slot => {
          const row = slot.invite && answers.invites.find(i => i.inviteId === slot.invite!.inviteId);
          if (!row || slot.accept || slot.declinedAt !== undefined) return slot;
          if (row.state === 'expired' || row.state === 'revoked' || row.state === 'replaced') return { ...slot, invite: { ...slot.invite!, state: row.state } };
          return slot;
        }),
        links: next.links.map(l => {
          const row = answers.links.find(x => x.joinTokenHash === l.joinTokenHash);
          return row && l.state === 'open' && row.state !== 'open' ? { ...l, state: row.state } : l;
        }),
      };
      if (answers.state === 'expired' || answers.state === 'closed') {
        next = { ...next, state: answers.state === 'expired' ? 'expired' : 'closed' };
        forget(s.setupId);
      }
      if (refused) refusedCounts.set(s.setupId, (refusedCounts.get(s.setupId) ?? 0) + refused);
      await records.putSetup(next);
      return setupView(next);
    });
  }

  async function remind(input: { setupId?: unknown; n?: unknown }) {
    const s = openSetup(await loadSetup(input.setupId));
    const slot = s.slots.find(x => x.n === input.n);
    if (!slot?.invite || slotStatus(slot, nowS()) !== 'waiting') return fail('INVALID_INPUT');
    try {
      await api.remind(s.setupId, slot.invite.inviteId);
    } catch (error) {
      return apiFailure(error);
    }
    const next: StoredSetup = { ...s, slots: s.slots.map(x => (x === slot ? { ...x, invite: { ...x.invite!, remindedAt: nowMs() } } : x)) };
    await records.putSetup(next);
    return setupView(next);
  }

  async function revoke(input: { setupId?: unknown; n?: unknown }) {
    return serial(async () => {
      const s = openSetup(await loadSetup(input.setupId));
      const slot = s.slots.find(x => x.n === input.n);
      if (!slot?.invite || slot.accept || slotStatus(slot, nowS()) !== 'waiting') return fail('INVALID_INPUT');
      const payload = toBase64Url(encodeRevoke({ setupId: bytes(s.setupId), secret: bytes(slot.invite.revokeSecret), revokedAt: nowS() }));
      try {
        await api.revoke(s.setupId, slot.invite.inviteId, payload);
      } catch (error) {
        return apiFailure(error);
      }
      const next: StoredSetup = { ...s, slots: s.slots.map(x => (x === slot ? { ...x, invite: { ...x.invite!, state: 'revoked' } } : x)) };
      await records.putSetup(next);
      return setupView(next);
    });
  }

  async function withdrawLink(input: { setupId?: unknown; joinTokenHash?: unknown }) {
    const s = await loadSetup(input.setupId);
    const l = s.links.find(x => x.joinTokenHash === input.joinTokenHash);
    if (!l || l.state !== 'open') return setupView(s);
    await api.deleteLink(s.setupId, l.joinTokenHash).catch(() => undefined);
    const next: StoredSetup = { ...s, links: s.links.map(x => (x === l ? { ...x, state: 'withdrawn' as const } : x)) };
    await records.putSetup(next);
    return setupView(next);
  }

  /** The user read the number with this cosigner (GV-61): shown on the overview. Funding still reads the vault's own records. */
  async function markVerified(input: { setupId?: unknown; n?: unknown }) {
    const s = await loadSetup(input.setupId);
    const slot = s.slots.find(x => x.n === input.n);
    if (!slot?.accept) return fail('INVALID_INPUT');
    const next: StoredSetup = { ...s, slots: s.slots.map(x => (x === slot ? { ...x, verifiedAt: nowMs() } : x)) };
    await records.putSetup(next);
    return setupView(next);
  }

  /** Cancel: gero-sync closes the setup (its invitations read as revoked), and the index is released. */
  async function cancelSetup(input: { setupId?: unknown }) {
    return serial(async () => {
      const s = await loadSetup(input.setupId);
      if (s.registered && s.state === 'open') {
        try {
          await api.deleteSetup(s.setupId);
        } catch (error) {
          if (!(error instanceof InviteApiError && error.code === 'not_found')) return apiFailure(error);
        }
      }
      forget(s.setupId);
      const next: StoredSetup = { ...s, state: 'closed' };
      await records.putSetup(next);
      return setupView(next);
    });
  }

  /** The vault was saved: the setup closes on gero-sync, and the vault record holds the index now. */
  async function completeSetup(input: { setupId?: unknown; vaultId?: unknown }) {
    const s = await loadSetup(input.setupId);
    if (typeof input.vaultId !== 'string' || !/^[0-9a-f]{64}$/.test(input.vaultId)) return fail('INVALID_INPUT');
    if (s.registered && s.state === 'open') await api.deleteSetup(s.setupId).catch(() => undefined);
    forget(s.setupId);
    const next: StoredSetup = { ...s, state: 'completed', vaultId: input.vaultId };
    await records.putSetup(next);
    return setupView(next);
  }

  async function listSetups(input: { walletId?: unknown } = {}) {
    const all = await records.setups();
    const now = nowMs();
    for (const s of all) {
      // Old closed setups go; the vault record or the released index list keeps what matters.
      if (s.state !== 'open' && now - s.createdAt > DELETE_AFTER_MS) await records.removeSetup(s.setupId);
    }
    return all
      .filter(s => (typeof input.walletId !== 'number' || s.walletId === input.walletId) && (s.state === 'open' || (s.state === 'expired' && now - s.expiresAt < 7 * DAY_S * 1000)))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(setupView);
  }

  async function getSetup(input: { setupId?: unknown }) {
    return setupView(await loadSetup(input.setupId));
  }

  // ---- invitations (cosigner) --------------------------------------------------------------

  async function isKnown(network: VaultNetwork, inviterCredential: string): Promise<boolean> {
    const contacts = await deps.wallets.contactCredentials(network).catch(() => new Set<string>());
    if (contacts.has(inviterCredential)) return true;
    // Someone this device already joined a vault with.
    return (await records.receivedAll()).some(r => r.summary.inviterCredential === inviterCredential && r.join !== undefined);
  }

  function summaryOf(signed: SignedInvite) {
    const b = signed.body;
    return {
      vaultName: b.vault.name,
      threshold: b.vault.threshold,
      owners: b.vault.owners,
      inviterLabel: b.inviter.label,
      inviterCredential: bytesToHex(b.inviter.stakeCredential),
      ...(b.inviter.handle ? { inviterHandle: b.inviter.handle } : {}),
      inviterPayment: bytesToHex(b.vaultKeys.payment),
      inviterStake: bytesToHex(b.vaultKeys.stake),
      participants: b.participants.map(p => ({ label: p.label, status: p.status })),
      replyKey: bytesToHex(b.replyKey),
      ...(b.invitee ? { invitee: bytesToHex(b.invitee) } : {}),
      issuedAt: b.issuedAt,
      expiresAt: b.expiresAt,
      revokeHash: bytesToHex(b.revokeHash),
    };
  }

  /** Rebuilds the stored INVITE body, to check a REVOKE against it. */
  async function storedInvite(r: StoredReceived): Promise<SignedInvite | null> {
    // A reopen at the time it was issued: only the structure and signature are re-read here.
    const opened = await openSignedInvite(bytes(r.signedInvite), r.summary.issuedAt, { setupId: bytes(r.setupId) });
    return opened.ok ? opened.value : null;
  }

  function endState(r: StoredReceived, state: ReceivedState): StoredReceived {
    // A joined invitation that ends before the vault exists becomes `cancelled`: its index is released.
    const final: ReceivedState = r.state === 'accepted' && (state === 'revoked' || state === 'expired') ? 'cancelled' : state;
    return { ...r, state: final, endedAt: nowMs() };
  }

  /** `GET /vault-invites`: opens every new invitation with this device's secret (fail closed). */
  async function refreshInvites(): Promise<{ invites: ReceivedView[]; refused: number }> {
    return serial(async () => {
      const device = await deviceKey(false);
      let refused = 0;
      if (device) {
        let rows;
        try {
          rows = await api.listInvites();
        } catch (error) {
          // Offline or a server fault: what this device already holds still shows.
          if (!(error instanceof InviteApiError) || error.code === 'device_unknown') rows = [];
          else if (['network', 'deferred', 'invalid_response', 'rate_limited'].includes(error.code) || error.status >= 500) rows = [];
          else return apiFailure(error);
        }
        // An accepted invitation whose setup ran out before the vault was saved here releases its
        // index. gero-sync cannot say a setup was cancelled after the answer (PROTOCOL 7.5.12 revokes
        // open invitations only), so the expiry is the end.
        for (const r of await records.receivedAll()) {
          if (r.state === 'accepted' && !r.join?.vaultId && nowS() >= r.summary.expiresAt) await records.putReceived(endState(r, 'expired'));
        }
        for (const row of rows) {
          const existing = await records.received(row.inviteId);
          if (existing) {
            if (existing.state !== 'open' && existing.state !== 'accepted') continue;
            let next: StoredReceived | null = null;
            if (row.state === 'revoked') {
              const body = await storedInvite(existing);
              const proven = row.revoke && body ? openRevoke(fromBase64Url(row.revoke) ?? new Uint8Array(), body.body).ok : false;
              // "Revoked by <inviter>" only when the REVOKE opens against the stored invitation (PROTOCOL 6).
              next = { ...endState(existing, 'revoked'), revokeProven: proven };
            } else if (row.state === 'expired' || row.state === 'replaced') {
              next = endState(existing, 'expired');
            } else if ((row.state === 'accepted' || row.state === 'declined') && existing.state === 'open' && row.answeredHere !== true) {
              next = { ...existing, state: 'answeredElsewhere', endedAt: nowMs() };
            }
            if (next) await records.putReceived(next);
            continue;
          }
          if (row.state !== 'open' || !row.delivery) continue;
          const opened = await openMailboxInvite(bytes(row.setupId), row.delivery, device.secret, nowS());
          // The invitation must name the credential and network gero-sync filed it under.
          if (opened.ok === false || !opened.value.body.invitee || bytesToHex(opened.value.body.invitee) !== row.stakeCredential || opened.value.body.network !== row.network) {
            refused++;
            continue;
          }
          const plaintext = await plaintextOf(row.setupId, row.delivery, device.secret);
          const summary = summaryOf(opened.value);
          await records.putReceived({
            v: 1,
            ref: row.inviteId,
            source: 'mailbox',
            inviteId: row.inviteId,
            setupId: row.setupId,
            network: row.network,
            signedInvite: plaintext,
            digest: opened.value.digest,
            summary,
            addressedTo: row.stakeCredential,
            known: await isKnown(vaultNetworkOf(row.network), summary.inviterCredential),
            receivedAt: nowMs(),
            state: 'open',
          });
        }
      }
      const all = (await records.receivedAll()).filter(r => r.state !== 'completed' || nowMs() - (r.endedAt ?? r.receivedAt) < DELETE_AFTER_MS);
      all.sort((a, b) => b.receivedAt - a.receivedAt);
      return { invites: await Promise.all(all.map(receivedView)), refused };
    });
  }

  async function plaintextOf(setupId: string, delivery: WireDelivery, secret: Uint8Array): Promise<string> {
    const opened = openForRecipient('INVITE', bytes(setupId), delivery, secret);
    return opened.ok ? bytesToHex(opened.value) : fail('REFUSED');
  }

  /** A pasted or scanned QR / link: fetch the link copy and open it under the capability. */
  async function openLink(input: { text?: unknown }) {
    return serial(async () => {
      const parsed = parseInviteLink(typeof input.text === 'string' ? input.text.trim() : input.text, nowS());
      if (parsed.ok === false) return fail(parsed.code === 'EXPIRED' ? 'EXPIRED' : 'INVALID_INPUT', { code: parsed.code });
      const link = parsed.value;
      const secrets = deriveLinkSecrets(link.cap, link.setupId);
      const ref = `l${bytesToHex(secrets.joinTokenHash)}`;
      const existing = await records.received(ref);
      if (existing) return receivedView(existing);
      let copy;
      try {
        copy = await api.byLink(bytesToHex(secrets.joinToken));
      } catch (error) {
        return apiFailure(error);
      }
      if (copy.setupId !== bytesToHex(link.setupId) || copy.network !== link.network) return fail('REFUSED', { code: 'WRONG_SETUP' });
      const opened = await openLinkInvite(link, copy, nowS());
      if (opened.ok === false) return fail(opened.code === 'EXPIRED' ? 'EXPIRED' : 'REFUSED', { code: opened.code });
      const plain = openWithLinkKey(link.setupId, copy, secrets.contentKey);
      if (plain.ok === false) return fail('REFUSED');
      const summary = summaryOf(opened.value);
      const record: StoredReceived = {
        v: 1,
        ref,
        source: 'link',
        joinToken: bytesToHex(secrets.joinToken),
        macKey: bytesToHex(secrets.macKey),
        setupId: copy.setupId,
        network: copy.network,
        signedInvite: bytesToHex(plain.value),
        digest: opened.value.digest,
        summary,
        known: await isKnown(vaultNetworkOf(copy.network), summary.inviterCredential),
        receivedAt: nowMs(),
        state: 'open',
      };
      await records.putReceived(record);
      return receivedView(record);
    });
  }

  async function loadReceived(ref: unknown): Promise<StoredReceived> {
    if (typeof ref !== 'string' || !REF.test(ref)) return fail('INVALID_INPUT');
    return (await records.received(ref)) ?? fail('NOT_FOUND');
  }

  function answerable(r: StoredReceived): StoredReceived {
    if (r.state === 'revoked' || r.state === 'cancelled') return fail('REVOKED');
    if (r.state === 'expired' || nowS() >= r.summary.expiresAt) return fail('EXPIRED');
    if (r.state !== 'open') return fail('ALREADY_ANSWERED', { state: r.state });
    return r;
  }

  function channel(r: StoredReceived): { inviteId: string } | { joinToken: string } {
    return r.source === 'mailbox' ? { inviteId: r.inviteId! } : { joinToken: r.joinToken! };
  }

  async function serverEnded(r: StoredReceived, error: unknown): Promise<never> {
    if (error instanceof InviteApiError && ['already_answered', 'expired', 'revoked'].includes(error.code)) {
      const state: ReceivedState = error.code === 'already_answered' ? 'answeredElsewhere' : error.code === 'expired' ? 'expired' : 'revoked';
      await records.putReceived({ ...r, state, endedAt: nowMs() });
    }
    return apiFailure(error);
  }

  async function accept(input: { ref?: unknown; walletId?: unknown; auth?: VaultKeyAuth; label?: unknown }) {
    return serial(async () => {
      const r = answerable(await loadReceived(input.ref));
      const wallet = await walletOf(input.walletId);
      if (walletNetwork(wallet) !== vaultNetworkOf(r.network)) return fail('WRONG_NETWORK');
      const credential = deps.wallets.stakeCredential(wallet) ?? fail('NOT_SUPPORTED');
      if (r.source === 'mailbox' && credential !== r.addressedTo) return fail('NOT_ADDRESSED');
      if (!(await deps.wallets.backedUp(wallet.id))) return fail('NOT_BACKED_UP');
      const label = labelOf(input.label === undefined || input.label === '' ? wallet.name : input.label);
      const replyKey = bytes(r.summary.replyKey);
      if (!isUsableX25519Key(replyKey)) return fail('REFUSED');
      const index = await allocate(wallet.id);
      const material = await openKey(wallet.id, input.auth ?? {}, index);
      try {
        if (material.payment === r.summary.inviterPayment || material.stake === r.summary.inviterStake) return fail('REFUSED');
        const body = {
          network: r.network,
          setupId: bytes(r.setupId),
          invite: bytes(r.digest),
          label,
          stakeCredential: bytes(credential),
          vaultKeys: { payment: bytes(material.payment), stake: bytes(material.stake) },
          acceptedAt: Math.min(nowS(), r.summary.expiresAt - 1),
        };
        const sig = await material.attest(acceptSubject(body));
        const mac = r.source === 'link' ? acceptMac(bytes(r.macKey!), acceptDigest(body)) : undefined;
        const plaintext = encodeSignedAccept(body, sig, mac);
        const sealed = sealForRecipients('ACCEPT', body.setupId, plaintext, [{ slot: 0, key: replyKey }], sealRandomness(1));
        try {
          await api.respond(r.setupId, { kind: 'accept', ...channel(r), ...sealed });
        } catch (error) {
          return await serverEnded(r, error);
        }
        const next: StoredReceived = {
          ...r,
          state: 'accepted',
          join: { walletId: wallet.id, ownIndex: index, payment: material.payment, stake: material.stake, label, acceptDigest: acceptDigest(body), acceptedAt: body.acceptedAt },
        };
        await records.putReceived(next);
        return receivedView(next);
      } finally {
        material.wipe();
      }
    });
  }

  async function decline(input: { ref?: unknown }) {
    return serial(async () => {
      const r = answerable(await loadReceived(input.ref));
      const replyKey = bytes(r.summary.replyKey);
      if (!isUsableX25519Key(replyKey)) return fail('REFUSED');
      const setupId = bytes(r.setupId);
      const plaintext = encodeDecline({ setupId, invite: bytes(r.digest) });
      const sealed = sealForRecipients('DECLINE', setupId, plaintext, [{ slot: 0, key: replyKey }], sealRandomness(1));
      try {
        await api.respond(r.setupId, { kind: 'decline', ...channel(r), ...sealed });
      } catch (error) {
        return serverEnded(r, error);
      }
      const next: StoredReceived = { ...r, state: 'declined', endedAt: nowMs() };
      await records.putReceived(next);
      return receivedView(next);
    });
  }

  async function block(input: { ref?: unknown }) {
    const r = await loadReceived(input.ref);
    if (r.source !== 'mailbox' || !r.inviteId) return fail('INVALID_INPUT');
    try {
      await api.block(r.inviteId);
    } catch (error) {
      if (!(error instanceof InviteApiError && error.code === 'not_found')) return apiFailure(error);
    }
    const next: StoredReceived = { ...r, state: r.state === 'open' ? 'blocked' : r.state, endedAt: r.endedAt ?? nowMs() };
    await records.putReceived(next);
    return receivedView(next);
  }

  /** The cosigner read the number (and saved the vault when `vaultId` is given). */
  async function markJoined(input: { ref?: unknown; vaultId?: unknown }) {
    const r = await loadReceived(input.ref);
    // A cancelled join may still belong to a vault the initiator saved: verifying it is allowed.
    if (!r.join || (r.state !== 'accepted' && r.state !== 'cancelled')) return fail('INVALID_INPUT');
    const vaultId = typeof input.vaultId === 'string' && /^[0-9a-f]{64}$/.test(input.vaultId) ? input.vaultId : undefined;
    const next: StoredReceived = {
      ...r,
      ...(vaultId ? { state: 'completed' as const, endedAt: nowMs() } : {}),
      join: { ...r.join, verifiedAt: r.join.verifiedAt ?? nowMs(), ...(vaultId ? { vaultId } : {}) },
    };
    await records.putReceived(next);
    return receivedView(next);
  }

  async function getReceived(input: { ref?: unknown }) {
    return receivedView(await loadReceived(input.ref));
  }

  /** The indexes the create flow must not take (a paste-path vault of the same wallet). */
  async function holds(input: { walletId?: unknown }) {
    if (typeof input.walletId !== 'number') return fail('INVALID_INPUT');
    return inviteHolds(input.walletId);
  }

  async function status() {
    const key = await requireDeviceKey();
    return { inviteKey: bytesToHex(key.publicKey) };
  }

  /** The device's invite public key for `PUT /device`, or null before any vault screen asked for one. */
  async function devicePublicKey(): Promise<string | null> {
    const key = await deviceKey(false);
    return key ? bytesToHex(key.publicKey) : null;
  }

  // ---- push --------------------------------------------------------------------------------

  /**
   * A `vault_invite` / `vault_response` push: fetch and open what it points at, so the notification
   * says who and what. `null` when nothing opened (the generic line is shown then).
   */
  async function forPush(t: string, setupId: string): Promise<
    | { kind: 'invite'; ref: string; inviter: string; vault: string; known: boolean }
    | { kind: 'joined' | 'declined'; setupId: string; cosigner: string; vault: string }
    | null
  > {
    if (!HEX16.test(setupId)) return null;
    if (t === 'vault_invite') {
      await refreshInvites();
      const found = (await records.receivedAll()).find(r => r.setupId === setupId && r.state === 'open');
      return found ? { kind: 'invite', ref: found.ref, inviter: found.summary.inviterLabel, vault: found.summary.vaultName, known: found.known } : null;
    }
    if (t === 'vault_response') {
      const before = await records.setup(setupId);
      if (!before) return null;
      const after = await refreshSetup({ setupId });
      for (const slot of after.slots) {
        const was = before.slots.find(x => x.n === slot.n);
        if (slot.status === 'accepted' && !was?.accept) return { kind: 'joined', setupId, cosigner: slot.accept?.label ?? '', vault: after.name };
        if (slot.status === 'declined' && was?.declinedAt === undefined) return { kind: 'declined', setupId, cosigner: slot.label ?? '', vault: after.name };
      }
      return null;
    }
    return null;
  }

  return {
    status,
    devicePublicKey,
    resolve,
    startSetup,
    unlockSetup,
    updateTerms,
    invite,
    link,
    withdrawLink,
    refreshSetup,
    remind,
    revoke,
    markVerified,
    cancelSetup,
    completeSetup,
    listSetups,
    getSetup,
    refreshInvites,
    openLink,
    accept,
    decline,
    block,
    markJoined,
    getReceived,
    holds,
    forPush,
  };
}

export type InviteService = ReturnType<typeof createInviteService>;
