import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { jubjub } from '@noble/curves/jubjub';
import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIDNIGHT_VAULT_BUILDS } from '@/chains/midnight/vault/build';
import {
  MIDNIGHT_APPROVAL_FILE_TYPE,
  MIDNIGHT_REQUEST_FILE_TYPE,
  midnightVaultId,
  type MidnightLastCheck,
  type MidnightOwnerApprovalFile,
  type MidnightRequestFile,
  type MidnightStoredParticipants,
  type MidnightStoredRequest,
  type MidnightVaultCandidateInput,
} from '@/modules/gerovault/midnight/contracts';
import { walletDBSchema } from './schema';
import { clearDbCache, getDb } from './wallet-db';
import { vaultStore } from './vaultStore';
import { MidnightVaultStoreError, createMidnightVaultStore, midnightVaultStore, type MidnightCardExpectation } from './midnightVaultStore';

// -------------------------------------------------------------------------------------------------
// Fixtures

const TEST = MIDNIGHT_VAULT_BUILDS.test;
const PRODUCTION = MIDNIGHT_VAULT_BUILDS.production;

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const digestOf = (text: string) => hex(sha256(new TextEncoder().encode(text)));

/** Little-endian 32-byte hex of a field element. */
function le32(value: bigint): string {
  const be = value.toString(16).padStart(64, '0');
  let out = '';
  for (let i = 62; i >= 0; i -= 2) out += be.slice(i, i + 2);
  return out;
}

function leValue(hexLe: string): bigint {
  let be = '';
  for (let i = hexLe.length - 2; i >= 0; i -= 2) be += hexLe.slice(i, i + 2);
  return BigInt(`0x${be}`);
}

/** A Jubjub public key in the runtime's layout: x then y, little-endian. */
function jubjubKey(scalar: bigint): string {
  const { x, y } = jubjub.ExtendedPoint.BASE.multiply(scalar).toAffine();
  return le32(x) + le32(y);
}

const upgradeKey = (seed: number) => hex(schnorr.getPublicKey(new Uint8Array(32).fill(seed)));

/** The full key check integration passes in: on the curve, prime order, and an x-only key that lifts. */
function fullKeyProblem(key: { kind: 'jubjub' | 'upgrade'; hex: string }): string | null {
  try {
    if (key.kind === 'upgrade') {
      schnorr.utils.lift_x(BigInt(`0x${key.hex}`));
      return null;
    }
    const point = jubjub.ExtendedPoint.fromAffine({ x: leValue(key.hex.slice(0, 64)), y: leValue(key.hex.slice(64)) });
    point.assertValidity();
    return point.isTorsionFree() && !point.isSmallOrder() ? null : 'not in the prime-order subgroup';
  } catch {
    return 'not a point';
  }
}

const P = jubjub.CURVE.Fp.ORDER;
/** (0, -1): on the curve, of order 2. Encoded well; refused only by the full key check. */
const ORDER_TWO = le32(0n) + le32(P - 1n);

const owners = [1, 2, 3].map(i => ({ approvalKey: jubjubKey(BigInt(1000 + i)), upgradeKey: upgradeKey(i) }));
const commitments = [1, 2, 3].map(i => le32(BigInt(7000 + i)));
const delegateKeys = [1, 2].map(i => jubjubKey(BigInt(3000 + i)));
const ADDRESS = digestOf('contract address');
const OTHER_ADDRESS = digestOf('another contract');
const AGREED = { cbor: 'a1616101', digest: digestOf('verification set') };
const VAULT_ID = midnightVaultId('preprod', ADDRESS);

function participants(overrides: Partial<MidnightStoredParticipants> = {}): MidnightStoredParticipants {
  return {
    owners: [...owners.map((o, i) => ({ ...o, label: `Owner ${i + 1}` })), null, null],
    guardians: [...commitments.map(commitment => ({ commitment })), null, null],
    delegates: [null, null],
    ...overrides,
  };
}

function lastCheck(checks: Partial<MidnightLastCheck['checks']> = {}, overrides: Partial<MidnightLastCheck> = {}): MidnightLastCheck {
  return {
    source: 'indexer',
    blockHeight: 120345,
    blockHash: digestOf('block'),
    at: 1_800_000_000_000,
    checks: { operations: 'exact', committee: 'owners', decoded: true, role: true, matchesAgreed: true, ...checks },
    ...overrides,
  };
}

/** A 2 of 3 test-build vault on preprod with three guardians, imported by owner 1 at index 1. */
function candidate(overrides: Partial<MidnightVaultCandidateInput> = {}): MidnightVaultCandidateInput {
  const network = overrides.network ?? 'preprod';
  const contractAddress = overrides.contractAddress ?? ADDRESS;
  return {
    vaultId: overrides.vaultId ?? midnightVaultId(network, contractAddress),
    network,
    contractAddress,
    build: TEST.buildId,
    origin: 'imported',
    lifecycle: 'ready',
    name: 'Team vault',
    self: [{ role: 'owner', index: 1 }],
    participants: participants(),
    agreedConfig: AGREED,
    verifications: [{ approvalKey: owners[1].approvalKey, method: 'number', verificationDigest: AGREED.digest, at: 1_800_000_000 }],
    lastCheck: lastCheck(),
    ...overrides,
  };
}

/** A production-build candidate on `network`. */
function production(network: 'preprod' | 'mainnet' | 'preview'): MidnightVaultCandidateInput {
  return candidate({ network, build: PRODUCTION.buildId });
}

