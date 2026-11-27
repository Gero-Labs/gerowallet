import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { jubjub } from '@noble/curves/jubjub';
import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { walletDBSchema } from './schema';
import { clearDbCache, getDb } from './wallet-db';
import { vaultStore } from './vaultStore';
import {
  MidnightVaultStoreError,
  createMidnightVaultStore,
  midnightVaultId,
  midnightVaultStore,
  type MidnightVaultCandidateInput,
  type MidnightVaultKey,
  type MidnightVaultLastCheckInput,
  type MidnightVaultRequestInput,
  type PinnedMidnightBuild,
} from './midnightVaultStore';

// -------------------------------------------------------------------------------------------------
// Fixtures

const CIRCUITS = [
  'applyGuardians', 'applyOwners', 'applyPolicy', 'applyRecovery', 'cancelGuardians', 'cancelOwners',
  'cancelPolicy', 'cancelRecovery', 'clearExpiredRecovery', 'delegatePayout', 'deposit', 'execute',
  'narrowPolicy', 'proposeGuardians', 'proposeOwners', 'proposePolicy', 'proposeRecovery', 'withdrawRecovery',
];
const DEFERRED = ['deposit', 'withdrawRecovery', 'clearExpiredRecovery', 'applyRecovery', 'proposeGuardians', 'cancelGuardians', 'applyGuardians'];

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const digestOf = (text: string) => hex(sha256(new TextEncoder().encode(text)));

function pinnedBuild(profile: 'test' | 'production', networks: PinnedMidnightBuild['networks']): PinnedMidnightBuild {
  const test = profile === 'test';
  return {
    id: test ? 'gvmn-test-45d16eda70751d57' : 'gvmn-production-c4585eee75a8b850',
    profile,
    networks,
    manifestHash: digestOf(`${profile} manifest`),
    constants: {
      ownerSlots: 5,
      guardianSlots: 5,
      delegateSlots: 2,
      whitelistEntries: 8,
      minRecoveryDelaySeconds: test ? 60 : 604800,
      expiryWindowSeconds: test ? 600 : 2592000,
      cooldownSeconds: test ? 120 : 172800,
    },
    circuits: Object.fromEntries(CIRCUITS.map(name => [name, { fingerprint: digestOf(`${profile} ${name}`), deferred: DEFERRED.includes(name) }])),
  };
}

const TEST_BUILD = pinnedBuild('test', ['preprod']);
const PRODUCTION_BUILD = pinnedBuild('production', ['preprod', 'mainnet']);

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

function upgradeKey(seed: number): string {
  return hex(schnorr.getPublicKey(new Uint8Array(32).fill(seed)));
}

/** The full key check integration passes in: on the curve, prime order, and an x-only key that lifts. */
function fullKeyProblem(key: MidnightVaultKey): string | null {
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
/** (0, -1): on the curve, of order 2. Encoded well, refused only by the full key check. */
const ORDER_TWO = le32(0n) + le32(P - 1n);

const owners = [1, 2, 3].map(i => ({ approvalKey: jubjubKey(BigInt(1000 + i)), upgradeKey: upgradeKey(i) }));
const guardianKeys = [1, 2, 3].map(i => jubjubKey(BigInt(2000 + i)));
const salts = [1, 2, 3].map(i => digestOf(`salt ${i}`));
const delegateKeys = [1, 2].map(i => jubjubKey(BigInt(3000 + i)));
const ADDRESS = digestOf('contract address');
const OTHER_ADDRESS = digestOf('another contract');
const AGREED_DIGEST = digestOf('verification set');

function operations(build: PinnedMidnightBuild, omit: readonly string[] = []): Record<string, string> {
  return Object.fromEntries(CIRCUITS.filter(c => !omit.includes(c)).map(c => [c, build.circuits[c].fingerprint]));
}

function lastCheck(overrides: Partial<MidnightVaultLastCheckInput> = {}, build = TEST_BUILD): MidnightVaultLastCheckInput {
  return {
    source: 'indexer',
    blockHeight: 120345,
    blockHash: digestOf('block'),
    at: 1_800_000_000_000,
    operations: operations(build),
    committee: { keys: owners.map(o => o.upgradeKey), threshold: 2 },
    ownerThreshold: 2,
    ...overrides,
  };
}

function agreedConfig(build = TEST_BUILD) {
  const test = build.profile === 'test';
  return {
    digest: AGREED_DIGEST,
    buildHash: build.manifestHash,
    owners: owners.map(o => ({ ...o })),
    threshold: 2,
    changeDelay: 60,
    whitelist: { enabled: false, entries: [] },
    guardians: [1, 2, 3].map(i => digestOf(`commitment ${i}`)),
    guardianThreshold: 2,
    recoveryDelay: test ? 60 : 604800,
    cooldown: test ? 120 : 172800,
    expiryWindow: test ? 600 : 2592000,
  };
}

/** A 2 of 3 test-build vault on preprod with three guardians, imported by owner 1 (slot 0, index 1). */
function candidate(overrides: Partial<MidnightVaultCandidateInput> = {}): MidnightVaultCandidateInput {
  const network = overrides.network ?? 'preprod';
  const contractAddress = overrides.contractAddress ?? ADDRESS;
  return {
    vaultId: overrides.vaultId ?? midnightVaultId(network, contractAddress),
    network,
    contractAddress,
    build: { id: TEST_BUILD.id, profile: 'test' },
    origin: 'imported',
    lifecycle: 'ready',
    name: 'Team vault',
    participants: {
      // Out of slot order on purpose: the store keeps slot order.
      owners: [owners[2], owners[0], owners[1]].map(o => ({ slot: owners.indexOf(o), ...o, label: `Owner ${owners.indexOf(o) + 1}` })),
      guardians: guardianKeys.map((key, slot) => ({ slot, key, salt: salts[slot] })),
      delegates: [],
    },
    self: [{ role: 'owner', index: 1, slot: 0 }],
    highestIndex: 3,
    agreedConfig: agreedConfig(),
    verifications: [{ method: 'number', owner: owners[1].approvalKey, digest: AGREED_DIGEST, at: 1_800_000_000 }],
    lastCheck: lastCheck(),
    ...overrides,
  };
}

function request(overrides: Partial<MidnightVaultRequestInput> = {}): MidnightVaultRequestInput {
  return {
    id: digestOf('payout statement'),
    kind: 'payout:v4',
    origin: 'made',
    file: '{"type":"gero-vault/v1|midnight-request"}',
    expiresAt: 1_800_172_800,
    approvals: [{ signer: owners[0].approvalKey, file: '{"type":"gero-vault/v1|midnight-approval","n":1}' }],
    ...overrides,
  };
}

const store = createMidnightVaultStore({ builds: [TEST_BUILD, PRODUCTION_BUILD], keyProblem: fullKeyProblem });

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

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(MidnightVaultStoreError);
  return (error as MidnightVaultStoreError).code;
}

