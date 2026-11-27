// The vendored contract builds: the manifest's pins, the network rules, the verifier keys and the
// compiled contracts all agree with each other and with the freeze's own test vectors.
import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import vectors from './vectors.json';
import testJs from './test/contract/index.js?raw';
import productionJs from './production/contract/index.js?raw';
import testTypes from './test/contract/index.d.ts?raw';
import productionTypes from './production/contract/index.d.ts?raw';
import {
  MIDNIGHT_VAULT_BUILDS,
  MIDNIGHT_VAULT_CIRCUITS,
  MidnightVaultBuildError,
  isMidnightVaultBuildAllowed,
  loadMidnightVaultContract,
  loadMidnightVaultVerifierKeys,
  midnightVaultBuild,
  midnightVaultBuildsFor,
} from './index';

const { test: TEST, production: PRODUCTION } = MIDNIGHT_VAULT_BUILDS;
const hex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const bytes = (value: string): Uint8Array => Uint8Array.from(value.match(/../g)!.map(pair => Number.parseInt(pair, 16)));
const padded = (value: string): Uint8Array => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(value));
  return out;
};

describe('the pinned builds', () => {
  it('names both builds of the freeze by id, with the full hash of their preimage', () => {
    expect(TEST.buildId).toBe('gvmn-test-45d16eda70751d57');
    expect(PRODUCTION.buildId).toBe('gvmn-production-c4585eee75a8b850');
    expect(TEST.buildHash).toBe('45d16eda70751d5748439996e1e325f475a506d6868ae478a2aabf8ce33d4cfb');
    expect(PRODUCTION.buildHash).toBe('c4585eee75a8b850784409061cfa32b5f4a8199f07dda55a141dcfafe7e7f836');
    expect(midnightVaultBuild(TEST.buildId)).toBe(TEST);
    expect(midnightVaultBuild('gvmn-test-0000000000000000')).toBeUndefined();
    expect(midnightVaultBuild(undefined)).toBeUndefined();
  });

  it('carries the floors of each profile and the same slot counts', () => {
    expect(TEST.constants).toEqual({
      ownerSlots: 5, whitelistEntries: 8, delegateSlots: 2, guardianSlots: 5,
      minRecoveryDelaySeconds: 60, expiryWindowSeconds: 600, cooldownSeconds: 120,
    });
    expect(PRODUCTION.constants).toEqual({
      ownerSlots: 5, whitelistEntries: 8, delegateSlots: 2, guardianSlots: 5,
      minRecoveryDelaySeconds: 604_800, expiryWindowSeconds: 2_592_000, cooldownSeconds: 172_800,
    });
  });

  it('pins all 18 circuits and the same deferred set for a split deployment', () => {
    for (const build of [TEST, PRODUCTION]) {
      expect(Object.keys(build.circuits).sort()).toEqual([...MIDNIGHT_VAULT_CIRCUITS].sort());
      expect([...build.deferred].sort()).toEqual(
        ['applyGuardians', 'applyRecovery', 'cancelGuardians', 'clearExpiredRecovery', 'deposit', 'proposeGuardians', 'withdrawRecovery'],
      );
    }
  });

  it('accepts the test build on preprod only, and the production build on preprod and mainnet', () => {
    expect(isMidnightVaultBuildAllowed(TEST.buildId, 'preprod')).toBe(true);
    expect(isMidnightVaultBuildAllowed(TEST.buildId, 'mainnet')).toBe(false);
    expect(isMidnightVaultBuildAllowed(TEST.buildId, 'preview')).toBe(false);
    expect(isMidnightVaultBuildAllowed(PRODUCTION.buildId, 'preprod')).toBe(true);
    expect(isMidnightVaultBuildAllowed(PRODUCTION.buildId, 'mainnet')).toBe(true);
    expect(isMidnightVaultBuildAllowed(PRODUCTION.buildId, 'preview')).toBe(false);
    expect(isMidnightVaultBuildAllowed('gvmn-test-0000000000000000', 'preprod')).toBe(false);
    expect(midnightVaultBuildsFor('preprod')).toEqual([TEST, PRODUCTION]);
    expect(midnightVaultBuildsFor('mainnet')).toEqual([PRODUCTION]);
    expect(midnightVaultBuildsFor('Preprod')).toEqual([]);
  });
});

