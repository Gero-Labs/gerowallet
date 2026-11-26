/**
 * Restoring a vault from a recovery package (spec 6.8) as a state machine for its dialog:
 *
 *   pick, unlock, opening, restoring, then one of
 *   - review, saved, accepted (a native vault);
 *   - notFound, retired or plutusUnreadable (a Plutus vault);
 *   - failed.
 *
 * A wrong passphrase goes back to `unlock` with its error; a damaged file asks for another copy.
 * The result is always a quarantined candidate: every participant and label is a claim from the
 * package, the chain state is information, deposits from this wallet stay blocked, and only the
 * user's explicit confirmation accepts it.
 */
import { computed, ref, shallowRef } from 'vue';
import {
  MAX_RECOVERY_FILE_BYTES,
  openRecoveryPackage,
  readRecoveryHeader,
  recoveryPackageStaleness,
  restoreVaultFromPackage,
  vaultAddresses,
  type PlutusRestoreFacts,
  type RecoveryChainFacts,
  type RecoveryPackage,
  type RecoveryPackageStaleness,
  type RestoredNativeCandidate,
  type RoleKeys,
  type VaultNetwork,
} from '@/shared/gerovault';
import { SLICE_NETWORKS, type VaultChainReader, type VaultRecord, type VaultStore } from '@/modules/gerovault/contracts';
import { RoleKeysError, type VaultRoleKeysSource } from '@/modules/gerovault/detail/roleKeys';
import { nativeChainFacts, plutusChainUtxos } from './chainFacts';
import { candidateInputFromRestore } from './packageContents';

export type RecoveryImportStep =
  | 'pick'
  | 'unlock'
  | 'opening'
  | 'restoring'
  | 'review'
  | 'saving'
  | 'saved'
  | 'accepted'
  | 'notFound'
  | 'retired'
  | 'plutusUnreadable'
  | 'failed';

/**
 * Typed errors the screen names:
 * - the file: `NOT_A_PACKAGE`, `UNKNOWN_VERSION`, `TOO_LARGE`, `UNREADABLE_FILE`, and `DAMAGED`
 *   (truncated, tampered or an invalid payload: use another copy);
 * - `WRONG_PASSPHRASE`;
 * - the vault: `NETWORK_CLOSED` (a network this version keeps closed), `OTHER_NETWORK` (not this
 *   wallet's network), `SEED_MISMATCH` (this wallet's seed is not
 *   the exporter's), `INCONSISTENT` (the keys do not build the scripts);
 * - role keys: `KEYS_UNAVAILABLE`, `WRONG_PASSWORD`, `LOCKED`, `NOT_SUPPORTED`;
 * - the store: `ALREADY_HELD`, `STORE_UNAVAILABLE`, `SAVE_FAILED`;
 * - `FAILED`: anything else.
 */
export const RECOVERY_IMPORT_ERRORS = [
  'NOT_A_PACKAGE',
  'UNKNOWN_VERSION',
  'TOO_LARGE',
  'UNREADABLE_FILE',
  'DAMAGED',
  'WRONG_PASSPHRASE',
  'NETWORK_CLOSED',
  'OTHER_NETWORK',
  'SEED_MISMATCH',
  'INCONSISTENT',
  'KEYS_UNAVAILABLE',
  'WRONG_PASSWORD',
  'LOCKED',
  'NOT_SUPPORTED',
  'ALREADY_HELD',
  'STORE_UNAVAILABLE',
  'SAVE_FAILED',
  'FAILED',
] as const;
export type RecoveryImportError = (typeof RECOVERY_IMPORT_ERRORS)[number];

/** What the file refusals mean to the user. */
export function fileRefusalError(code: string): RecoveryImportError {
  switch (code) {
    case 'NOT_A_PACKAGE':
      return 'NOT_A_PACKAGE';
    case 'UNKNOWN_VERSION':
    case 'UNKNOWN_PAYLOAD_VERSION':
    case 'KDF_TOO_WEAK':
    case 'KDF_OUT_OF_RANGE':
      return 'UNKNOWN_VERSION';
    case 'TOO_LARGE':
      return 'TOO_LARGE';
    case 'WRONG_PASSPHRASE':
      return 'WRONG_PASSPHRASE';
    case 'TRUNCATED':
    case 'TAMPERED':
    case 'PAYLOAD_INVALID':
      return 'DAMAGED';
    default:
      return 'FAILED';
  }
}