function requestFile(overrides: Record<string, unknown> = {}): MidnightRequestFile {
  return {
    type: MIDNIGHT_REQUEST_FILE_TYPE,
    version: 1,
    network: 'preprod',
    contract: ADDRESS,
    build: TEST.buildId,
    kind: 'payout',
    signers: 'owners',
    nonce: '3',
    expiry: 1_800_172_800,
    body: { recipient: 'mn_addr_preprod1example', amount: '1000000' },
    digest: digestOf('payout statement'),
    createdAt: 1_800_000_000_000,
    ...overrides,
  } as MidnightRequestFile;
}

function approval(signer = owners[0].approvalKey, overrides: Record<string, unknown> = {}): MidnightOwnerApprovalFile {
  return {
    type: MIDNIGHT_APPROVAL_FILE_TYPE,
    version: 1,
    network: 'preprod',
    contract: ADDRESS,
    digest: digestOf('payout statement'),
    createdAt: 1_800_000_000_000,
    role: 'owner',
    approvalKey: signer,
    signature: { announcement: jubjubKey(9n), response: le32(9n) },
    ...overrides,
  } as MidnightOwnerApprovalFile;
}

function stored(overrides: Partial<MidnightStoredRequest> = {}): MidnightStoredRequest {
  return { request: requestFile(), approvals: [approval()], state: 'open', updatedAt: 0, ...overrides };
}

const store = createMidnightVaultStore({ keyProblem: fullKeyProblem });

let nextWallet = 307100;
const wallets: number[] = [];
const extraDatabases: Dexie[] = [];
function walletId(): number {
  const wallet = nextWallet++;
  wallets.push(wallet);
  return wallet;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of extraDatabases.splice(0)) db.close();
  for (const wallet of wallets.splice(0)) {
    clearDbCache(wallet);
    await Dexie.delete(`wallet-${wallet}`);
  }
});

/** The error's code, and its reason when it has one: `INVALID_INPUT/SELF_MISMATCH`. */
async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(MidnightVaultStoreError);
  const { code, reason } = error as MidnightVaultStoreError;
  return reason ? `${code}/${reason}` : code;
}

async function accepted(wallet: number, overrides: Partial<MidnightVaultCandidateInput> = {}) {
  const added = await store.addCandidate(wallet, candidate(overrides));
  return store.accept(wallet, added.vaultId);
}

// -------------------------------------------------------------------------------------------------

describe('Midnight vault store: records', () => {
  it('adds a candidate that reads back as stored, in slot order', async () => {
    const wallet = walletId();
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const added = await store.addCandidate(wallet, candidate());
    expect(added).toEqual({
      recordVersion: 1,
      vaultId: VAULT_ID,
      network: 'preprod',
      contractAddress: ADDRESS,
      build: TEST.buildId,
      status: 'candidate',
      origin: 'imported',
      lifecycle: 'ready',
      name: 'Team vault',
      self: [{ role: 'owner', index: 1 }],
      participants: participants(),
      agreedConfig: AGREED,
      verifications: candidate().verifications,
      deployment: null,
      lastCheck: lastCheck(),
      requests: [],
      successor: null,
      createdAt: 1_800_000_000_000,
      updatedAt: 1_800_000_000_000,
      acceptedAt: null,
    });
    clearDbCache(wallet);
    expect(await store.get(wallet, VAULT_ID)).toEqual(added);
    expect(await store.list(wallet)).toEqual([added]);
  });

  it('keeps each wallet\'s vaults apart and filters by status and network', async () => {
    const [mine, theirs] = [walletId(), walletId()];
    await store.addCandidate(mine, candidate());
    const other = await accepted(mine, { contractAddress: OTHER_ADDRESS });
    expect(await store.list(theirs)).toEqual([]);
    expect(await store.get(theirs, VAULT_ID)).toBeUndefined();
    expect((await store.list(mine, { status: 'accepted' })).map(v => v.vaultId)).toEqual([other.vaultId]);
    expect((await store.list(mine, { status: 'candidate' })).map(v => v.vaultId)).toEqual([VAULT_ID]);
    expect(await store.list(mine, { network: 'mainnet' })).toEqual([]);
  });

  it('refuses a vault id that the network and contract address do not give', async () => {
    const wallet = walletId();
    expect(await refusal(store.addCandidate(wallet, candidate({ vaultId: midnightVaultId('mainnet', ADDRESS) })))).toBe('VAULT_ID_MISMATCH');
    expect(await refusal(store.addCandidate(wallet, candidate({ vaultId: midnightVaultId('preprod', OTHER_ADDRESS) })))).toBe('VAULT_ID_MISMATCH');
    expect(await refusal(store.addCandidate(wallet, candidate({ vaultId: VAULT_ID, contractAddress: 'AB'.repeat(32) })))).toBe('INVALID_INPUT/MALFORMED');
    expect(await store.list(wallet)).toEqual([]);
  });

  it('refuses the same vault twice', async () => {
    const wallet = walletId();
    await store.addCandidate(wallet, candidate());
    expect(await refusal(store.addCandidate(wallet, candidate({ name: 'Again' })))).toBe('VAULT_EXISTS');
    expect((await store.get(wallet, VAULT_ID))!.name).toBe('Team vault');
  });
});