describe('the verifier keys', () => {
  it.each([['test', TEST], ['production', PRODUCTION]] as const)('match every pin of the %s build', async (_name, build) => {
    const keys = await loadMidnightVaultVerifierKeys(build.buildId);
    for (const circuit of MIDNIGHT_VAULT_CIRCUITS) {
      expect(keys[circuit].length).toBe(build.circuits[circuit].verifierKey.bytes);
      expect(hex(sha256(keys[circuit]))).toBe(build.circuits[circuit].verifierKey.sha256);
    }
  });

  it('hands out fresh copies', async () => {
    const first = await loadMidnightVaultVerifierKeys(TEST.buildId);
    first.execute.fill(0);
    const second = await loadMidnightVaultVerifierKeys(TEST.buildId);
    expect(hex(sha256(second.execute))).toBe(TEST.circuits.execute.verifierKey.sha256);
  });

  it('refuses a build it does not pin', async () => {
    await expect(loadMidnightVaultVerifierKeys('gvmn-test-0000000000000000')).rejects.toBeInstanceOf(MidnightVaultBuildError);
  });
});

describe('the compiled contracts', () => {
  // SHA-256 of the freeze's files. index.js lost only its last line, a sourceMappingURL comment.
  const FREEZE_SHA256 = {
    test: 'f8926ea038027c22349840d5cbd008b1bbbb7643337366f801fef8a8f3cb8da0',
    production: 'c47f5ce38bc857fc19b4a8081c8fae1cc422c69b06d55e8b04962b8f1215251a',
    types: 'a36c84cd547c6fb1a68e5e6abaf65fce8970a0c68aac8a4e941afe7091cdd664',
  };
  const SOURCE_MAP_LINE = '//# sourceMappingURL=index.js.map\n';
  const sha = (value: string): string => hex(sha256(new TextEncoder().encode(value)));

  it('are the freeze files, byte for byte', () => {
    expect(sha(testJs + SOURCE_MAP_LINE)).toBe(FREEZE_SHA256.test);
    expect(sha(productionJs + SOURCE_MAP_LINE)).toBe(FREEZE_SHA256.production);
    expect(sha(testTypes)).toBe(FREEZE_SHA256.types);
    expect(productionTypes).toBe(testTypes);
  });

  it.each([['test', TEST], ['production', PRODUCTION]] as const)('load the %s build with its own constants and pins', async (_name, build) => {
    const contract = await loadMidnightVaultContract(build.buildId);
    expect(contract.expectedVk).toEqual(Object.fromEntries(MIDNIGHT_VAULT_CIRCUITS.map(c => [c, build.circuits[c].verifierKey.sha256])));
    expect(contract.pureCircuits.buildConstants()).toEqual([
      BigInt(build.constants.minRecoveryDelaySeconds),
      BigInt(build.constants.expiryWindowSeconds),
      BigInt(build.constants.cooldownSeconds),
    ]);
  });

  it.each([['test', TEST], ['production', PRODUCTION]] as const)('compute the payout digest of the freeze vectors (%s)', async (_name, build) => {
    const contract = await loadMidnightVaultContract(build.buildId);
    const payout = vectors.statementDigests.find(entry => entry.kind === 'payout:v4')!;
    const inputs = payout.inputs as { vault: string; network: string; nonce: number; expiry: string; recipient: string; amount: number };
    const digest = contract.pureCircuits.payoutDigest(
      { bytes: bytes(inputs.vault) },
      padded(inputs.network),
      BigInt(inputs.nonce),
      BigInt(inputs.expiry),
      { bytes: bytes(inputs.recipient) },
      BigInt(inputs.amount),
    );
    expect(digest).toBe(BigInt(payout.value));
  });

  it('refuses a build it does not pin', () => {
    expect(() => loadMidnightVaultContract('gvmn-production-0000000000000000')).toThrow(MidnightVaultBuildError);
  });
});