/** Adds the default candidate as accepted. */
async function accepted(wallet: number, overrides: Partial<MidnightVaultCandidateInput> = {}) {
  const added = await store.addCandidate(wallet, candidate(overrides));
  return store.accept(wallet, added.vaultId, { reviewedUpdatedAt: added.updatedAt });
}

// -------------------------------------------------------------------------------------------------

describe('Midnight vault store: records', () => {
  it('adds a candidate that reads back in slot order, with the check results it computed', async () => {
    const wallet = walletId();
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const added = await store.addCandidate(wallet, candidate());
    expect(added).toMatchObject({
      recordVersion: 1,
      vaultId: midnightVaultId('preprod', ADDRESS),
      network: 'preprod',
      contractAddress: ADDRESS,
      build: { id: TEST_BUILD.id, profile: 'test' },
      status: 'candidate',
      origin: 'imported',
      lifecycle: 'ready',
      name: 'Team vault',
      self: [{ role: 'owner', index: 1, slot: 0 }],
      highestIndex: 3,
      deployment: null,
      requests: [],
      successor: null,
      createdAt: 1_800_000_000_000,
      updatedAt: 1_800_000_000_000,
      acceptedAt: null,
    });
    expect(added.participants.owners.map(o => [o.slot, o.approvalKey, o.label])).toEqual(
      owners.map((o, i) => [i, o.approvalKey, `Owner ${i + 1}`]),
    );
    expect(added.lastCheck!.results).toEqual({ operations: 'complete', committee: 'owners' });
    clearDbCache(wallet);
    expect(await store.get(wallet, added.vaultId)).toEqual(added);
    expect(await store.list(wallet)).toEqual([added]);
  });

  it('keeps each wallet\'s vaults apart and filters by status, network and role', async () => {
    const [mine, theirs] = [walletId(), walletId()];
    const first = await store.addCandidate(mine, candidate());
    const second = await accepted(mine, {
      contractAddress: OTHER_ADDRESS,
      participants: { ...candidate().participants, guardians: [], delegates: [{ slot: 1, key: delegateKeys[0] }] },
      self: [{ role: 'owner', index: 4, slot: 0 }, { role: 'delegate', index: 5, slot: 1 }],
      highestIndex: 5,
    });
    expect(await store.list(theirs)).toEqual([]);
    expect(await store.get(theirs, first.vaultId)).toBeUndefined();
    expect((await store.list(mine, { status: 'accepted' })).map(v => v.vaultId)).toEqual([second.vaultId]);
    expect((await store.list(mine, { role: 'delegate' })).map(v => v.vaultId)).toEqual([second.vaultId]);
    expect(await store.list(mine, { role: 'guardian' })).toEqual([]);
    expect(await store.list(mine, { network: 'mainnet' })).toEqual([]);
  });

  it('refuses a vault id that the network and contract address do not give', async () => {
    const wallet = walletId();
    expect(await refusal(store.addCandidate(wallet, candidate({ vaultId: midnightVaultId('mainnet', ADDRESS) })))).toBe('VAULT_ID_MISMATCH');
    expect(await refusal(store.addCandidate(wallet, candidate({ vaultId: midnightVaultId('preprod', OTHER_ADDRESS) })))).toBe('VAULT_ID_MISMATCH');
    expect(await refusal(store.addCandidate(wallet, candidate({ vaultId: midnightVaultId('preprod', ADDRESS), contractAddress: 'AB'.repeat(32) })))).toBe('INVALID_INPUT');
    expect(await store.list(wallet)).toEqual([]);
  });

  it('pins the vault id: BLAKE2b-256 over the tag, the network id and the address', () => {
    expect(midnightVaultId('preprod', '00'.repeat(32))).toMatch(/^[0-9a-f]{64}$/);
    expect(midnightVaultId('preprod', ADDRESS)).not.toBe(midnightVaultId('preview', ADDRESS));
    expect(() => midnightVaultId('testnet' as never, ADDRESS)).toThrow(MidnightVaultStoreError);
  });

  it('refuses the same vault twice', async () => {
    const wallet = walletId();
    await store.addCandidate(wallet, candidate());
    expect(await refusal(store.addCandidate(wallet, candidate({ name: 'Again' })))).toBe('VAULT_EXISTS');
    expect((await store.get(wallet, midnightVaultId('preprod', ADDRESS)))!.name).toBe('Team vault');
  });
});