describe('Midnight vault store: builds', () => {
  it('refuses a build that is not pinned', async () => {
    expect(await refusal(store.addCandidate(walletId(), candidate({ build: 'gvmn-test-0000000000000000' })))).toBe('INVALID_INPUT/UNKNOWN_BUILD');
  });

  it('refuses a test build on any network other than preprod, even where a pin lists it', async () => {
    const wallet = walletId();
    for (const network of ['mainnet', 'preview'] as const) {
      expect(await refusal(store.addCandidate(wallet, candidate({ network })))).toBe('INVALID_INPUT/TEST_BUILD_NETWORK');
    }
    const loose = createMidnightVaultStore({ builds: [{ ...TEST, networks: ['preprod', 'preview', 'mainnet'] }] });
    for (const network of ['mainnet', 'preview'] as const) {
      expect(await refusal(loose.addCandidate(wallet, candidate({ network })))).toBe('INVALID_INPUT/TEST_BUILD_NETWORK');
    }
    expect(await store.list(wallet)).toEqual([]);
  });

  it('takes the production build on the networks its pin lists, and only those', async () => {
    const wallet = walletId();
    expect((await store.addCandidate(wallet, production('mainnet'))).build).toBe(PRODUCTION.buildId);
    expect((await store.addCandidate(wallet, production('preprod'))).build).toBe(PRODUCTION.buildId);
    expect(await refusal(store.addCandidate(wallet, production('preview')))).toBe('INVALID_INPUT/BUILD_NETWORK');
  });

  it('refuses a split deployment that defers anything but the build\'s deferred set', async () => {
    const wallet = walletId();
    const partial = { deployTxHash: digestOf('deploy'), deferred: ['deposit' as const] };
    expect(await refusal(store.addCandidate(wallet, candidate({ deployment: partial })))).toBe('INVALID_INPUT/BUILD_MISMATCH');
    expect(await refusal(store.addCandidate(wallet, candidate({ deployment: { deferred: ['sweep' as never] } })))).toBe('INVALID_INPUT/MALFORMED');
    const split = { deployTxHash: digestOf('deploy'), completionTxHash: digestOf('completion'), deferred: [...TEST.deferred].reverse() };
    expect((await store.addCandidate(wallet, candidate({ deployment: split }))).deployment).toEqual({ ...split, deferred: [...TEST.deferred].sort() });
  });
});

describe('Midnight vault store: import checks, committee and lifecycle', () => {
  it('stores nothing whose state read failed an import check', async () => {
    const wallet = walletId();
    for (const checks of [
      { operations: 'unknown-build' as const },
      { decoded: false },
      { role: false },
      { matchesAgreed: false },
    ]) {
      expect(await refusal(store.addCandidate(wallet, candidate({ lastCheck: lastCheck(checks) })))).toBe('INVALID_INPUT/IMPORT_CHECK_FAILED');
    }
    // The agreed configuration is compared exactly when there is one.
    expect(await refusal(store.addCandidate(wallet, candidate({ lastCheck: lastCheck({ matchesAgreed: null }) })))).toBe('INVALID_INPUT/MALFORMED');
    expect(await refusal(store.addCandidate(wallet, candidate({ agreedConfig: null, verifications: [] })))).toBe('INVALID_INPUT/MALFORMED');
    expect(await store.list(wallet)).toEqual([]);
    const noCeremony = await store.addCandidate(wallet, candidate({ agreedConfig: null, verifications: [], lastCheck: lastCheck({ matchesAgreed: null }) }));
    expect(noCeremony.agreedConfig).toBeNull();
  });

  it('stores a later read whatever it found, so the screen sees the change', async () => {
    const wallet = walletId();
    const vault = await accepted(wallet);
    const unknown = await store.update(wallet, vault.vaultId, { lastCheck: lastCheck({ operations: 'unknown-build' }) });
    expect(unknown.lastCheck!.checks.operations).toBe('unknown-build');
    const drift = await store.update(wallet, vault.vaultId, { lastCheck: lastCheck({ committee: 'drift' }) });
    expect(drift.lastCheck!.checks.committee).toBe('drift');
    expect(await store.get(wallet, vault.vaultId)).toEqual(drift);
  });

  it('keeps an incomplete deployment, and refuses to call it ready', async () => {
    const wallet = walletId();
    expect(await refusal(store.addCandidate(wallet, candidate({ lastCheck: lastCheck({ operations: 'incomplete' }) })))).toBe('INVALID_INPUT/LIFECYCLE_MISMATCH');
    expect(await refusal(store.addCandidate(wallet, candidate({ lastCheck: lastCheck({ committee: 'interim' }) })))).toBe('INVALID_INPUT/LIFECYCLE_MISMATCH');
    expect(await refusal(store.addCandidate(wallet, candidate({ lifecycle: 'incomplete' })))).toBe('INVALID_INPUT/LIFECYCLE_MISMATCH');
    const interim = lastCheck({ operations: 'incomplete', committee: 'interim' });
    expect((await store.addCandidate(wallet, candidate({ lifecycle: 'incomplete', lastCheck: interim }))).lastCheck).toEqual(interim);
    // A committee out of step is kept, as the drift flag.
    expect((await store.addCandidate(wallet, candidate({ contractAddress: OTHER_ADDRESS, lastCheck: lastCheck({ committee: 'drift' }) }))).lifecycle).toBe('ready');
  });

  it('lets only a vault this device created be deploying, and nothing else go without a state read', async () => {
    const wallet = walletId();
    const deploying = { lifecycle: 'deploying' as const, lastCheck: null };
    expect(await refusal(store.addCandidate(wallet, candidate(deploying)))).toBe('INVALID_INPUT/LIFECYCLE_MISMATCH');
    expect(await refusal(store.addCandidate(wallet, candidate({ lastCheck: null })))).toBe('INVALID_INPUT/LIFECYCLE_MISMATCH');
    expect((await store.addCandidate(wallet, candidate({ ...deploying, origin: 'created' }))).lifecycle).toBe('deploying');
  });

  it('ties the successor to a recovered or moved vault, and keeps a moved vault moved', async () => {
    const wallet = walletId();
    const successor = midnightVaultId('preprod', OTHER_ADDRESS);
    const ready = await accepted(wallet);
    expect(await refusal(store.update(wallet, ready.vaultId, { successor }))).toBe('INVALID_INPUT/LIFECYCLE_MISMATCH');
    expect(await refusal(store.update(wallet, ready.vaultId, { lifecycle: 'moved' }))).toBe('INVALID_INPUT/LIFECYCLE_MISMATCH');
    expect(await refusal(store.update(wallet, ready.vaultId, { lifecycle: 'temporary', successor: VAULT_ID }))).toBe('INVALID_INPUT/MALFORMED');
    const temporary = await store.update(wallet, ready.vaultId, { lifecycle: 'temporary', lastCheck: lastCheck({ committee: 'temporary' }) });
    expect(temporary.lifecycle).toBe('temporary');
    const moved = await store.update(wallet, ready.vaultId, { lifecycle: 'moved', successor });
    expect(moved).toMatchObject({ lifecycle: 'moved', successor });
    expect(await refusal(store.update(wallet, ready.vaultId, { lifecycle: 'temporary' }))).toBe('INVALID_INPUT/LIFECYCLE_MISMATCH');
    expect(await refusal(store.update(wallet, ready.vaultId, { lifecycle: 'deploying' }))).toBe('INVALID_INPUT/LIFECYCLE_MISMATCH');
    expect(await store.get(wallet, ready.vaultId)).toEqual(moved);
  });
});