/** A retired Plutus vault (spec 6.8): nothing in it can be controlled; `Sweep` pays only `to`. */
export interface RetiredVault {
  readonly kind: 'retired';
  /** The address a sweep pays, bech32. */
  readonly to: string;
  /** From when the deregistration may be included, Unix milliseconds, when known. */
  readonly deregistrationFromMs?: number;
}

/**
 * Reads a Plutus vault's state datum. The library stops before the datum (it needs the GV-64
 * codec), so the screen takes one in; without it a found Plutus vault is "state not readable".
 */
export type PlutusStateReader = (facts: PlutusRestoreFacts, signal?: AbortSignal) => Promise<RetiredVault | { readonly kind: 'unknown' }>;

/** How the chain looked for a native candidate, with what could not be read. */
export interface CandidateChainView {
  readonly registrationChecked: false;
  readonly utxosRead: boolean;
  readonly historyRead: boolean;
}

export interface RecoveryImportDeps {
  readonly wallet: () => { readonly walletId: number; readonly network: VaultNetwork | undefined } | undefined;
  readonly store: VaultStore;
  readonly chainReader: (network: VaultNetwork) => VaultChainReader | undefined;
  readonly roleKeys: VaultRoleKeysSource;
  readonly plutusState?: PlutusStateReader;
  /** How long to wait for the own-attestation check; the library's 10 s by default. */
  readonly attestationTimeoutMs?: number;
}

function roleKeysError(e: unknown): RecoveryImportError | undefined {
  if (!(e instanceof RoleKeysError)) return undefined;
  return e.code === 'UNAVAILABLE' ? 'KEYS_UNAVAILABLE' : e.code;
}

/** Reads a picked file whole, refusing one above the format's bound before reading it. */
export async function readPackageFile(file: Pick<File, 'size' | 'arrayBuffer'>): Promise<Uint8Array | RecoveryImportError> {
  if (file.size > MAX_RECOVERY_FILE_BYTES) return 'TOO_LARGE';
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return 'UNREADABLE_FILE';
  }
}