describe('Midnight vault store: builds', () => {
  it('refuses a build that is not pinned, or pinned under another profile', async () => {
    const wallet = walletId();
    expect(await refusal(store.addCandidate(wallet, candidate({ build: { id: 'gvmn-test-0000000000000000', profile: 'test' } })))).toBe('UNKNOWN_BUILD');
    expect(await refusal(store.addCandidate(wallet, candidate({ build: { id: TEST_BUILD.id, profile: 'production' } })))).toBe('UNKNOWN_BUILD');
  });

  it('refuses a test build on any network other than preprod, even where a pin lists it', async () => {
    const wallet = walletId();
    for (const network of ['mainnet', 'preview'] as const) {
      expect(await refusal(store.addCandidate(wallet, candidate({ network })))).toBe('TEST_BUILD_NETWORK');
    }
    const loose = createMidnightVaultStore({ builds: [pinnedBuild('test', ['preprod', 'preview', 'mainnet'])] });
    for (const network of ['mainnet', 'preview'] as const) {
      expect(await refusal(loose.addCandidate(wallet, candidate({ network })))).toBe('TEST_BUILD_NETWORK');
    }
    expect(await store.list(wallet)).toEqual([]);
  });

  it('takes the production build on the networks its pin lists, and only those', async () => {
    const wallet = walletId();
    const production = (network: 'preprod' | 'mainnet' | 'preview') => candidate({
      network,
      build: { id: PRODUCTION_BUILD.id, profile: 'production' },
      agreedConfig: agreedConfig(PRODUCTION_BUILD),
      lastCheck: lastCheck({}, PRODUCTION_BUILD),
    });
    expect((await store.addCandidate(wallet, production('mainnet'))).network).toBe('mainnet');
    expect((await store.addCandidate(wallet, production('preprod'))).build.profile).toBe('production');
    expect(await refusal(store.addCandidate(wallet, production('preview')))).toBe('BUILD_NETWORK');
  });

  it('refuses an operation set whose fingerprints are not the build\'s', async () => {
    const wallet = walletId();
    const altered = { ...operations(TEST_BUILD), execute: digestOf('another execute') };
    const extra = { ...operations(TEST_BUILD), sweep: digestOf('sweep') };
    const cases: Record<string, string>[] = [
      altered,
      extra,
      operations(TEST_BUILD, ['execute']),
      // The production build's keys under the test build's id.
      operations(PRODUCTION_BUILD),
    ];
    for (const ops of cases) {
      expect(await refusal(store.addCandidate(wallet, candidate({ lastCheck: lastCheck({ operations: ops }) })))).toBe('BUILD_MISMATCH');
    }
    expect(await store.list(wallet)).toEqual([]);
  });

  it('refuses an agreed configuration that is not of the build', async () => {
    const wallet = walletId();
    const base = agreedConfig();
    const cases = [
      { ...base, buildHash: PRODUCTION_BUILD.manifestHash },
      { ...base, recoveryDelay: 59 },
      { ...base, expiryWindow: 601 },
      { ...base, cooldown: 0 },
      { ...base, guardians: [...base.guardians, digestOf('4'), digestOf('5'), digestOf('6')], guardianThreshold: 4 },
      { ...base, whitelist: { enabled: true, entries: Array.from({ length: 9 }, (_, i) => ({ recipient: digestOf(`r${i}`), scope: 'any' as const })) } },
    ];
    for (const agreed of cases) {
      expect(await refusal(store.addCandidate(wallet, candidate({ agreedConfig: agreed })))).toBe('BUILD_MISMATCH');
    }
    // The contract's own rules: a strict guardian majority, an owner threshold within the owners.
    for (const agreed of [{ ...base, guardianThreshold: 1 }, { ...base, threshold: 4 }]) {
      expect(await refusal(store.addCandidate(wallet, candidate({ agreedConfig: agreed })))).toBe('INVALID_INPUT');
    }
    expect((await store.addCandidate(wallet, candidate({ agreedConfig: { ...base, recoveryDelay: 3600 } }))).agreedConfig!.recoveryDelay).toBe(3600);
  });

  it('refuses a deployment that defers anything but the build\'s deferred set', async () => {
    const wallet = walletId();
    const deployment = { deployTx: digestOf('deploy'), completionTx: null, deferred: ['deposit'] };
    expect(await refusal(store.addCandidate(wallet, candidate({ deployment })))).toBe('BUILD_MISMATCH');
    const split = { deployTx: digestOf('deploy'), completionTx: digestOf('completion'), deferred: [...DEFERRED].reverse() };
    expect((await store.addCandidate(wallet, candidate({ deployment: split }))).deployment!.deferred).toEqual([...DEFERRED].sort());
  });
});