describe('Midnight vault store: participants and self', () => {
  it('refuses a record without exactly one self entry per role it holds', async () => {
    const wallet = walletId();
    const withDelegate = participants({ delegates: [{ key: delegateKeys[0], cap: '100', period: 600 }, null] });
    const cases: Partial<MidnightVaultCandidateInput>[] = [
      { self: [] },
      { self: [{ role: 'owner', index: 1 }, { role: 'owner', index: 2 }] },
      { self: [{ role: 'delegate', index: 2 }] },
      { self: [{ role: 'observer' as never, index: 1 }] },
      { participants: withDelegate, self: [{ role: 'delegate', index: 2 }, { role: 'delegate', index: 3 }] },
      // A guardian is never an owner of the same vault.
      { self: [{ role: 'owner', index: 1 }, { role: 'guardian', index: 2 }] },
    ];
    for (const overrides of cases) {
      expect(await refusal(store.addCandidate(wallet, candidate(overrides)))).toBe('INVALID_INPUT/SELF_MISMATCH');
    }
    expect(await store.list(wallet)).toEqual([]);
  });

  it('takes one entry for each of two roles, and a guardian that knows only commitments', async () => {
    const wallet = walletId();
    const both = await store.addCandidate(wallet, candidate({
      participants: participants({ delegates: [null, { key: delegateKeys[0], cap: '100000000', period: 86400, label: 'Ops' }] }),
      self: [{ role: 'delegate', index: 3 }, { role: 'owner', index: 1 }],
    }));
    expect(both.self).toEqual([{ role: 'owner', index: 1 }, { role: 'delegate', index: 3 }]);
    const guardian = await store.addCandidate(wallet, candidate({
      contractAddress: OTHER_ADDRESS,
      self: [{ role: 'guardian', index: 2 }],
      agreedConfig: null,
      verifications: [],
      lastCheck: lastCheck({ matchesAgreed: null }),
    }));
    expect(guardian.self).toEqual([{ role: 'guardian', index: 2 }]);
  });

  it('refuses an index outside 1 to 2^31 - 1', async () => {
    const wallet = walletId();
    for (const index of [0, 2 ** 31, 1.5]) {
      expect(await refusal(store.addCandidate(wallet, candidate({ self: [{ role: 'owner', index }] })))).toBe('INVALID_INPUT/MALFORMED');
    }
  });

  it('refuses keys that are malformed, the identity, outside the field, or twice in one vault', async () => {
    const wallet = walletId();
    const identity = le32(0n) + le32(1n);
    const withOwner = (o: Partial<(typeof owners)[number]>) => participants({ owners: [{ ...owners[0], ...o }, owners[1], owners[2], null, null] });
    const cases = [
      withOwner({ approvalKey: identity }),
      withOwner({ approvalKey: le32(P) + owners[0].approvalKey.slice(64) }),
      withOwner({ approvalKey: owners[0].approvalKey.slice(2) }),
      withOwner({ approvalKey: owners[0].approvalKey.toUpperCase() }),
      withOwner({ upgradeKey: '00'.repeat(32) }),
      withOwner({ upgradeKey: 'ff'.repeat(32) }),
      withOwner({ upgradeKey: owners[1].upgradeKey }),
      participants({ delegates: [{ key: owners[1].approvalKey, cap: '1', period: 600 }, null] }),
      participants({ guardians: [{ commitment: commitments[0] }, { commitment: commitments[0] }, null, null, null] }),
    ];
    for (const overrides of cases) {
      expect(await refusal(store.addCandidate(wallet, candidate({ participants: overrides })))).toBe('INVALID_INPUT/INVALID_KEY');
    }
  });

  it('runs the full key check it is given, which the encoding checks cannot replace', async () => {
    const wallet = walletId();
    const smallOrder = participants({ owners: [owners[0], owners[1], { ...owners[2], approvalKey: ORDER_TWO }, null, null] });
    const noLift = participants({ owners: [{ ...owners[0], upgradeKey: le32(0n).slice(0, 62) + '05' }, owners[1], owners[2], null, null] });
    expect(await refusal(store.addCandidate(wallet, candidate({ participants: smallOrder })))).toBe('INVALID_INPUT/INVALID_KEY');
    expect(await refusal(store.addCandidate(wallet, candidate({ participants: noLift })))).toBe('INVALID_INPUT/INVALID_KEY');
    const shapeOnly = createMidnightVaultStore();
    const identity = participants({ owners: [owners[0], owners[1], { ...owners[2], approvalKey: le32(0n) + le32(1n) }, null, null] });
    expect(await refusal(shapeOnly.addCandidate(wallet, candidate({ participants: identity })))).toBe('INVALID_INPUT/INVALID_KEY');
    expect((await shapeOnly.addCandidate(wallet, candidate({ participants: smallOrder }))).participants.owners[2]!.approvalKey).toBe(ORDER_TWO);
  });

  it('checks each card against its slot with the card check it is given', async () => {
    const wallet = walletId();
    const seen: MidnightCardExpectation[] = [];
    const cardStore = createMidnightVaultStore({
      checkCard: (card, expected) => {
        seen.push(expected);
        return card === `card:${expected.approvalKey ?? expected.commitment}`;
      },
    });
    const carded = participants({
      owners: [{ ...owners[0], card: `card:${owners[0].approvalKey}` }, owners[1], owners[2], null, null],
      guardians: [{ commitment: commitments[0], card: `card:${commitments[0]}` }, null, null, null, null],
    });
    await cardStore.addCandidate(wallet, candidate({ participants: carded }));
    expect(seen).toEqual([
      { role: 'owner', network: 'preprod', approvalKey: owners[0].approvalKey, upgradeKey: owners[0].upgradeKey },
      { role: 'guardian', network: 'preprod', commitment: commitments[0] },
    ]);
    const swapped = participants({ owners: [owners[0], { ...owners[1], card: `card:${owners[0].approvalKey}` }, owners[2], null, null] });
    expect(await refusal(cardStore.addCandidate(wallet, candidate({ contractAddress: OTHER_ADDRESS, participants: swapped })))).toBe('INVALID_INPUT/INVALID_CARD');
  });

  it('refuses slots the build does not have and malformed slot contents', async () => {
    const wallet = walletId();
    for (const overrides of [
      participants({ owners: [owners[0], owners[1], owners[2]] }),
      participants({ owners: [null, null, null, null, null] }),
      participants({ delegates: [null, null, null] }),
      participants({ guardians: [{ commitment: '00'.repeat(32) }, null, null, null, null] }),
      participants({ guardians: [{ commitment: le32(P) }, null, null, null, null] }),
      participants({ delegates: [{ key: delegateKeys[0], cap: '100', period: 599 }, null] }),
      participants({ delegates: [{ key: delegateKeys[0], cap: '-1', period: 600 }, null] }),
      participants({ owners: [{ ...owners[0], label: 'bad\u0000label' }, owners[1], owners[2], null, null] }),
    ]) {
      expect(await refusal(store.addCandidate(wallet, candidate({ participants: overrides })))).toBe('INVALID_INPUT/MALFORMED');
    }
  });

  it('refuses verification records of another configuration, of a non-owner, or with no agreed configuration', async () => {
    const wallet = walletId();
    const record = { approvalKey: owners[2].approvalKey, method: 'qr' as const, verificationDigest: AGREED.digest, at: 1_800_000_000 };
    for (const overrides of [
      { verifications: [{ ...record, verificationDigest: digestOf('another set') }] },
      { verifications: [{ ...record, approvalKey: delegateKeys[0] }] },
      { verifications: [{ ...record, method: 'voice' as never }] },
      { verifications: [record], agreedConfig: null, lastCheck: lastCheck({ matchesAgreed: null }) },
    ]) {
      expect(await refusal(store.addCandidate(wallet, candidate(overrides)))).toBe('INVALID_INPUT/MALFORMED');
    }
    expect((await store.addCandidate(wallet, candidate({ verifications: [record] }))).verifications).toEqual([record]);
  });
});