export function useRecoveryImport(deps: RecoveryImportDeps) {
  const step = ref<RecoveryImportStep>('pick');
  const error = ref<RecoveryImportError | undefined>(undefined);
  const fileName = ref('');
  const passphrase = ref('');
  const spendingPassword = ref('');
  const opened = shallowRef<RecoveryPackage | undefined>(undefined);
  const candidate = shallowRef<RestoredNativeCandidate | undefined>(undefined);
  const chainView = shallowRef<CandidateChainView | undefined>(undefined);
  const plutus = shallowRef<PlutusRestoreFacts | undefined>(undefined);
  const retired = shallowRef<RetiredVault | undefined>(undefined);
  /** The vault as this wallet already holds it, when it does. */
  const held = shallowRef<VaultRecord | undefined>(undefined);
  /** Whether the package is older than the vault this wallet holds. */
  const heldStaleness = shallowRef<RecoveryPackageStaleness | undefined>(undefined);
  const saved = shallowRef<VaultRecord | undefined>(undefined);
  const agreed = ref(false);
  let bytes: Uint8Array | undefined;
  let controller: AbortController | undefined;

  const needsPassword = computed(() => deps.roleKeys.needsSpendingPassword);
  const canUnlock = computed(() => Boolean(bytes) && passphrase.value.length > 0 && (!needsPassword.value || spendingPassword.value.length > 0));

  function fail(code: RecoveryImportError): void {
    error.value = code;
    step.value = 'failed';
  }

  /** Takes the picked file; cheap header checks run before any passphrase is asked for. */
  async function pickFile(file: (Pick<File, 'size' | 'arrayBuffer'> & { readonly name?: string }) | undefined): Promise<void> {
    if (!file) return;
    error.value = undefined;
    const read = await readPackageFile(file);
    if (typeof read === 'string') {
      bytes = undefined;
      error.value = read;
      step.value = 'pick';
      return;
    }
    const header = readRecoveryHeader(read);
    if (header.ok !== true) {
      bytes = undefined;
      error.value = fileRefusalError(header.code);
      step.value = 'pick';
      return;
    }
    bytes = read;
    fileName.value = typeof file.name === 'string' ? file.name : '';
    step.value = 'unlock';
  }

  async function readChain(pkg: RecoveryPackage, reader: VaultChainReader | undefined, signal: AbortSignal): Promise<RecoveryChainFacts> {
    if (!reader) {
      chainView.value = { registrationChecked: false, utxosRead: false, historyRead: false };
      return { network: pkg.network };
    }
    if (pkg.vault.kind !== 'native') return { network: pkg.network };
    // The package's own scripts give the address; the restore rebuilds them and must match.
    const address = vaultAddresses({ payment: pkg.vault.payment, stake: pkg.vault.stake }, pkg.network).base;
    const facts = await nativeChainFacts(reader, pkg.network, address, signal);
    chainView.value = { registrationChecked: false, utxosRead: facts.read.utxos, historyRead: facts.read.history };
    return facts;
  }

  async function restore(pkg: RecoveryPackage, roleKeys: RoleKeys, signal: AbortSignal): Promise<void> {
    step.value = 'restoring';
    const reader = deps.chainReader(pkg.network);
    const chain = await readChain(pkg, reader, signal);
    let result = await restoreVaultFromPackage(pkg, {
      roleKeys,
      chain,
      signal,
      ...(deps.attestationTimeoutMs !== undefined ? { attestationTimeoutMs: deps.attestationTimeoutMs } : {}),
    });
    // Plutus: the first pass names the vault's address; read its UTxOs there and look again.
    if (result.ok !== true && result.code === 'PLUTUS_VAULT_NOT_FOUND' && reader) {
      try {
        const utxos = await plutusChainUtxos(reader, result.plutus.address, signal);
        result = await restoreVaultFromPackage(pkg, { roleKeys, chain: { network: pkg.network, utxos }, signal });
      } catch {
        // The address could not be read: the vault stays "not found", as the library says.
      }
    }
    if (signal.aborted) return;
    if (result.ok === true) {
      candidate.value = result.candidate;
      await lookUpHeld(pkg, result.candidate);
      step.value = 'review';
      return;
    }
    switch (result.code) {
      case 'PLUTUS_VAULT_NOT_FOUND':
        plutus.value = result.plutus;
        step.value = 'notFound';
        return;
      case 'PLUTUS_DATUM_CODEC_UNAVAILABLE': {
        plutus.value = result.plutus;
        const state = deps.plutusState ? await deps.plutusState(result.plutus, signal).catch(() => ({ kind: 'unknown' as const })) : undefined;
        if (state?.kind === 'retired') {
          retired.value = state;
          step.value = 'retired';
        } else {
          step.value = 'plutusUnreadable';
        }
        return;
      }
      case 'SEED_MISMATCH':
        return fail('SEED_MISMATCH');
      case 'NETWORK_MISMATCH':
        return fail('OTHER_NETWORK');
      case 'PACKAGE_INCONSISTENT':
        return fail('INCONSISTENT');
      default:
        return fail('FAILED');
    }
  }

  async function lookUpHeld(pkg: RecoveryPackage, restored: RestoredNativeCandidate): Promise<void> {
    const wallet = deps.wallet();
    held.value = undefined;
    heldStaleness.value = undefined;
    if (!wallet) return;
    try {
      const row = await deps.store.get(wallet.walletId, restored.vaultId);
      held.value = row;
      heldStaleness.value = row?.manifest ? recoveryPackageStaleness(pkg, { version: row.manifest.version, hash: row.manifest.hash }) : undefined;
    } catch {
      held.value = undefined;
    }
  }

  /** Opens the file with the passphrase, then restores against the chain. */
  async function unlock(): Promise<void> {
    const wallet = deps.wallet();
    if (!bytes || !canUnlock.value) return;
    if (!wallet) return fail('FAILED');
    controller?.abort();
    const own = new AbortController();
    controller = own;
    error.value = undefined;
    step.value = 'opening';
    const result = await openRecoveryPackage(bytes, passphrase.value);
    if (own.signal.aborted) return;
    if (result.ok !== true) {
      const code = fileRefusalError(result.code);
      error.value = code;
      step.value = code === 'WRONG_PASSPHRASE' ? 'unlock' : 'failed';
      return;
    }
    const pkg = result.package;
    opened.value = pkg;
    if (!SLICE_NETWORKS.includes(pkg.network)) return fail('NETWORK_CLOSED');
    if (wallet.network !== pkg.network) return fail('OTHER_NETWORK');
    let roleKeys: RoleKeys;
    try {
      roleKeys = await deps.roleKeys.roleKeys({
        walletId: wallet.walletId,
        ...(needsPassword.value ? { spendingPassword: spendingPassword.value } : {}),
      });
    } catch (e) {
      const code = roleKeysError(e) ?? 'FAILED';
      error.value = code;
      step.value = code === 'WRONG_PASSWORD' ? 'unlock' : 'failed';
      return;
    }
    spendingPassword.value = '';
    try {
      await restore(pkg, roleKeys, own.signal);
    } catch {
      if (!own.signal.aborted) fail('FAILED');
    }
  }

  /** Keeps the restored vault as a quarantined candidate in this wallet. */
  async function saveCandidate(): Promise<VaultRecord | undefined> {
    const wallet = deps.wallet();
    const restored = candidate.value;
    const pkg = opened.value;
    if (!wallet || !restored || !pkg) return undefined;
    if (saved.value) return saved.value;
    step.value = 'saving';
    try {
      const row = await deps.store.addCandidate(wallet.walletId, candidateInputFromRestore(restored, pkg));
      saved.value = row;
      step.value = 'saved';
      return row;
    } catch (e) {
      const code = (e as { code?: string })?.code;
      fail(code === 'VAULT_EXISTS' ? 'ALREADY_HELD' : code === 'STORE_UNAVAILABLE' ? 'STORE_UNAVAILABLE' : 'SAVE_FAILED');
      return undefined;
    }
  }

  /** Accepts the candidate. Only after the user confirmed they agreed to join this vault. */
  async function acceptCandidate(): Promise<VaultRecord | undefined> {
    const wallet = deps.wallet();
    if (!wallet || !agreed.value) return undefined;
    const row = saved.value ?? (await saveCandidate());
    if (!row) return undefined;
    step.value = 'saving';
    try {
      const accepted = await deps.store.accept(wallet.walletId, row.vaultId);
      saved.value = accepted;
      step.value = 'accepted';
      return accepted;
    } catch (e) {
      const code = (e as { code?: string })?.code;
      fail(code === 'STORE_UNAVAILABLE' ? 'STORE_UNAVAILABLE' : 'SAVE_FAILED');
      return undefined;
    }
  }

  /** Starts again from the file: after a damaged file, another copy. */
  function reset(): void {
    controller?.abort();
    controller = undefined;
    bytes = undefined;
    step.value = 'pick';
    error.value = undefined;
    fileName.value = '';
    passphrase.value = '';
    spendingPassword.value = '';
    opened.value = undefined;
    candidate.value = undefined;
    chainView.value = undefined;
    plutus.value = undefined;
    retired.value = undefined;
    held.value = undefined;
    heldStaleness.value = undefined;
    saved.value = undefined;
    agreed.value = false;
  }

  return {
    step,
    error,
    fileName,
    passphrase,
    spendingPassword,
    needsPassword,
    canUnlock,
    opened,
    candidate,
    chainView,
    plutus,
    retired,
    held,
    heldStaleness,
    saved,
    agreed,
    pickFile,
    unlock,
    saveCandidate,
    acceptCandidate,
    reset,
  };
}
