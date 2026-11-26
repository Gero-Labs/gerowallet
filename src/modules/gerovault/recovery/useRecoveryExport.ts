/**
 * The recovery package export (spec 6.8) as a small state machine for its dialog:
 *
 *   choose, then either
 *   - generated: write, confirm (retype one random group), or
 *   - own: own (at least 16 code points, typed twice);
 *   then exporting, and done or failed.
 *
 * The package holds no spending key; the screen says so. The passphrase lives only in this
 * composable's state and is dropped by `reset()` (the dialog calls it on close).
 */
import { computed, ref, shallowRef } from 'vue';
import { GeroVaultError, exportRecoveryPackage, generateRecoveryPassphrase, type ExportSkipped } from '@/shared/gerovault';
import type { VaultRecord } from '@/modules/gerovault/contracts';
import { RoleKeysError, type VaultRoleKeysSource } from '@/modules/gerovault/detail/context';
import { checkOwnPassphrase, groupMatches, ownPassphraseReady, passphraseGroups, randomGroupIndex } from './passphrase';
import { recoveryContentsFromRecord } from './packageContents';
import { downloadRecoveryFile, recordRecoveryExport, recoveryFileName } from './exportRecord';

export type RecoveryExportStep = 'choose' | 'write' | 'confirm' | 'own' | 'exporting' | 'done' | 'failed';

/**
 * Why an export failed:
 * - role keys: `KEYS_UNAVAILABLE`, `WRONG_PASSWORD`, `LOCKED`, `NOT_SUPPORTED`;
 * - the library: `SEED_MISMATCH` (this wallet's seed is not the vault's entry), `INVALID_PASSPHRASE`,
 *   `HISTORY_TOO_LARGE`, `MANIFEST_HISTORY_CORRUPT`, `PACKAGE_CHECK_FAILED`, `INVALID_PACKAGE`;
 * - `FAILED`: anything else.
 */
export type RecoveryExportError =
  | 'KEYS_UNAVAILABLE'
  | 'WRONG_PASSWORD'
  | 'LOCKED'
  | 'NOT_SUPPORTED'
  | 'SEED_MISMATCH'
  | 'INVALID_PASSPHRASE'
  | 'HISTORY_TOO_LARGE'
  | 'MANIFEST_HISTORY_CORRUPT'
  | 'PACKAGE_CHECK_FAILED'
  | 'INVALID_PACKAGE'
  | 'FAILED';

const LIBRARY_ERRORS: readonly RecoveryExportError[] = [
  'SEED_MISMATCH',
  'INVALID_PASSPHRASE',
  'HISTORY_TOO_LARGE',
  'MANIFEST_HISTORY_CORRUPT',
  'PACKAGE_CHECK_FAILED',
  'INVALID_PACKAGE',
];

export function exportErrorOf(error: unknown): RecoveryExportError {
  if (error instanceof RoleKeysError) return error.code === 'UNAVAILABLE' ? 'KEYS_UNAVAILABLE' : error.code;
  if (error instanceof GeroVaultError && (LIBRARY_ERRORS as readonly string[]).includes(error.code)) return error.code as RecoveryExportError;
  return 'FAILED';
}

/** What the done step reports about the file. */
export interface RecoveryExportResult {
  readonly fileName: string;
  readonly bytes: number;
  readonly skipped: ExportSkipped;
}

export interface RecoveryExportDeps {
  readonly walletId: () => number | undefined;
  readonly roleKeys: VaultRoleKeysSource;
  /** Defaults to the browser download. */
  readonly download?: (bytes: Uint8Array, fileName: string) => void;
  readonly now?: () => number;
}