describe('Midnight vault store: committee and lifecycle', () => {
  it('refuses a committee with a threshold below 1, no keys, or malformed keys', async () => {
    const wallet = walletId();
    const keys = owners.map(o => o.upgradeKey);
    for (const committee of [
      { keys, threshold: 0 },
      { keys: [], threshold: 1 },
      { keys: [keys[0], keys[0]], threshold: 1 },
      { keys: ['zz'.repeat(32)], threshold: 1 },
    ]) {
      expect(await refusal(store.addCandidate(wallet, candidate({ lastCheck: lastCheck({ committee }) })))).toBe('COMMITTEE_MISMATCH');
    }
  });

  it('keeps an incomplete deployment, and refuses to call it ready', async () => {
    const wallet = walletId();
    const interim = lastCheck({ operations: operations(TEST_BUILD, DEFERRED), committee: { keys: [owners[0].upgradeKey], threshold: 1 } });
    expect(await refusal(store.addCandidate(wallet, candidate({ lastCheck: interim })))).toBe('LIFECYCLE_MISMATCH');
    // Every operation in, but still the deployer's interim committee.
    const notHandedOver = lastCheck({ committee: { keys: [owners[0].upgradeKey], threshold: 1 } });
    expect(await refusal(store.addCandidate(wallet, candidate({ lastCheck: notHandedOver })))).toBe('LIFECYCLE_MISMATCH');
    const stored = await store.addCandidate(wallet, candidate({ lifecycle: 'incomplete', lastCheck: interim }));
    expect(stored.lastCheck!.results).toEqual({ operations: 'deferredMissing', committee: 'interim' });
    // A complete vault under its final committee is not incomplete.
    expect(await refusal(store.addCandidate(walletId(), candidate({ lifecycle: 'incomplete' })))).toBe('LIFECYCLE_MISMATCH');
  });

  it('flags a committee out of step with the owners from the data, whatever the caller says', async () => {
    const wallet = walletId();
    const drift = lastCheck({ committee: { keys: [owners[1].upgradeKey, owners[2].upgradeKey], threshold: 2 } });
    const claimed = { ...drift, results: { operations: 'complete', committee: 'owners' } } as MidnightVaultLastCheckInput;
    const stored = await store.addCandidate(wallet, candidate({ lastCheck: claimed }));
    expect(stored.lastCheck!.results).toEqual({ operations: 'complete', committee: 'outOfStep' });
    const wrongThreshold = await store.update(wallet, stored.vaultId, { lastCheck: lastCheck({ committee: { keys: owners.map(o => o.upgradeKey), threshold: 3 } }) });
    expect(wrongThreshold.lastCheck!.results.committee).toBe('outOfStep');
    const fixed = await store.update(wallet, stored.vaultId, { lastCheck: lastCheck() });
    expect(fixed.lastCheck!.results.committee).toBe('owners');
  });

  it('lets only a vault this device created be deploying, and nothing else go without a state read', async () => {
    const wallet = walletId();
    expect(await refusal(store.addCandidate(wallet, candidate({ lifecycle: 'deploying', lastCheck: null })))).toBe('LIFECYCLE_MISMATCH');
    expect(await refusal(store.addCandidate(wallet, candidate({ lastCheck: null })))).toBe('LIFECYCLE_MISMATCH');
    const deploying = await store.addCandidate(wallet, candidate({ origin: 'created', lifecycle: 'deploying', lastCheck: null, verifications: [] }));
    expect(deploying.lifecycle).toBe('deploying');
  });

  it('ties the successor to a recovered or moved vault, and keeps a moved vault moved', async () => {
    const wallet = walletId();
    const successor = midnightVaultId('preprod', OTHER_ADDRESS);
    expect(await refusal(store.addCandidate(wallet, candidate({ lifecycle: 'moved' })))).toBe('LIFECYCLE_MISMATCH');
    expect(await refusal(store.addCandidate(wallet, candidate({ successor })))).toBe('LIFECYCLE_MISMATCH');
    expect(await refusal(store.addCandidate(wallet, candidate({ lifecycle: 'temporary', successor: midnightVaultId('preprod', ADDRESS) })))).toBe('INVALID_INPUT');
    const vault = await accepted(wallet, { lifecycle: 'temporary' });
    const moved = await store.update(wallet, vault.vaultId, { lifecycle: 'moved', successor });
    expect(moved).toMatchObject({ lifecycle: 'moved', successor });
    expect(await refusal(store.update(wallet, vault.vaultId, { lifecycle: 'ready', successor: null }))).toBe('LIFECYCLE_MISMATCH');
    expect(await refusal(store.update(wallet, vault.vaultId, { lifecycle: 'deploying' }))).toBe('LIFECYCLE_MISMATCH');
    expect(await store.get(wallet, vault.vaultId)).toEqual(moved);
  });
});

