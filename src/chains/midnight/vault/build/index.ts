/**
 * The GeroVault Midnight contract builds this wallet ships, vendored from the contract freeze
 * `midnight-vault-freeze-1` (commit d9fd7387):
 *
 * - `manifest.json`: every pin of both builds (build id and its preimage, toolchain, constants,
 *   the deferred set of a split deployment, and per circuit k and the size and SHA-256 of its
 *   prover key, verifier key and ZKIR). Copied unchanged.
 * - `<profile>/contract/index.js` and `index.d.ts`: the compiled contract. Copied unchanged but for
 *   the last line of `index.js`, a `sourceMappingURL` comment naming a map the freeze does not
 *   carry (`build.spec.ts` pins both files to the freeze's SHA-256). The two profiles' types are
 *   identical.
 * - `<profile>/verifierKeys.ts`: the verifier keys as hex, generated from the freeze's key files.
 * - `vectors.json`: the freeze's test vectors, for specs only. Copied unchanged.
 *
 * Prover keys and ZKIR are not here: about 190 MB per build, they are fetched and checked against
 * these pins by the vault prover (`src/chains/midnight/vault/prover`).
 *
 * Two builds: `test` (60-second floors, preprod only, shown with a "test delays" badge on every
 * screen, sheet and request file) and `production`. A build is accepted on a network only when the
 * manifest lists it there and, for the test build, the network is preprod
 * (`isMidnightVaultBuildAllowed`).
 *
 * Importing this module loads no Compact runtime and no WASM: the compiled contract (and with it
 * `@midnight-ntwrk/compact-runtime` and `@midnightntwrk/onchain-runtime-v4`) loads only through
 * `loadMidnightVaultContract`, and the verifier keys only through `loadMidnightVaultVerifierKeys`.
 * Both check what they load against the pins before handing it out.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import manifestJson from './manifest.json';
import type * as CompiledVaultContract from './test/contract/index.js';

// -------------------------------------------------------------------------------------------------
// What the freeze defines

/**
 * Midnight network ids as the contract's network tag word spells them. The same union as the keys
 * library's `MidnightNetwork`; once that folder is merged here this becomes an alias of it.
 */
export type MidnightVaultNetwork = 'mainnet' | 'preprod' | 'preview';
export const MIDNIGHT_VAULT_NETWORK_IDS: readonly MidnightVaultNetwork[] = Object.freeze(['mainnet', 'preprod', 'preview']);

export type MidnightVaultProfile = 'test' | 'production';
export const MIDNIGHT_VAULT_PROFILES: readonly MidnightVaultProfile[] = Object.freeze(['test', 'production']);

/** The 18 proving circuits of both builds, in the contract's order. Each has a verifier key on chain. */
export const MIDNIGHT_VAULT_CIRCUITS = Object.freeze([
  'deposit',
  'execute',
  'delegatePayout',
  'proposeOwners',
  'cancelOwners',
  'applyOwners',
  'proposePolicy',
  'cancelPolicy',
  'applyPolicy',
  'narrowPolicy',
  'proposeRecovery',
  'cancelRecovery',
  'withdrawRecovery',
  'clearExpiredRecovery',
  'applyRecovery',
  'proposeGuardians',
  'cancelGuardians',
  'applyGuardians',
] as const);
export type MidnightVaultCircuit = (typeof MIDNIGHT_VAULT_CIRCUITS)[number];

/** The compiled contract module of a build. Both profiles export the same types. */
export type MidnightVaultContractModule = typeof CompiledVaultContract;
export type {
  Approval as MidnightContractApproval,
  DelegatePolicy as MidnightContractDelegatePolicy,
  GuardianApproval as MidnightContractGuardianApproval,
  GuardianSecret as MidnightContractGuardianSecret,
  Ledger as MidnightContractLedger,
  Owner as MidnightContractOwner,
  PendingGuardians as MidnightContractPendingGuardians,
  PendingOwners as MidnightContractPendingOwners,
  PendingPolicy as MidnightContractPendingPolicy,
  PendingRecovery as MidnightContractPendingRecovery,
  Policy as MidnightContractPolicy,
  RecoveryConfig as MidnightContractRecoveryConfig,
  WlEntry as MidnightContractWlEntry,
  Window as MidnightContractWindow,
} from './test/contract/index.js';

/** A file the build names: its size and SHA-256 (lowercase hex). */
export interface MidnightVaultFilePin {
  readonly bytes: number;
  readonly sha256: string;
}