describe('Midnight vault store: candidate and accept', () => {
  it('accepts only through accept, once', async () => {
    const wallet = walletId();
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const added = await store.addCandidate(wallet, candidate());
    expect(added.status).toBe('candidate');
    expect(await refusal(store.update(wallet, VAULT_ID, { status: 'accepted' } as never))).toBe('INVALID_INPUT/MALFORMED');
    const record = { approvalKey: owners[2].approvalKey, method: 'qr' as const, verificationDigest: AGREED.digest, at: 1_800_000_100 };
    const done = await store.accept(wallet, VAULT_ID, { verifications: [record] });
    expect(done).toMatchObject({ status: 'accepted', acceptedAt: done.updatedAt, verifications: [record] });
    expect(done.updatedAt).toBeGreaterThan(added.updatedAt);
    expect(await refusal(store.accept(wallet, VAULT_ID))).toBe('NOT_A_CANDIDATE');
    expect(await refusal(store.accept(wallet, 'ab'.repeat(32)))).toBe('NOT_FOUND');
  });

  it('refuses to accept before completion, and accepts the created vault once it is ready', async () => {
    const wallet = walletId();
    await store.addCandidate(wallet, candidate({ origin: 'created', lifecycle: 'deploying', lastCheck: null }));
    expect(await refusal(store.accept(wallet, VAULT_ID))).toBe('INVALID_INPUT/VAULT_INCOMPLETE');
    await store.update(wallet, VAULT_ID, {
      lifecycle: 'incomplete',
      lastCheck: lastCheck({ operations: 'incomplete', committee: 'interim' }),
      deployment: { deployTxHash: digestOf('deploy'), deferred: TEST.deferred },
    });
    expect(await refusal(store.accept(wallet, VAULT_ID))).toBe('INVALID_INPUT/VAULT_INCOMPLETE');
    await store.update(wallet, VAULT_ID, {
      lifecycle: 'ready',
      lastCheck: lastCheck(),
      deployment: { deployTxHash: digestOf('deploy'), completionTxHash: digestOf('completion'), deferred: TEST.deferred },
    });
    expect((await store.accept(wallet, VAULT_ID)).status).toBe('accepted');
    expect(await refusal(store.update(wallet, VAULT_ID, { lifecycle: 'deploying' }))).toBe('INVALID_INPUT/LIFECYCLE_MISMATCH');
  });

  it('refuses to accept a candidate whose latest read failed an import check', async () => {
    const wallet = walletId();
    await store.addCandidate(wallet, candidate());
    await store.update(wallet, VAULT_ID, { lastCheck: lastCheck({ operations: 'unknown-build' }) });
    expect(await refusal(store.accept(wallet, VAULT_ID))).toBe('INVALID_INPUT/IMPORT_CHECK_FAILED');
    expect((await store.get(wallet, VAULT_ID))!.status).toBe('candidate');
  });
});