describe('Midnight vault store: participants and self', () => {
  it('refuses a record without exactly one self entry per role it holds', async () => {
    const wallet = walletId();
    const base = candidate();
    const withDelegate = { ...base.participants, delegates: [{ slot: 0, key: delegateKeys[0] }] };
    const cases: Partial<MidnightVaultCandidateInput>[] = [
      { self: [] },
      { self: [{ role: 'owner', index: 1, slot: 0 }, { role: 'owner', index: 2, slot: 1 }] },
      { self: [{ role: 'owner', index: 1, slot: 4 }] },
      { self: [{ role: 'delegate', index: 1, slot: 0 }] },
      { self: [{ role: 'observer' as never, index: 1, slot: 0 }] },
      { participants: withDelegate, self: [{ role: 'delegate', index: 2, slot: 0 }, { role: 'delegate', index: 2, slot: 0 }] },
      // A guardian is never an owner of the same vault.
      { self: [{ role: 'owner', index: 1, slot: 0 }, { role: 'guardian', index: 2, slot: 0 }] },
    ];
    for (const overrides of cases) {
      expect(await refusal(store.addCandidate(wallet, candidate(overrides)))).toBe('SELF_MISMATCH');
    }
    expect(await store.list(wallet)).toEqual([]);
  });

  it('takes one entry for each of two roles, and a guardian that knows only its own card', async () => {
    const wallet = walletId();
    const both = await store.addCandidate(wallet, candidate({
      participants: { ...candidate().participants, delegates: [{ slot: 1, key: delegateKeys[0], label: 'Ops' }] },
      self: [{ role: 'delegate', index: 3, slot: 1 }, { role: 'owner', index: 1, slot: 0 }],
    }));
    expect(both.self.map(s => s.role)).toEqual(['owner', 'delegate']);
    const guardian = await store.addCandidate(wallet, candidate({
      contractAddress: OTHER_ADDRESS,
      participants: { owners: candidate().participants.owners, guardians: [{ slot: 2, key: guardianKeys[2] }], delegates: [] },
      self: [{ role: 'guardian', index: 2, slot: 2 }],
      highestIndex: 2,
      agreedConfig: null,
      verifications: [],
    }));
    expect(guardian.self).toEqual([{ role: 'guardian', index: 2, slot: 2 }]);
    expect((await store.list(wallet, { role: 'guardian' })).map(v => v.vaultId)).toEqual([guardian.vaultId]);
  });

  it('refuses an index outside 1 to 2^31 - 1, or a highest index below one of them', async () => {
    const wallet = walletId();
    for (const overrides of [
      { self: [{ role: 'owner' as const, index: 0, slot: 0 }] },
      { self: [{ role: 'owner' as const, index: 2 ** 31, slot: 0 }] },
      { self: [{ role: 'owner' as const, index: 4, slot: 0 }], highestIndex: 3 },
      { highestIndex: 0 },
    ]) {
      expect(await refusal(store.addCandidate(wallet, candidate(overrides)))).toBe('INVALID_INPUT');
    }
  });

  it('refuses keys that are malformed, the identity, outside the field, or twice in one vault', async () => {
    const wallet = walletId();
    const base = candidate().participants;
    const identity = le32(0n) + le32(1n);
    const outside = le32(P) + base.owners[0].approvalKey.slice(64);
    const ownerWith = (o: Partial<(typeof base.owners)[number]>) => ({ ...base, owners: [{ ...base.owners[0], ...o }, ...base.owners.slice(1)] });
    const cases = [
      ownerWith({ approvalKey: identity }),
      ownerWith({ approvalKey: outside }),
      ownerWith({ approvalKey: base.owners[0].approvalKey.slice(2) }),
      ownerWith({ approvalKey: base.owners[0].approvalKey.toUpperCase() }),
      ownerWith({ upgradeKey: '00'.repeat(32) }),
      ownerWith({ upgradeKey: 'ff'.repeat(32) }),
      ownerWith({ upgradeKey: base.owners[1].upgradeKey }),
      // The same Jubjub key as an owner and as a guardian.
      { ...base, guardians: [{ slot: 0, key: base.owners[1].approvalKey, salt: salts[0] }] },
      { ...base, delegates: [{ slot: 0, key: guardianKeys[0] }] },
    ];
    for (const participants of cases) {
      expect(await refusal(store.addCandidate(wallet, candidate({ participants })))).toBe('INVALID_KEY');
    }
  });

  it('runs the full key check it is given on every participant and agreed key', async () => {
    const wallet = walletId();
    const base = candidate().participants;
    const smallOrder = { ...base, guardians: [...base.guardians.slice(0, 2), { slot: 2, key: ORDER_TWO, salt: salts[2] }] };
    const noLift = { ...base, owners: [{ ...base.owners[0], upgradeKey: le32(0n).slice(0, 62) + '05' }, ...base.owners.slice(1)] };
    const agreed = { ...agreedConfig(), owners: [{ approvalKey: ORDER_TWO, upgradeKey: owners[0].upgradeKey }, ...agreedConfig().owners.slice(1)] };
    expect(await refusal(store.addCandidate(wallet, candidate({ participants: smallOrder })))).toBe('INVALID_KEY');
    expect(await refusal(store.addCandidate(wallet, candidate({ participants: noLift })))).toBe('INVALID_KEY');
    expect(await refusal(store.addCandidate(wallet, candidate({ agreedConfig: agreed })))).toBe('INVALID_KEY');
    // The encoding checks alone cannot see a small-order point: that is why the check is passed in.
    const shapeOnly = createMidnightVaultStore({ builds: [TEST_BUILD] });
    expect((await shapeOnly.addCandidate(wallet, candidate({ participants: smallOrder }))).participants.guardians[2].key).toBe(ORDER_TWO);
  });

  it('refuses slots the build does not have and an owner record missing a guardian\'s salt', async () => {
    const wallet = walletId();
    const base = candidate().participants;
    for (const participants of [
      { ...base, owners: [{ ...base.owners[0], slot: 5 }, ...base.owners.slice(1)] },
      { ...base, owners: [{ ...base.owners[0], slot: 1 }, ...base.owners.slice(1)] },
      { ...base, owners: [] },
      { ...base, delegates: [{ slot: 2, key: delegateKeys[0] }] },
      { ...base, guardians: [{ slot: 0, key: guardianKeys[0] }] },
      { ...base, guardians: [{ slot: 0, key: guardianKeys[0], salt: 'salt' }] },
    ]) {
      expect(await refusal(store.addCandidate(wallet, candidate({ participants })))).toBe('INVALID_INPUT');
    }
  });

  it('refuses verification records of another configuration, of a non-owner, or with no agreed configuration', async () => {
    const wallet = walletId();
    const record = { method: 'qr' as const, owner: owners[2].approvalKey, digest: AGREED_DIGEST, at: 1_800_000_000 };
    for (const overrides of [
      { verifications: [{ ...record, digest: digestOf('another set') }] },
      { verifications: [{ ...record, owner: guardianKeys[0] }] },
      { verifications: [{ ...record, method: 'voice' as never }] },
      { verifications: [record], agreedConfig: null },
    ]) {
      expect(await refusal(store.addCandidate(wallet, candidate(overrides)))).toBe('INVALID_INPUT');
    }
    expect((await store.addCandidate(wallet, candidate({ verifications: [record] }))).verifications).toEqual([record]);
  });
});

