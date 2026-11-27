/**
 * Devices for the invitation specs: an invite service per device over the fake gero-sync, with the
 * manifest specs' test accounts as wallets. Test keys only.
 */
import { Bip32PrivateKey, ready } from '@cardano-sdk/crypto';
import { blake2b } from '@noble/hashes/blake2.js';
import { bytesToHex } from '@/shared/gerovault/cbor';
import { deriveRoleKeys, deriveVaultPublicKeys, multisigAccountPublicKey, vaultKeyHashes } from '@/shared/gerovault';
import { testAccounts } from '@/shared/gerovault/__fixtures__/manifest';
import { Blockchain, Network, WalletType, type Wallet } from '@/models/types';
import { OwnAccountKeyError } from '@/modules/gerovault/create/ownAccountKeyFlow';
import { createInviteApi, type InviteTransport } from '../inviteApi';
import { publishableInviteKey } from '../deviceInviteKey';
import { cip8AttestationOf, type VaultKeyMaterial } from '../inviteKeys';
import { createInviteRecords, memoryInviteKv, type InviteRecords } from '../inviteRecords';
import { InviteServiceError, createInviteService, type InviteService } from '../inviteService';
import type { FakeSync } from './fakeSync';

export const NETWORK = 'cardano-preprod';
export const RIGHT = { password: 'right' };
export const fixed = (label: string, n = 32) => blake2b(new TextEncoder().encode(`invite harness|${label}`), { dkLen: n });
export const credentialOf = (label: string) => bytesToHex(fixed(`stake ${label}`, 28));

/** Wallet id -> test account: 1 Adam (initiator), 2 Dana, 3 Yuval, 4 Dana's second wallet. */
const ACCOUNT_OF: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3 };
export const NAMES: Record<number, string> = { 1: 'Adam', 2: 'Dana', 3: 'Yuval', 4: 'Dana spare' };

let accounts: Bip32PrivateKey[] | undefined;
export async function loadAccounts(): Promise<void> {
  await ready();
  accounts ??= await testAccounts();
}

export function wallet(id: number, overrides: Partial<Wallet> = {}): Wallet {
  return { id, name: NAMES[id], chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal, encryptionMethod: 'password', ...overrides } as Wallet;
}

/** The vault payment key of a test account at `index`, as the background would open it. */
export async function material(walletId: number, index: number): Promise<VaultKeyMaterial> {
  const account = accounts![ACCOUNT_OF[walletId]];
  const keys = await deriveVaultPublicKeys(await deriveRoleKeys(multisigAccountPublicKey(account.toPublic().hex())), index);
  const credential = (await vaultKeyHashes(keys)).payment;
  const signer = account.derive([0, index]).toRawKey();
  let wiped = false;
  return {
    index,
    accountKey: account.toPublic().hex(),
    payment: keys.payment,
    stake: keys.stake,
    credential,
    attest: async subject => {
      if (wiped) throw new OwnAccountKeyError('locked');
      return cip8AttestationOf(signer, credential, subject);
    },
    wipe: () => { wiped = true; },
  };
}

export interface Device {
  readonly name: string;
  service: InviteService;
  readonly records: InviteRecords;
  readonly kv: ReturnType<typeof memoryInviteKv>;
  readonly backedUp: Set<number>;
  readonly wallets: Record<number, Wallet>;
  readonly contacts: Set<string>;
  /** How often the device key was published (`PUT /device`). */
  published: number;
  /** What the notify registration does on every `PUT /device`: make the key if needed and publish it. */
  register(): Promise<string | null>;
}

let seed = 0;

export function makeDevice(sync: FakeSync, now: () => number, name: string, walletIds: number[], opts: { wrap?: (t: InviteTransport) => InviteTransport; contacts?: string[] } = {}): Device {
  const kv = memoryInviteKv();
  const records = createInviteRecords(kv);
  const wallets: Record<number, Wallet> = Object.fromEntries(walletIds.map(id => [id, wallet(id)]));
  const random = (n: number) => fixed(`${name} random ${++seed}`, n);
  const base = sync.transport(name, async () => (await records.deviceKey())?.publicKey ?? null);
  for (const id of walletIds) sync.device(name, { links: [`${NETWORK}|${credentialOf(NAMES[id])}`] });
  const d: Device = {
    name,
    service: undefined as unknown as InviteService,
    records,
    kv,
    backedUp: new Set(walletIds),
    wallets,
    contacts: new Set(opts.contacts ?? []),
    published: 0,
    async register() {
      const key = await publishableInviteKey(records, { available: async () => true, random, now });
      if (key) sync.device(name, { inviteKey: key });
      return key;
    },
  };
  d.service = createInviteService({
    api: createInviteApi(opts.wrap ? opts.wrap(base) : base, { now }),
    records,
    keys: {
      open: async (walletId, auth, index) => {
        if (auth.password !== 'right') throw new OwnAccountKeyError('wrong-password');
        return material(walletId, index);
      },
    },
    wallets: {
      all: async () => d.wallets,
      stakeCredential: w => credentialOf(w.name),
      backedUp: async id => d.backedUp.has(id),
      contactCredentials: async () => d.contacts,
    },
    vaultIndexes: async () => [],
    resolveHandle: async () => null,
    random,
    now,
    onDeviceKeyCreated: () => {
      d.published++;
      void records.deviceKey().then(k => sync.device(name, { inviteKey: k?.publicKey }));
    },
  });
  return d;
}

export async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof InviteServiceError) return error.code;
    throw error;
  }
  return 'resolved';
}