describe('Midnight vault store: requests', () => {
  it('holds no requests for a candidate, which is never signed for', async () => {
    const wallet = walletId();
    await store.addCandidate(wallet, candidate());
    expect(await refusal(store.putRequest(wallet, VAULT_ID, stored()))).toBe('INVALID_INPUT/NOT_ACCEPTED');
  });

  it('keeps requests and their approvals across a reload, and replaces one by digest', async () => {
    const wallet = walletId();
    await accepted(wallet);
    vi.spyOn(Date, 'now').mockReturnValue(1_900_000_000_000);
    const first = await store.putRequest(wallet, VAULT_ID, stored());
    expect(first.requests).toEqual([{ ...stored(), updatedAt: 1_900_000_000_000 }]);
    clearDbCache(wallet);
    expect((await store.get(wallet, VAULT_ID))!.requests).toEqual(first.requests);
    const second = await store.putRequest(wallet, VAULT_ID, stored({ approvals: [approval(), approval(owners[1].approvalKey)], state: 'submitted', txHash: digestOf('tx') }));
    expect(second.requests).toHaveLength(1);
    expect(second.requests[0]).toMatchObject({ state: 'submitted', txHash: digestOf('tx') });
    expect(second.requests[0].approvals.map(a => (a as MidnightOwnerApprovalFile).approvalKey)).toEqual([owners[0].approvalKey, owners[1].approvalKey]);
  });

  it('refuses a request or approval of another vault, and malformed ones', async () => {
    const wallet = walletId();
    await accepted(wallet);
    for (const bad of [
      stored({ request: requestFile({ contract: OTHER_ADDRESS }) }),
      stored({ request: requestFile({ network: 'mainnet' }) }),
      stored({ request: requestFile({ build: PRODUCTION.buildId }) }),
      stored({ approvals: [approval(owners[0].approvalKey, { digest: digestOf('another statement') })] }),
      stored({ approvals: [approval(owners[0].approvalKey, { contract: OTHER_ADDRESS })] }),
    ]) {
      expect(await refusal(store.putRequest(wallet, VAULT_ID, bad))).toBe('INVALID_INPUT/REQUEST_MISMATCH');
    }
    for (const bad of [
      stored({ request: requestFile({ type: 'gero-vault/v1|unsigned-tx' }) }),
      stored({ request: requestFile({ kind: 'sweep' }) }),
      stored({ request: requestFile({ digest: 'xyz' }) }),
      stored({ request: requestFile({ body: { recipient: 'mn_addr_preprod1example', amount: '1', pad: 'x'.repeat(64 * 1024) } }) }),
      stored({ approvals: [approval(), approval()] }),
      stored({ approvals: [approval(owners[0].approvalKey, { signature: { announcement: 'x'.repeat(5000), response: '' } })] }),
      stored({ approvals: Array.from({ length: 11 }, (_, i) => approval(jubjubKey(BigInt(5000 + i)))) }),
      stored({ state: 'lost' as never }),
    ]) {
      expect(await refusal(store.putRequest(wallet, VAULT_ID, bad))).toBe('INVALID_INPUT/MALFORMED');
    }
    expect((await store.get(wallet, VAULT_ID))!.requests).toEqual([]);
  });

  it('keeps at most 32 requests, making room by dropping the oldest settled one', async () => {
    const wallet = walletId();
    await accepted(wallet);
    const numbered = (i: number, state: MidnightStoredRequest['state'] = 'open') => {
      const digest = digestOf(`statement ${i}`);
      return stored({ request: requestFile({ digest }), approvals: [approval(owners[0].approvalKey, { digest })], state });
    };
    for (let i = 0; i < 32; i++) await store.putRequest(wallet, VAULT_ID, numbered(i));
    expect(await refusal(store.putRequest(wallet, VAULT_ID, numbered(32)))).toBe('INVALID_INPUT/TOO_MANY_REQUESTS');
    await store.putRequest(wallet, VAULT_ID, numbered(5, 'landed'));
    await store.putRequest(wallet, VAULT_ID, numbered(9, 'expired'));
    const record = await store.putRequest(wallet, VAULT_ID, numbered(32));
    const digests = record.requests.map(r => r.request.digest);
    expect(digests).toHaveLength(32);
    expect(digests).not.toContain(digestOf('statement 5'));
    expect(digests).toContain(digestOf('statement 9'));
    expect(digests).toContain(digestOf('statement 32'));
  });
});

