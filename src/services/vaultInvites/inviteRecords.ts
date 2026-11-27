/**
 * What this device keeps about vault invitations, in the extension-origin private store
 * (`privateStore.ts`), never in `chrome.storage.local`: the records hold the device's X25519 invite
 * secret, revoke secrets, link capabilities and join tokens.
 *
 * - `vaultInviteDeviceKey`: this device's invite key pair (PROTOCOL 3.1), one for its life.
 * - `vaultInviteSetup:<setupId>`: a setup this device started (the initiator side).
 * - `vaultInviteReceived:<ref>`: an invitation this device opened (the cosigner side); `ref` is the
 *   server's `inviteId`, or `l` and the join token hash for one opened from a QR or link.
 *
 * - `vaultInviteKnownCosigners`: the stake credentials of cosigners this device verified (GV-61) in
 *   its own setups, so their later invitations are "for you", not requests. No secret.
 *
 * Pages never read these keys: they get views without secrets through the background
 * (`inviteService.ts`). Storage is injected so the service runs in a test without IndexedDB.
 */
import type { InviteNetwork } from '@/shared/gerovault/invite';
import type { VaultNetwork } from '@/shared/gerovault';
import type { InviteState, LinkState } from './inviteApi';

export interface InviteKv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  entries(prefix: string): Promise<[string, unknown][]>;
}

export const DEVICE_KEY = 'vaultInviteDeviceKey';
export const SETUP_PREFIX = 'vaultInviteSetup:';
export const RECEIVED_PREFIX = 'vaultInviteReceived:';
export const KNOWN_COSIGNERS_KEY = 'vaultInviteKnownCosigners';
/** The newest entries kept; older ones fall off. */
export const KNOWN_COSIGNERS_MAX = 200;

/** A cosigner this device read the verification number with. */
export interface KnownCosigner {
  readonly network: VaultNetwork;
  /** The cosigner wallet's stake credential, hex (from their checked ACCEPT). */
  readonly stakeCredential: string;
  readonly verifiedAt: number;
}

export interface StoredDeviceKey {
  /** 32 random bytes, hex. Never leaves the worker. */
  readonly secret: string;
  readonly publicKey: string;
  readonly createdAt: number;
}

/** A remote invitation the initiator sent to one cosigner slot. */
export interface StoredInvite {
  readonly inviteId: string;
  readonly stakeCredential: string;
  readonly handle?: string;
  readonly digest: string;
  /** The revoke secret of this one invitation, hex (PROTOCOL 4.4). */
  readonly revokeSecret: string;
  /** Unix seconds, as signed. */
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly state: InviteState;
  readonly remindedAt?: number;
  /**
   * The five directory keys this invitation was sealed to, in slot order. A reminder compares them
   * with a fresh directory: other keys mean the cosigner's devices changed and the invitation is
   * sent again. Absent on an invitation from before this was kept (treated as changed).
   */
  readonly recipientKeys?: readonly string[];
}

/** An invitation a reminder replaced: an answer to it that was already on its way still opens. */
export interface SupersededInvite {
  readonly inviteId: string;
  readonly digest: string;
  /** Unix seconds, as signed. */
  readonly expiresAt: number;
}

/** A second ACCEPT from a wallet that already fills a slot of the setup: never used. */
export interface DuplicateJoin {
  readonly label: string;
  readonly stakeCredential: string;
  readonly via: 'invite' | 'qr' | 'link';
  readonly receivedAt: number;
}

/** A QR shown or a link copied: one capability each (PROTOCOL 5). */
export interface StoredLink {
  readonly joinTokenHash: string;
  /** The capability, hex: secret. */
  readonly cap: string;
  readonly digest: string;
  readonly kind: 'qr' | 'link';
  /** Unix seconds. */
  readonly expiresAt: number;
  /** The link copy's own expiry (`INVITE.expiresAt`), unix seconds: an ACCEPT must predate it. */
  readonly inviteExpiresAt: number;
  readonly state: LinkState;
  readonly createdAt: number;
}

/** A cosigner's opened and checked ACCEPT. */
export interface StoredAccept {
  readonly label: string;
  readonly stakeCredential: string;
  /** The cosigner's vault keys, raw Ed25519 public keys (hex). */
  readonly payment: string;
  readonly stake: string;
  readonly digest: string;
  /** Unix seconds, as signed. */
  readonly acceptedAt: number;
  readonly via: 'invite' | 'qr' | 'link';
  readonly receivedAt: number;
}

export interface SetupSlot {
  /** 0 for the first cosigner (owner 2). */
  readonly n: number;
  readonly label?: string;
  readonly invite?: StoredInvite;
  /** Earlier invitations of this slot that a reminder replaced. */
  readonly superseded?: readonly SupersededInvite[];
  readonly accept?: StoredAccept;
  readonly declinedAt?: number;
  /** The number was read with this cosigner on this device (GV-61). */
  readonly verifiedAt?: number;
}

export interface StoredSetup {
  readonly v: 1;
  readonly setupId: string;
  readonly walletId: number;
  readonly network: VaultNetwork;
  readonly name: string;
  readonly owners: number;
  readonly threshold: number;
  readonly ownIndex: number;
  readonly ownLabel: string;
  readonly ownStakeCredential: string;
  readonly ownPayment: string;
  readonly ownStake: string;
  /** Milliseconds. */
  readonly createdAt: number;
  readonly expiresAt: number;
  /** `POST /vault-setups` answered. */
  readonly registered: boolean;
  readonly slots: readonly SetupSlot[];
  readonly links: readonly StoredLink[];
  /** Response ids already handled, and ACCEPT digests already used (gero-sync may redeliver). */
  readonly seenResponses: readonly string[];
  /** Wallets that answered a second time (by link after an invitation, or twice by link). */
  readonly duplicates?: readonly DuplicateJoin[];
  readonly state: 'open' | 'closed' | 'expired' | 'completed';
  readonly vaultId?: string;
}