export interface MidnightVaultCircuitPin {
  readonly circuit: MidnightVaultCircuit;
  /** Circuit size: proved against the SRS `bls_midnight_2p{k}`. */
  readonly k: number;
  /** Left out of the first transaction of a split deployment; the completion update inserts it. */
  readonly deferred: boolean;
  readonly proverKey: MidnightVaultFilePin;
  /** Its SHA-256 is also the key's fingerprint, as `verifierKeyHashOf` (compact-runtime 0.21.0) computes it. */
  readonly verifierKey: MidnightVaultFilePin;
  readonly zkir: MidnightVaultFilePin;
  /** The binary ZKIR a prover reads. */
  readonly bzkir: MidnightVaultFilePin;
}

export interface MidnightVaultBuildConstants {
  readonly ownerSlots: number;
  readonly whitelistEntries: number;
  readonly delegateSlots: number;
  readonly guardianSlots: number;
  /** The recovery delay must be at least this. */
  readonly minRecoveryDelaySeconds: number;
  /** The recovery expiry window must be exactly this. */
  readonly expiryWindowSeconds: number;
  /** The cool-down must be exactly this. */
  readonly cooldownSeconds: number;
}

export interface MidnightVaultToolchain {
  readonly compactc: string;
  readonly language: string;
  readonly runtime: string;
  readonly ledger: string;
  /** The proof server image the build was proved with, pinned by digest. */
  readonly proofServer: string;
}

export interface MidnightVaultBuild {
  /** `gvmn-<profile>-<first 16 hex digits of buildHash>`. */
  readonly buildId: string;
  readonly profile: MidnightVaultProfile;
  /**
   * SHA-256 of the manifest's build id preimage (the profile, the compiler and every circuit with its
   * verifier key's SHA-256), lowercase hex. The build's identity wherever a full hash is needed: the
   * verification set and the recovery package.
   */
  readonly buildHash: string;
  /** Networks the manifest allows the build on. `isMidnightVaultBuildAllowed` narrows the test build further. */
  readonly networks: readonly MidnightVaultNetwork[];
  readonly toolchain: MidnightVaultToolchain;
  readonly constants: MidnightVaultBuildConstants;
  /** The circuits a split deployment leaves for the completion update. */
  readonly deferred: readonly MidnightVaultCircuit[];
  readonly circuits: Readonly<Record<MidnightVaultCircuit, MidnightVaultCircuitPin>>;
}

// -------------------------------------------------------------------------------------------------
// Reading the manifest (once, at import; a malformed vendored manifest is a build error)

const HEX64 = /^[0-9a-f]{64}$/;
const MANIFEST_FORMAT = 'gero-vault/v1|midnight-build-manifest';

type Json = Record<string, unknown>;

function fail(where: string): never {
  throw new Error(`GeroVault Midnight build manifest: ${where}`);
}

const record = (value: unknown, where: string): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : fail(`${where} is not an object`);

const text = (value: unknown, where: string): string => (typeof value === 'string' && value ? value : fail(`${where} is not a string`));

const count = (value: unknown, where: string): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail(`${where} is not a count`);

function pin(value: unknown, where: string): MidnightVaultFilePin {
  const raw = record(value, where);
  const digest = text(raw['sha256'], `${where}.sha256`);
  if (!HEX64.test(digest)) fail(`${where}.sha256 is not a SHA-256`);
  return Object.freeze({ bytes: count(raw['bytes'], `${where}.bytes`), sha256: digest });
}