describe('Midnight vault store: the index counter', () => {
  it('allocates each index of a network once, from 1, and keeps networks apart', async () => {
    const wallet = walletId();
    expect(await store.highestIndex(wallet, 'preprod')).toBe(0);
    expect(await store.allocateIndex(wallet, 'preprod')).toBe(1);
    expect(await store.allocateIndex(wallet, 'preprod')).toBe(2);
    expect(await store.allocateIndex(wallet, 'mainnet')).toBe(1);
    clearDbCache(wallet);
    expect(await store.highestIndex(wallet, 'preprod')).toBe(2);
    expect(await store.allocateIndex(wallet, 'preprod')).toBe(3);
  });

  it('counts this seed\'s indexes in stored vaults as taken', async () => {
    const wallet = walletId();
    await store.addCandidate(wallet, candidate({ self: [{ role: 'owner', index: 5 }] }));
    expect(await store.highestIndex(wallet, 'preprod')).toBe(5);
    expect(await store.allocateIndex(wallet, 'preprod')).toBe(6);
    await store.update(wallet, VAULT_ID, { self: [{ role: 'owner', index: 9 }] });
    expect(await store.allocateIndex(wallet, 'preprod')).toBe(10);
    expect(await store.highestIndex(wallet, 'mainnet')).toBe(0);
    // A role this seed no longer holds keeps its index taken.
    const other = midnightVaultId('preprod', OTHER_ADDRESS);
    await store.addCandidate(wallet, candidate({
      contractAddress: OTHER_ADDRESS,
      participants: participants({ delegates: [{ key: delegateKeys[0], cap: '1', period: 600 }, null] }),
      self: [{ role: 'owner', index: 1 }, { role: 'delegate', index: 20 }],
    }));
    await store.update(wallet, other, { participants: participants(), self: [{ role: 'owner', index: 1 }] });
    expect(await store.allocateIndex(wallet, 'preprod')).toBe(21);
  });

  it('raises the counter to a restored package\'s index, never lowers it, and stops at the last index', async () => {
    const wallet = walletId();
    await store.raiseIndex(wallet, 'preprod', 12);
    await store.raiseIndex(wallet, 'preprod', 4);
    expect(await store.highestIndex(wallet, 'preprod')).toBe(12);
    await store.raiseIndex(wallet, 'preprod', 2 ** 31 - 1);
    expect(await refusal(store.allocateIndex(wallet, 'preprod'))).toBe('INDEX_EXHAUSTED');
    for (const call of [store.raiseIndex(wallet, 'preprod', -1), store.raiseIndex(wallet, 'preprod', 2 ** 31), store.allocateIndex(wallet, 'testnet' as never)]) {
      expect(await refusal(call)).toBe('INVALID_INPUT/MALFORMED');
    }
  });
});

describe('Midnight vault store: updates', () => {
  it('changes only the fields of the patch type, checking the whole record', async () => {
    const wallet = walletId();
    const vault = await accepted(wallet);
    const renamed = await store.update(wallet, VAULT_ID, { name: null });
    expect(renamed.name).toBeUndefined();
    for (const patch of [
      { vaultId: 'ab'.repeat(32) }, { network: 'mainnet' }, { contractAddress: OTHER_ADDRESS }, { build: PRODUCTION.buildId },
      { status: 'candidate' }, { origin: 'created' }, { createdAt: 0 }, { requests: [] }, { acceptedAt: 1 },
    ]) {
      expect(await refusal(store.update(wallet, VAULT_ID, patch as never))).toBe('INVALID_INPUT/MALFORMED');
    }
    // An owner change on chain: the new owners replace the old, this seed among them.
    const changed = participants({ owners: [owners[0], owners[2], null, null, null] });
    // The removed owner's verification record goes with it.
    expect(await refusal(store.update(wallet, VAULT_ID, { participants: changed }))).toBe('INVALID_INPUT/MALFORMED');
    expect((await store.update(wallet, VAULT_ID, { participants: changed, verifications: [] })).participants.owners).toEqual(changed.owners);
    expect(await refusal(store.update(wallet, VAULT_ID, { participants: participants({ owners: [owners[0], owners[0], null, null, null] }) }))).toBe('INVALID_INPUT/INVALID_KEY');
    expect(await refusal(store.update(wallet, VAULT_ID, { self: [{ role: 'delegate', index: 4 }] }))).toBe('INVALID_INPUT/SELF_MISMATCH');
    expect(await refusal(store.update(wallet, VAULT_ID, { lastCheck: lastCheck({ operations: 'incomplete' }) }))).toBe('INVALID_INPUT/LIFECYCLE_MISMATCH');
    expect((await store.get(wallet, VAULT_ID))!.participants.owners).toEqual(changed.owners);
    expect(vault.vaultId).toBe(VAULT_ID);
    expect(await refusal(store.update(wallet, midnightVaultId('preprod', OTHER_ADDRESS), { name: 'Nope' }))).toBe('NOT_FOUND');
  });
});