/** The parts of a checked INVITE a screen shows, kept so the invitation reads without opening again. */
export interface ReceivedSummary {
  readonly vaultName: string;
  readonly threshold: number;
  readonly owners: number;
  readonly inviterLabel: string;
  readonly inviterCredential: string;
  readonly inviterHandle?: string;
  readonly inviterPayment: string;
  readonly inviterStake: string;
  readonly participants: readonly { readonly label: string; readonly status: string }[];
  readonly replyKey: string;
  readonly invitee?: string;
  /** Unix seconds. */
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly revokeHash: string;
}

export interface ReceivedJoin {
  readonly walletId: number;
  readonly ownIndex: number;
  readonly payment: string;
  readonly stake: string;
  readonly label: string;
  readonly acceptDigest: string;
  readonly acceptedAt: number;
  readonly verifiedAt?: number;
  readonly vaultId?: string;
}

export type ReceivedState = 'open' | 'accepted' | 'declined' | 'revoked' | 'expired' | 'answeredElsewhere' | 'blocked' | 'cancelled' | 'completed';

export interface StoredReceived {
  readonly v: 1;
  readonly ref: string;
  readonly source: 'mailbox' | 'link';
  readonly inviteId?: string;
  /** The join token (link only), hex: secret. */
  readonly joinToken?: string;
  /** The link's MAC key, hex: secret. */
  readonly macKey?: string;
  readonly setupId: string;
  readonly network: InviteNetwork;
  /** The signed INVITE's canonical CBOR, hex (to check a later REVOKE against). */
  readonly signedInvite: string;
  readonly digest: string;
  readonly summary: ReceivedSummary;
  /** The stake credential gero-sync filed it under (mailbox only). */
  readonly addressedTo?: string;
  /** From a contact or someone this device already shares a vault with: "Needs you", else "Requests". */
  readonly known: boolean;
  readonly receivedAt: number;
  readonly state: ReceivedState;
  readonly endedAt?: number;
  /** The REVOKE gero-sync relayed opened against this invitation's revoke hash. */
  readonly revokeProven?: boolean;
  readonly join?: ReceivedJoin;
}

export interface InviteRecords {
  deviceKey(): Promise<StoredDeviceKey | undefined>;
  setDeviceKey(key: StoredDeviceKey): Promise<void>;
  setup(setupId: string): Promise<StoredSetup | undefined>;
  setups(): Promise<StoredSetup[]>;
  putSetup(setup: StoredSetup): Promise<void>;
  removeSetup(setupId: string): Promise<void>;
  received(ref: string): Promise<StoredReceived | undefined>;
  receivedAll(): Promise<StoredReceived[]>;
  putReceived(received: StoredReceived): Promise<void>;
  knownCosigners(): Promise<KnownCosigner[]>;
  addKnownCosigner(cosigner: KnownCosigner): Promise<void>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function createInviteRecords(kv: InviteKv): InviteRecords {
  async function knownCosigners(): Promise<KnownCosigner[]> {
    const rows = await kv.get<unknown>(KNOWN_COSIGNERS_KEY);
    return Array.isArray(rows)
      ? rows.filter((r): r is KnownCosigner => isRecord(r) && typeof r['network'] === 'string' && typeof r['stakeCredential'] === 'string' && typeof r['verifiedAt'] === 'number')
      : [];
  }
  return {
    deviceKey: () => kv.get<StoredDeviceKey>(DEVICE_KEY),
    setDeviceKey: key => kv.set(DEVICE_KEY, key),
    setup: setupId => kv.get<StoredSetup>(SETUP_PREFIX + setupId),
    async setups() {
      const rows = await kv.entries(SETUP_PREFIX);
      return rows.map(([, v]) => v).filter((v): v is StoredSetup => isRecord(v) && v['v'] === 1);
    },
    putSetup: setup => kv.set(SETUP_PREFIX + setup.setupId, setup),
    removeSetup: setupId => kv.remove(SETUP_PREFIX + setupId),
    received: ref => kv.get<StoredReceived>(RECEIVED_PREFIX + ref),
    async receivedAll() {
      const rows = await kv.entries(RECEIVED_PREFIX);
      return rows.map(([, v]) => v).filter((v): v is StoredReceived => isRecord(v) && v['v'] === 1);
    },
    putReceived: received => kv.set(RECEIVED_PREFIX + received.ref, received),
    knownCosigners,
    async addKnownCosigner(cosigner) {
      const rest = (await knownCosigners()).filter(k => !(k.network === cosigner.network && k.stakeCredential === cosigner.stakeCredential));
      await kv.set(KNOWN_COSIGNERS_KEY, [cosigner, ...rest].slice(0, KNOWN_COSIGNERS_MAX));
    },
  };
}

/** An in-memory store for tests and for a worker without IndexedDB. */
export function memoryInviteKv(): InviteKv & { readonly map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)) as T);
  return {
    map,
    get: async <T>(key: string) => clone(map.get(key)) as T | undefined,
    set: async (key, value) => { map.set(key, clone(value)); },
    remove: async key => { map.delete(key); },
    entries: async prefix => [...map.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, clone(v)]),
  };
}