export function useRecoveryExport(record: () => VaultRecord | undefined, deps: RecoveryExportDeps) {
  const download = deps.download ?? downloadRecoveryFile;
  const now = deps.now ?? (() => Date.now());

  const step = ref<RecoveryExportStep>('choose');
  const mode = ref<'generated' | 'own'>('generated');
  const generated = ref('');
  const confirmIndex = ref(0);
  const confirmInput = ref('');
  const confirmFailed = ref(false);
  const ownPassphrase = ref('');
  const ownRepeat = ref('');
  const spendingPassword = ref('');
  const error = ref<RecoveryExportError | undefined>(undefined);
  const result = shallowRef<RecoveryExportResult | undefined>(undefined);
  let file: Uint8Array | undefined;

  const groups = computed(() => passphraseGroups(generated.value));
  const ownCheck = computed(() => checkOwnPassphrase(ownPassphrase.value, ownRepeat.value));
  const needsPassword = computed(() => deps.roleKeys.needsSpendingPassword);
  const passwordGiven = computed(() => !needsPassword.value || spendingPassword.value.length > 0);
  const canExport = computed(() => {
    if (!passwordGiven.value || !record()) return false;
    if (step.value === 'confirm') return confirmInput.value.trim().length > 0;
    if (step.value === 'own') return ownPassphraseReady(ownPassphrase.value, ownRepeat.value);
    return false;
  });

  function chooseGenerated(): void {
    mode.value = 'generated';
    generated.value = generateRecoveryPassphrase();
    step.value = 'write';
  }

  function chooseOwn(): void {
    mode.value = 'own';
    generated.value = '';
    step.value = 'own';
  }

  /** "I wrote it down": ask for one group chosen at random. */
  function toConfirm(): void {
    confirmIndex.value = randomGroupIndex();
    confirmInput.value = '';
    confirmFailed.value = false;
    step.value = 'confirm';
  }

  function back(): void {
    error.value = undefined;
    if (step.value === 'confirm') step.value = 'write';
    else step.value = 'choose';
  }

  async function runExport(): Promise<void> {
    const vault = record();
    const walletId = deps.walletId();
    if (!vault || walletId === undefined || !canExport.value) return;
    if (mode.value === 'generated' && !groupMatches(confirmInput.value, groups.value[confirmIndex.value] ?? '')) {
      confirmFailed.value = true;
      return;
    }
    const passphrase = mode.value === 'generated' ? generated.value : ownPassphrase.value;
    const from = step.value;
    step.value = 'exporting';
    error.value = undefined;
    try {
      const roleKeys = await deps.roleKeys.roleKeys({
        walletId,
        ...(needsPassword.value ? { spendingPassword: spendingPassword.value } : {}),
      });
      const exportedAt = now();
      const exported = await exportRecoveryPackage(recoveryContentsFromRecord(vault, exportedAt), passphrase, roleKeys);
      file = exported.file;
      const fileName = recoveryFileName(vault.vaultId);
      result.value = { fileName, bytes: exported.file.length, skipped: exported.skipped };
      recordRecoveryExport(walletId, vault, exportedAt);
      download(exported.file, fileName);
      spendingPassword.value = '';
      step.value = 'done';
    } catch (e) {
      error.value = exportErrorOf(e);
      // A wrong spending password is fixed where it was typed; anything else ends the attempt.
      step.value = error.value === 'WRONG_PASSWORD' ? from : 'failed';
    }
  }

  /** The same file again, for a second copy. */
  function downloadAgain(): void {
    const vault = record();
    if (file && vault) download(file, recoveryFileName(vault.vaultId));
  }

  /** Drops every secret this flow held and starts over. */
  function reset(): void {
    step.value = 'choose';
    mode.value = 'generated';
    generated.value = '';
    confirmInput.value = '';
    confirmFailed.value = false;
    ownPassphrase.value = '';
    ownRepeat.value = '';
    spendingPassword.value = '';
    error.value = undefined;
    result.value = undefined;
    file = undefined;
  }

  return {
    step,
    mode,
    generated,
    groups,
    confirmIndex,
    confirmInput,
    confirmFailed,
    ownPassphrase,
    ownRepeat,
    ownCheck,
    spendingPassword,
    needsPassword,
    canExport,
    error,
    result,
    chooseGenerated,
    chooseOwn,
    toConfirm,
    back,
    runExport,
    downloadAgain,
    reset,
  };
}