function hexOf(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function readBuild(profile: MidnightVaultProfile, value: unknown): MidnightVaultBuild {
  const raw = record(value, profile);
  const buildId = text(raw['buildId'], `${profile}.buildId`);
  const preimage = text(raw['buildIdPreimage'], `${profile}.buildIdPreimage`);
  const buildHash = hexOf(sha256(new TextEncoder().encode(preimage)));
  if (buildId !== `gvmn-${profile}-${buildHash.slice(0, 16)}`) fail(`${profile}.buildId does not match its preimage`);

  const networks = raw['networks'];
  if (!Array.isArray(networks) || !networks.length || !networks.every(n => (MIDNIGHT_VAULT_NETWORK_IDS as readonly unknown[]).includes(n))) {
    fail(`${profile}.networks`);
  }

  const toolchainRaw = record(raw['toolchain'], `${profile}.toolchain`);
  const toolchain: MidnightVaultToolchain = Object.freeze({
    compactc: text(toolchainRaw['compactc'], 'toolchain.compactc'),
    language: text(toolchainRaw['language'], 'toolchain.language'),
    runtime: text(toolchainRaw['runtime'], 'toolchain.runtime'),
    ledger: text(toolchainRaw['ledger'], 'toolchain.ledger'),
    proofServer: text(toolchainRaw['proofServer'], 'toolchain.proofServer'),
  });

  const constantsRaw = record(raw['constants'], `${profile}.constants`);
  const constants: MidnightVaultBuildConstants = Object.freeze({
    ownerSlots: count(constantsRaw['ownerSlots'], 'constants.ownerSlots'),
    whitelistEntries: count(constantsRaw['whitelistEntries'], 'constants.whitelistEntries'),
    delegateSlots: count(constantsRaw['delegateSlots'], 'constants.delegateSlots'),
    guardianSlots: count(constantsRaw['guardianSlots'], 'constants.guardianSlots'),
    minRecoveryDelaySeconds: count(constantsRaw['minRecoveryDelaySeconds'], 'constants.minRecoveryDelaySeconds'),
    expiryWindowSeconds: count(constantsRaw['expiryWindowSeconds'], 'constants.expiryWindowSeconds'),
    cooldownSeconds: count(constantsRaw['cooldownSeconds'], 'constants.cooldownSeconds'),
  });

  const circuitsRaw = record(raw['circuits'], `${profile}.circuits`);
  const names = Object.keys(circuitsRaw).sort();
  if (names.join() !== [...MIDNIGHT_VAULT_CIRCUITS].sort().join()) fail(`${profile}.circuits is not the 18 vault circuits`);
  const circuits = Object.fromEntries(MIDNIGHT_VAULT_CIRCUITS.map(circuit => {
    const where = `${profile}.circuits.${circuit}`;
    const c = record(circuitsRaw[circuit], where);
    const verifierRaw = record(c['verifierKey'], `${where}.verifierKey`);
    const verifierKey = pin(verifierRaw, `${where}.verifierKey`);
    if (verifierRaw['fingerprint'] !== verifierKey.sha256) fail(`${where}.verifierKey.fingerprint is not its SHA-256`);
    if (typeof c['deferred'] !== 'boolean') fail(`${where}.deferred`);
    const entry: MidnightVaultCircuitPin = Object.freeze({
      circuit,
      k: count(c['k'], `${where}.k`),
      deferred: c['deferred'],
      proverKey: pin(c['proverKey'], `${where}.proverKey`),
      verifierKey,
      zkir: pin(c['zkir'], `${where}.zkir`),
      bzkir: pin(c['bzkir'], `${where}.bzkir`),
    });
    return [circuit, entry];
  })) as Record<MidnightVaultCircuit, MidnightVaultCircuitPin>;

  const deferredRaw = raw['deferredForSplitDeployment'];
  const deferred = MIDNIGHT_VAULT_CIRCUITS.filter(circuit => circuits[circuit].deferred);
  if (!Array.isArray(deferredRaw) || [...deferredRaw].sort().join() !== [...deferred].sort().join()) fail(`${profile}.deferredForSplitDeployment`);

  return Object.freeze({
    buildId,
    profile,
    buildHash,
    networks: Object.freeze([...networks] as MidnightVaultNetwork[]),
    toolchain,
    constants,
    deferred: Object.freeze(deferred),
    circuits: Object.freeze(circuits),
  });
}

function readManifest(value: unknown): Readonly<Record<MidnightVaultProfile, MidnightVaultBuild>> {
  const raw = record(value, 'manifest');
  if (raw['format'] !== MANIFEST_FORMAT) fail('format');
  const builds = record(raw['builds'], 'builds');
  if (Object.keys(builds).sort().join() !== [...MIDNIGHT_VAULT_PROFILES].sort().join()) fail('builds is not test and production');
  return Object.freeze({ test: readBuild('test', builds['test']), production: readBuild('production', builds['production']) });
}

// -------------------------------------------------------------------------------------------------
// The builds

/** Both pinned builds, by profile. */
export const MIDNIGHT_VAULT_BUILDS: Readonly<Record<MidnightVaultProfile, MidnightVaultBuild>> = readManifest(manifestJson);

/** The pinned build with this id, or undefined for any other value ("not a known build"). */
export function midnightVaultBuild(buildId: unknown): MidnightVaultBuild | undefined {
  return MIDNIGHT_VAULT_PROFILES.map(profile => MIDNIGHT_VAULT_BUILDS[profile]).find(build => build.buildId === buildId);
}

/**
 * Whether this wallet accepts a vault of build `buildId` on `network`: a pinned build the manifest
 * allows there, and never the test build off preprod. Mainnet accepts only the production build.
 */
export function isMidnightVaultBuildAllowed(buildId: unknown, network: unknown): boolean {
  const build = midnightVaultBuild(buildId);
  if (!build || !(build.networks as readonly unknown[]).includes(network)) return false;
  return build.profile !== 'test' || network === 'preprod';
}

/** The builds a new vault on `network` may use, test first. */
export function midnightVaultBuildsFor(network: unknown): readonly MidnightVaultBuild[] {
  return MIDNIGHT_VAULT_PROFILES.map(profile => MIDNIGHT_VAULT_BUILDS[profile]).filter(build => isMidnightVaultBuildAllowed(build.buildId, network));
}

// -------------------------------------------------------------------------------------------------
// Loading a build

export class MidnightVaultBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MidnightVaultBuildError';
  }
}