describe('Midnight vault store: candidate and accept', () => {
  it('accepts only on an explicit accept of the version the user reviewed', async () => {
    const wallet = walletId();
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const added = await store.addCandidate(wallet, candidate());
    expect(added.status).toBe('candidate');
    expect(await refusal(store.update(wallet, added.vaultId, { status: 'accepted' } as never))).toBe('INVALID_INPUT');
    expect(await refusal(store.accept(wallet, added.vaultId, {} as never))).toBe('INVALID_INPUT');
    // A state read lands while the review screen is open, in the same millisecond.
    const read = await store.update(wallet, added.vaultId, { lastCheck: lastCheck({ blockHeight: 120346 }) });
    expect(read.updatedAt).toBeGreaterThan(added.updatedAt);
    expect(await refusal(store.accept(wallet, added.vaultId, { reviewedUpdatedAt: added.updatedAt }))).toBe('STALE_REVIEW');
    const done = await store.accept(wallet, added.vaultId, { reviewedUpdatedAt: read.updatedAt });
    expect(done).toMatchObject({ status: 'accepted', acceptedAt: done.updatedAt });
    expect(await refusal(store.accept(wallet, added.vaultId, { reviewedUpdatedAt: done.updatedAt }))).toBe('NOT_A_CANDIDATE');
    expect(await refusal(store.accept(wallet, 'ab'.repeat(32), { reviewedUpdatedAt: 0 }))).toBe('NOT_FOUND');
  });

  it('refuses to accept before completion, and accepts the created vault once it is ready', async () => {
    const wallet = walletId();
    const deploying = await store.addCandidate(wallet, candidate({ origin: 'created', lifecycle: 'deploying', lastCheck: null, verifications: [] }));
    expect(await refusal(store.accept(wallet, deploying.vaultId, { reviewedUpdatedAt: deploying.updatedAt }))).toBe('VAULT_INCOMPLETE');
    const interim = lastCheck({ source: 'deployment', blockHeight: null, blockHash: null, operations: operations(TEST_BUILD, DEFERRED), committee: { keys: [owners[0].upgradeKey], threshold: 1 } });
    const incomplete = await store.update(wallet, deploying.vaultId, {
      lifecycle: 'incomplete',
      lastCheck: interim,
      deployment: { deployTx: digestOf('deploy'), completionTx: null, deferred: DEFERRED },
    });
    expect(await refusal(store.accept(wallet, deploying.vaultId, { reviewedUpdatedAt: incomplete.updatedAt }))).toBe('VAULT_INCOMPLETE');
    const ready = await store.update(wallet, deploying.vaultId, {
      lifecycle: 'ready',
      lastCheck: lastCheck(),
      deployment: { deployTx: digestOf('deploy'), completionTx: digestOf('completion'), deferred: DEFERRED },
    });
    expect((await store.accept(wallet, deploying.vaultId, { reviewedUpdatedAt: ready.updatedAt })).status).toBe('accepted');
  });
});