describe('Midnight vault store: unavailable database', () => {
  it('throws when the wallet database cannot be opened, never answering "no vaults"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Dexie.prototype, 'open').mockRejectedValue(new Error('injected open failure'));
    const wallet = walletId();
    expect(await refusal(store.list(wallet))).toBe('STORE_UNAVAILABLE');
    expect(await refusal(store.get(wallet, VAULT_ID))).toBe('STORE_UNAVAILABLE');
    expect(await refusal(store.addCandidate(wallet, candidate()))).toBe('STORE_UNAVAILABLE');
    expect(await refusal(store.highestIndex(wallet, 'preprod'))).toBe('STORE_UNAVAILABLE');
    expect(await refusal(store.allocateIndex(wallet, 'preprod'))).toBe('STORE_UNAVAILABLE');
  });

  it('throws when the database opener fails or has no Midnight tables', async () => {
    const throwing = createMidnightVaultStore({ openDatabase: async () => { throw new Error('injected'); } });
    expect(await refusal(throwing.list(walletId()))).toBe('STORE_UNAVAILABLE');
    // A connection still on version 12, before the Midnight tables existed.
    const wallet = walletId();
    const { midnightVaults: _vaults, midnightVaultIndexes: _indexes, ...version12 } = walletDBSchema;
    const old = new Dexie(`wallet-${wallet}`);
    extraDatabases.push(old);
    old.version(12).stores(version12);
    await old.open();
    const stale = createMidnightVaultStore({ openDatabase: async () => old });
    expect(await refusal(stale.list(wallet))).toBe('STORE_UNAVAILABLE');
    expect(await refusal(stale.get(wallet, VAULT_ID))).toBe('STORE_UNAVAILABLE');
    expect(await refusal(stale.highestIndex(wallet, 'preprod'))).toBe('STORE_UNAVAILABLE');
  });

  it('throws on a row of a format this version cannot read, rather than leaving it out', async () => {
    const wallet = walletId();
    const vault = await store.addCandidate(wallet, candidate());
    const db = (await getDb(wallet))!;
    const otherId = midnightVaultId('preprod', OTHER_ADDRESS);
    await db.table('midnightVaults').put({ ...vault, vaultId: otherId, recordVersion: 2 });
    expect(await refusal(store.list(wallet))).toBe('STORE_UNAVAILABLE');
    expect(await refusal(store.get(wallet, otherId))).toBe('STORE_UNAVAILABLE');
    expect(await refusal(store.highestIndex(wallet, 'preprod'))).toBe('STORE_UNAVAILABLE');
  });

  it('serves both pinned builds from the default store', async () => {
    const wallet = walletId();
    expect(await midnightVaultStore.list(wallet)).toEqual([]);
    expect((await midnightVaultStore.addCandidate(wallet, production('mainnet'))).build).toBe(PRODUCTION.buildId);
  });
});

describe('Midnight vault store: the version 13 upgrade', () => {
  it('upgrades a version 12 wallet without touching anything it held', async () => {
    const wallet = walletId();
    const { midnightVaults: _vaults, midnightVaultIndexes: _indexes, ...version12 } = walletDBSchema;
    const legacy = new Dexie(`wallet-${wallet}`);
    legacy.version(12).stores(version12);
    await legacy.open();
    const cardanoVault = { vaultId: 'cd'.repeat(32), recordVersion: 1, kind: 'native', status: 'accepted', network: 'preprod', createdAt: 1, updatedAt: 2 };
    await legacy.table('vaults').put(cardanoVault);
    await legacy.table('config').put({ key: 'currency', value: 'EUR' });
    await legacy.table('transactions').put({ id: 'saved-transaction', cbor: '00' });
    const schemaOf = (db: Dexie) => Object.fromEntries(db.tables.map(t => [t.name, { primKey: t.schema.primKey.src, indexes: t.schema.indexes.map(i => i.src).sort() }]));
    const before = schemaOf(legacy);
    legacy.close();

    const db = (await getDb(wallet))!;
    expect(db.verno).toBe(13);
    const { midnightVaults, midnightVaultIndexes, ...unchanged } = schemaOf(db);
    expect(unchanged).toEqual(before);
    expect(midnightVaults).toEqual({ primKey: 'vaultId', indexes: ['contractAddress', 'network', 'status', 'updatedAt'] });
    expect(midnightVaultIndexes).toEqual({ primKey: 'network', indexes: [] });
    expect(await db.table('vaults').toArray()).toEqual([cardanoVault]);
    expect(await db.table('config').toArray()).toEqual([{ key: 'currency', value: 'EUR' }]);
    expect(await db.table('transactions').count()).toBe(1);
    // A wallet that never used a Midnight vault reads an empty list, and its Cardano vaults as before.
    expect(await store.list(wallet)).toEqual([]);
    expect(await store.highestIndex(wallet, 'preprod')).toBe(0);
    expect(await vaultStore.list(wallet)).toEqual([cardanoVault]);
    // A Midnight vault and its index land in their own tables only.
    await store.addCandidate(wallet, candidate());
    expect(await db.table('vaults').toArray()).toEqual([cardanoVault]);
    expect(await db.table('config').toArray()).toEqual([{ key: 'currency', value: 'EUR' }]);
    expect(await vaultStore.list(wallet)).toEqual([cardanoVault]);
  });
});