function knownBuild(buildId: unknown): MidnightVaultBuild {
  const build = midnightVaultBuild(buildId);
  if (!build) throw new MidnightVaultBuildError('Not a pinned GeroVault Midnight build');
  return build;
}

const CONTRACT_LOADERS: Readonly<Record<MidnightVaultProfile, () => Promise<MidnightVaultContractModule>>> = {
  test: () => import('./test/contract/index.js'),
  production: () => import('./production/contract/index.js'),
};

const VERIFIER_KEY_LOADERS: Readonly<Record<MidnightVaultProfile, () => Promise<{ default: Readonly<Record<string, string>> }>>> = {
  test: () => import('./test/verifierKeys'),
  production: () => import('./production/verifierKeys'),
};

const contracts = new Map<MidnightVaultProfile, Promise<MidnightVaultContractModule>>();

/**
 * The compiled contract of a pinned build, with the Compact runtime it imports. Refused when the
 * module's own expected verifier key hashes differ from the manifest's pins, so a contract module
 * and a manifest from different builds never meet. Loaded once per build; a failed load is retried.
 */
export function loadMidnightVaultContract(buildId: unknown): Promise<MidnightVaultContractModule> {
  const build = knownBuild(buildId);
  let pending = contracts.get(build.profile);
  if (!pending) {
    pending = CONTRACT_LOADERS[build.profile]().then(module => {
      const expected = module.expectedVk as Readonly<Record<string, unknown>>;
      const keys = Object.keys(expected).sort().join();
      if (keys !== [...MIDNIGHT_VAULT_CIRCUITS].sort().join()
        || MIDNIGHT_VAULT_CIRCUITS.some(circuit => expected[circuit] !== build.circuits[circuit].verifierKey.sha256)) {
        throw new MidnightVaultBuildError('The compiled contract does not match its build pins');
      }
      return module;
    });
    pending.catch(() => contracts.delete(build.profile));
    contracts.set(build.profile, pending);
  }
  return pending;
}

function bytesOfHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * The verifier key of every circuit of a pinned build, each checked against its size and SHA-256
 * pin. Fresh copies on every call: the caller may hand them to the ledger.
 */
export async function loadMidnightVaultVerifierKeys(buildId: unknown): Promise<Readonly<Record<MidnightVaultCircuit, Uint8Array>>> {
  const build = knownBuild(buildId);
  const { default: hexKeys } = await VERIFIER_KEY_LOADERS[build.profile]();
  const keys = Object.fromEntries(MIDNIGHT_VAULT_CIRCUITS.map(circuit => {
    const hex = hexKeys[circuit];
    const pinned = build.circuits[circuit].verifierKey;
    if (typeof hex !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(hex)) throw new MidnightVaultBuildError(`No verifier key for ${circuit}`);
    const bytes = bytesOfHex(hex);
    if (bytes.length !== pinned.bytes || hexOf(sha256(bytes)) !== pinned.sha256) {
      throw new MidnightVaultBuildError(`The verifier key of ${circuit} does not match its pin`);
    }
    return [circuit, bytes];
  }));
  return Object.freeze(keys) as Readonly<Record<MidnightVaultCircuit, Uint8Array>>;
}