describe('Midnight vault store: requests', () => {
  it('holds no requests for a candidate, which is never signed for', async () => {
    const wallet = walletId();
    const added = await store.addCandidate(wallet, candidate());
    expect(await refusal(store.putRequest(wallet, added.vaultId, request()))).toBe('NOT_ACCEPTED');
  });

  it('keeps requests and their approvals across a reload', async () => {
    const wallet = walletId();
    const vault = await accepted(wallet);
    const stored = await store.putRequest(wallet, vault.vaultId, request());
    clearDbCache(wallet);
    const reread = await store.get(wallet, vault.vaultId);
    expect(reread!.requests).toEqual(stored.requests);
    expect(reread!.requests[0]).toMatchObject({ id: request().id, kind: 'payout:v4', approvals: request().approvals });
  });

  it('adds approvals to a stored request and never drops one', async () => {
    const wallet = walletId();
    const vault = await accepted(wallet);
    const first = await store.putRequest(wallet, vault.vaultId, request());
    // A stale copy without the first approval changes nothing.
    expect(await store.putRequest(wallet, vault.vaultId, request({ approvals: [] }))).toEqual(first);
    const second = { signer: owners[1].approvalKey, file: '{"n":2}' };
    const merged = await store.putRequest(wallet, vault.vaultId, request({ approvals: [second] }));
    expect(merged.requests[0].approvals.map(a => a.signer)).toEqual([owners[0].approvalKey, owners[1].approvalKey]);
    expect(merged.requests[0].createdAt).toBe(first.requests[0].createdAt);
    expect(await refusal(store.putRequest(wallet, vault.vaultId, request({ kind: 'cancel-recov:v2' })))).toBe('INVALID_INPUT');
  });

  it('bounds requests and approvals', async () => {
    const wallet = walletId();
    const vault = await accepted(wallet);
    const approval = request().approvals[0];
    for (const bad of [
      request({ id: 'xyz' }),
      request({ file: 'x'.repeat(32 * 1024 + 1) }),
      request({ approvals: [approval, approval] }),
      request({ approvals: [{ ...approval, file: 'x'.repeat(8 * 1024 + 1) }] }),
      request({ approvals: Array.from({ length: 11 }, (_, i) => ({ signer: jubjubKey(BigInt(5000 + i)), file: '{}' })) }),
      request({ origin: 'relayed' as never }),
    ]) {
      expect(await refusal(store.putRequest(wallet, vault.vaultId, bad))).toBe('INVALID_INPUT');
    }
    for (let i = 0; i < 32; i++) await store.putRequest(wallet, vault.vaultId, request({ id: digestOf(`statement ${i}`) }));
    expect(await refusal(store.putRequest(wallet, vault.vaultId, request({ id: digestOf('one more') })))).toBe('INVALID_INPUT');
  });

  it('removes a request, and leaves the record as it is for one that is not there', async () => {
    const wallet = walletId();
    const vault = await accepted(wallet);
    const stored = await store.putRequest(wallet, vault.vaultId, request());
    const removed = await store.removeRequest(wallet, vault.vaultId, request().id);
    expect(removed.requests).toEqual([]);
    expect(removed.updatedAt).toBeGreaterThan(stored.updatedAt);
    expect(await store.removeRequest(wallet, vault.vaultId, request().id)).toEqual(removed);
  });
});

describe('Midnight vault store: updates', () => {
  it('changes the name, labels and highest index, and never the identity, build, status or origin', async () => {
    const wallet = walletId();
    const vault = await store.addCandidate(wallet, candidate());
    const updated = await store.update(wallet, vault.vaultId, {
      name: null,
      labels: [{ role: 'owner', slot: 1, label: 'Bob' }, { role: 'owner', slot: 2, label: null }, { role: 'guardian', slot: 0, label: 'Carol' }],
      highestIndex: 7,
    });
    expect(updated.name).toBeUndefined();
    expect(updated.participants.owners.map(o => o.label)).toEqual(['Owner 1', 'Bob', undefined]);
    expect(updated.participants.guardians[0].label).toBe('Carol');
    expect(updated.highestIndex).toBe(7);
    for (const patch of [
      { vaultId: 'ab'.repeat(32) }, { network: 'mainnet' }, { contractAddress: OTHER_ADDRESS }, { build: { id: PRODUCTION_BUILD.id, profile: 'production' } },
      { status: 'accepted' }, { origin: 'created' }, { createdAt: 0 }, { requests: [] }, { acceptedAt: 1 },
    ]) {
      expect(await refusal(store.update(wallet, vault.vaultId, patch as never))).toBe('INVALID_INPUT');
    }
    expect(await refusal(store.update(wallet, vault.vaultId, { highestIndex: 6 }))).toBe('INVALID_INPUT');
    expect(await refusal(store.update(wallet, vault.vaultId, { labels: [{ role: 'delegate', slot: 0, label: 'Mallory' }] }))).toBe('INVALID_INPUT');
    expect(await refusal(store.update(wallet, vault.vaultId, { name: 'bad\u0000name' }))).toBe('INVALID_INPUT');
    expect(await store.get(wallet, vault.vaultId)).toEqual(updated);
    expect(await refusal(store.update(wallet, midnightVaultId('preprod', OTHER_ADDRESS), { name: 'Nope' }))).toBe('NOT_FOUND');
  });

  it('checks the whole record on every update and stores nothing it refuses', async () => {
    const wallet = walletId();
    const vault = await accepted(wallet);
    const base = vault.participants;
    // An owner change on chain moves this seed from slot 0 to slot 1: participants and self together.
    const swapped = { ...base, owners: [{ ...base.owners[1], slot: 0 }, { ...base.owners[0], slot: 1 }, base.owners[2]] };
    expect(await refusal(store.update(wallet, vault.vaultId, { participants: { ...base, owners: base.owners.slice(1).map((o, i) => ({ ...o, slot: i + 1 })) } }))).toBe('SELF_MISMATCH');
    const moved = await store.update(wallet, vault.vaultId, { participants: swapped, self: [{ role: 'owner', index: 1, slot: 1 }] });
    expect(moved.self).toEqual([{ role: 'owner', index: 1, slot: 1 }]);
    expect(await refusal(store.update(wallet, vault.vaultId, { lastCheck: lastCheck({ committee: { keys: [owners[0].upgradeKey], threshold: 0 } }) }))).toBe('COMMITTEE_MISMATCH');
    expect(await refusal(store.update(wallet, vault.vaultId, { lastCheck: lastCheck({ operations: operations(TEST_BUILD, ['deposit']) }) }))).toBe('LIFECYCLE_MISMATCH');
    expect(await store.get(wallet, vault.vaultId)).toEqual(moved);
  });
});

describe('Midnight vault store: unavailable database', () => {
  it('throws when the wallet database cannot be opened, never answering "no vaults"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Dexie.prototype, 'open').mockRejectedValue(new Error('injected open failure'));
    const wallet = walletId();
    expect(await refusal(store.list(wallet))).toBe('STORE_UNAVAILABLE');
    expect(await refusal(store.get(wallet, midnightVaultId('preprod', ADDRESS)))).toBe('STORE_UNAVAILABLE');
    expect(await refusal(store.addCandidate(wallet, candidate()))).toBe('STORE_UNAVAILABLE');
  });

  it('throws when the database opener fails or has no Midnight table', async () => {
    const throwing = createMidnightVaultStore({ builds: [TEST_BUILD], openDatabase: async () => { throw new Error('injected'); } });
    expect(await refusal(throwing.list(walletId()))).toBe('STORE_UNAVAILABLE');
    // A connection still on version 12, before the Midnight table existed.
    const wallet = walletId();
    const old = new Dexie(`wallet-${wallet}`);
    extraDatabases.push(old);
    const { midnightVaults: _omitted, ...version12 } = walletDBSchema;
    old.version(12).stores(version12);
    await old.open();
    const stale = createMidnightVaultStore({ builds: [TEST_BUILD], openDatabase: async () => old });
    expect(await refusal(stale.list(wallet))).toBe('STORE_UNAVAILABLE');
    expect(await refusal(stale.get(wallet, midnightVaultId('preprod', ADDRESS)))).toBe('STORE_UNAVAILABLE');
  });

  it('throws on a row of a format this version cannot read, rather than leaving it out', async () => {
    const wallet = walletId();
    const vault = await store.addCandidate(wallet, candidate());
    const db = (await getDb(wallet))!;
    await db.table('midnightVaults').put({ ...vault, vaultId: midnightVaultId('preprod', OTHER_ADDRESS), recordVersion: 2 });
    expect(await refusal(store.list(wallet))).toBe('STORE_UNAVAILABLE');
    expect(await refusal(store.get(wallet, midnightVaultId('preprod', OTHER_ADDRESS)))).toBe('STORE_UNAVAILABLE');
  });

  it('refuses every write while no build is pinned', async () => {
    const wallet = walletId();
    expect(await midnightVaultStore.list(wallet)).toEqual([]);
    expect(await refusal(midnightVaultStore.addCandidate(wallet, candidate()))).toBe('UNKNOWN_BUILD');
    expect(() => createMidnightVaultStore({ builds: [TEST_BUILD, TEST_BUILD] })).toThrow();
    expect(() => createMidnightVaultStore({ builds: [{ ...TEST_BUILD, manifestHash: 'nope' }] })).toThrow();
  });
});

describe('Midnight vault store: the version 13 upgrade', () => {
  it('upgrades a version 12 wallet without touching anything it held', async () => {
    const wallet = walletId();
    const { midnightVaults: _omitted, ...version12 } = walletDBSchema;
    const legacy = new Dexie(`wallet-${wallet}`);
    legacy.version(12).stores(version12);
    await legacy.open();
    const cardanoVault = { vaultId: 'cd'.repeat(32), recordVersion: 1, kind: 'native', status: 'accepted', network: 'preprod', createdAt: 1, updatedAt: 2 };
    await legacy.table('vaults').put(cardanoVault);
    await legacy.table('config').put({ key: 'currency', value: 'EUR' });
    await legacy.table('transactions').put({ id: 'saved-transaction', cbor: '00' });
    const before = Object.fromEntries(legacy.tables.map(t => [t.name, { primKey: t.schema.primKey.src, indexes: t.schema.indexes.map(i => i.src).sort() }]));
    legacy.close();

    const db = (await getDb(wallet))!;
    expect(db.verno).toBe(13);
    const after = Object.fromEntries(db.tables.map(t => [t.name, { primKey: t.schema.primKey.src, indexes: t.schema.indexes.map(i => i.src).sort() }]));
    const { midnightVaults, ...unchanged } = after;
    expect(unchanged).toEqual(before);
    expect(midnightVaults).toEqual({ primKey: 'vaultId', indexes: ['contractAddress', 'network', 'status', 'updatedAt'] });
    expect(await db.table('vaults').toArray()).toEqual([cardanoVault]);
    expect(await db.table('config').get('currency')).toEqual({ key: 'currency', value: 'EUR' });
    expect(await db.table('transactions').count()).toBe(1);
    // A wallet that never used a Midnight vault reads an empty list, and its Cardano vaults as before.
    expect(await store.list(wallet)).toEqual([]);
    expect(await vaultStore.list(wallet)).toEqual([cardanoVault]);
    // A Midnight vault lands in its own table only.
    await store.addCandidate(wallet, candidate());
    expect(await db.table('vaults').toArray()).toEqual([cardanoVault]);
    expect(await vaultStore.list(wallet)).toEqual([cardanoVault]);
  });
});
