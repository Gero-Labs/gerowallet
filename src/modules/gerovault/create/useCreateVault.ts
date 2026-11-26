/**
 * State of the create flow, for `GerovaultCreate.vue`: the three steps (template, cosigners,
 * verify), this wallet's keys, the cosigners as typed and as read, the built vault, its first
 * manifest, the verification records and the save. Every decision is a call into `createVault.ts`;
 * this file only keeps the results and drops stale ones.
 *
 * Dependencies are passed in, so the flow runs in a test without a wallet, a database or a page.
 */
import { computed, reactive, ref, shallowRef, watch } from 'vue';
import type { CosignerVerification, MultisigAccountPublicKey, VaultNetwork } from '@/shared/gerovault';
import type { VaultRecord, VaultStore } from '@/modules/gerovault/contracts';
import {
  DEFAULT_TEMPLATE,
  EMPTY_COSIGNER,
  allocateOwnIndex,
  buildCreatedVault,
  candidateInput,
  clampOwners,
  clampThreshold,
  firstManifest,
  ownVaultKeys,
  readCosigner,
  recordNumberMatch,
  recordQrScan,
  saveCreatedVault,
  templateProblem,
  templateWarnings,
  verificationState,
  verificationView,
  withoutDuplicates,
  type CosignerDraft,
  type CosignerReading,
  type CreatedVault,
  type ManifestState,
  type OwnVaultKeys,
  type QrRefusal,
  type VerificationState,
  type VerificationView,
} from './createVault';
import { OwnAccountKeyError, type OwnAccountKeyErrorCode } from './ownAccountKeyFlow';

export const CREATE_STEPS = ['template', 'cosigners', 'verify'] as const;
export type CreateStep = (typeof CREATE_STEPS)[number];

export interface CreateVaultDeps {
  readonly store: VaultStore;
  /** `walletStore.loggedWallet.id`: the wallet whose vaults table keeps the vault. */
  readonly walletId: number;
  readonly network: VaultNetwork;
  /** This wallet's CIP-1854 account key after its credential (`ownAccountKey.ts`). */
  readonly unlockAccountKey: (password: string) => Promise<MultisigAccountPublicKey>;
  /** Milliseconds since the epoch. */
  readonly now?: () => number;
}

/** Why this wallet's keys could not be unlocked. */
export type UnlockProblem = OwnAccountKeyErrorCode | 'TOO_MANY_PENDING' | 'INDEX_SPACE_EXHAUSTED' | 'INVALID_HISTORY' | 'STORE_UNAVAILABLE';

export interface DraftRow extends CosignerDraft {
  /** A local key for lists. */
  readonly id: number;
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' ? code : undefined;
}

export function useCreateVault(deps: CreateVaultDeps) {
  const now = deps.now ?? (() => Date.now());
  const nowSeconds = () => Math.floor(now() / 1000);

  // 1. Template ---------------------------------------------------------------------------------
  const step = ref<CreateStep>('template');
  const template = reactive({ ...DEFAULT_TEMPLATE });
  const templateIssue = computed(() => templateProblem(template));
  const warnings = computed(() => templateWarnings(template.owners, template.threshold));

  function setOwners(owners: number): void {
    template.owners = clampOwners(owners);
    template.threshold = clampThreshold(template.threshold, template.owners);
    template.acknowledged = false;
    syncDrafts();
  }

  function setThreshold(threshold: number): void {
    template.threshold = clampThreshold(threshold, template.owners);
    template.acknowledged = false;
  }

  // 2 and 3. This wallet's keys ------------------------------------------------------------------
  const own = shallowRef<OwnVaultKeys | null>(null);
  const unlocking = ref(false);
  const unlockProblem = ref<UnlockProblem | null>(null);

  async function unlock(password: string): Promise<void> {
    if (unlocking.value || own.value) return;
    unlocking.value = true;
    unlockProblem.value = null;
    try {
      let records: readonly VaultRecord[];
      try {
        records = await deps.store.list(deps.walletId);
      } catch {
        unlockProblem.value = 'STORE_UNAVAILABLE';
        return;
      }
      const allocation = allocateOwnIndex(records);
      if (allocation.ok === false) {
        unlockProblem.value = allocation.code;
        return;
      }
      let account: MultisigAccountPublicKey;
      try {
        account = await deps.unlockAccountKey(password);
      } catch (error) {
        unlockProblem.value = error instanceof OwnAccountKeyError ? error.code : 'not-supported';
        return;
      }
      own.value = await ownVaultKeys(account, allocation);
    } finally {
      unlocking.value = false;
    }
  }

  // 4. Cosigners -------------------------------------------------------------------------------
  let nextId = 1;
  const drafts = ref<DraftRow[]>([]);
  const readings = shallowRef<readonly CosignerReading[]>([]);
  let readSeq = 0;

  function syncDrafts(): void {
    const wanted = Math.max(0, template.owners - 1);
    const rows = drafts.value.slice(0, wanted);
    while (rows.length < wanted) rows.push({ id: nextId++, ...EMPTY_COSIGNER });
    drafts.value = rows;
  }
  syncDrafts();

  function updateDraft(id: number, patch: Partial<CosignerDraft>): void {
    drafts.value = drafts.value.map(row => (row.id === id ? { ...row, ...patch } : row));
  }

  async function readAll(): Promise<readonly CosignerReading[]> {
    const seq = ++readSeq;
    const raw = await Promise.all(drafts.value.map(row => readCosigner(row)));
    const checked = withoutDuplicates(own.value?.hashes, raw);
    if (seq === readSeq) readings.value = checked;
    return checked;
  }
  watch([drafts, own], () => { void readAll(); }, { immediate: true });

  const cosignersReady = computed(() => own.value !== null
    && readings.value.length === drafts.value.length
    && readings.value.every(r => r.ok));

  // 5 and 6. Build and verify ------------------------------------------------------------------
  const vault = shallowRef<CreatedVault | null>(null);
  const manifestState = shallowRef<ManifestState | null>(null);
  const view = computed<VerificationView | null>(() => (manifestState.value?.ok ? verificationView(manifestState.value.manifest) : null));
  const records = shallowRef<readonly CosignerVerification[]>([]);
  const verification = shallowRef<VerificationState | null>(null);
  const building = ref(false);
  const buildProblem = ref<string | null>(null);

  async function refreshVerification(): Promise<void> {
    const state = manifestState.value;
    verification.value = state?.ok ? await verificationState(state.manifest, state.ack, records.value) : null;
  }

  function goToCosigners(): void {
    if (templateIssue.value !== undefined || saved.value) return;
    syncDrafts();
    step.value = 'cosigners';
  }

  async function goToVerify(): Promise<void> {
    if (step.value !== 'cosigners' || building.value || !own.value || saved.value) return;
    building.value = true;
    buildProblem.value = null;
    try {
      const current = await readAll();
      if (!current.every(r => r.ok)) return;
      const cosigners = current.flatMap(r => (r.ok ? [r.cosigner] : []));
      try {
        vault.value = await buildCreatedVault({ network: deps.network, template, own: own.value, cosigners });
      } catch (error) {
        buildProblem.value = codeOf(error) ?? 'UNKNOWN';
        return;
      }
      manifestState.value = await firstManifest(vault.value, nowSeconds());
      records.value = [];
      await refreshVerification();
      step.value = 'verify';
    } finally {
      building.value = false;
    }
  }

  /** Back one step. The built vault, its manifest and the records made for it are dropped. */
  function back(): void {
    if (saved.value) return;
    if (step.value === 'verify') {
      vault.value = null;
      manifestState.value = null;
      records.value = [];
      verification.value = null;
      step.value = 'cosigners';
    } else if (step.value === 'cosigners') {
      step.value = 'template';
    }
  }

  // Records made after the save are written to the stored vault as well.
  async function keepRecords(next: readonly CosignerVerification[]): Promise<void> {
    records.value = next;
    if (saved.value && vault.value) saved.value = await deps.store.update(deps.walletId, vault.value.vaultId, { verifications: next });
    await refreshVerification();
  }

  async function confirmNumber(credential: string): Promise<void> {
    const state = manifestState.value;
    if (!vault.value || !state?.ok) return;
    await keepRecords(recordNumberMatch(vault.value, state.manifest, records.value, credential, nowSeconds()));
  }

  /** The cosigner's scanned or pasted QR. Resolves with why it was refused, or undefined when recorded. */
  async function applyQr(credential: string, payload: string): Promise<QrRefusal | undefined> {
    const state = manifestState.value;
    if (!vault.value || !state?.ok) return 'MALFORMED_QR';
    const result = recordQrScan(vault.value, state.manifest, records.value, credential, payload, nowSeconds());
    if (result.ok === false) return result.code;
    await keepRecords(result.records);
    return undefined;
  }

  // 7. Save ------------------------------------------------------------------------------------
  const saving = ref(false);
  const saveProblem = ref<string | null>(null);
  const saved = shallowRef<VaultRecord | null>(null);

  async function save(): Promise<VaultRecord | null> {
    if (saving.value || saved.value || !vault.value) return saved.value;
    saving.value = true;
    saveProblem.value = null;
    try {
      const state = manifestState.value;
      const input = candidateInput(vault.value, template.name, state?.ok ? state.manifest : undefined);
      saved.value = await saveCreatedVault(deps.store, deps.walletId, input, records.value);
      return saved.value;
    } catch (error) {
      saveProblem.value = codeOf(error) ?? 'UNKNOWN';
      return null;
    } finally {
      saving.value = false;
    }
  }

  return {
    step,
    template,
    templateIssue,
    warnings,
    setOwners,
    setThreshold,
    own,
    unlocking,
    unlockProblem,
    unlock,
    drafts,
    readings,
    updateDraft,
    cosignersReady,
    vault,
    manifestState,
    view,
    records,
    verification,
    building,
    buildProblem,
    goToCosigners,
    goToVerify,
    back,
    confirmNumber,
    applyQr,
    saving,
    saveProblem,
    saved,
    save,
  };
}

export type CreateVaultFlow = ReturnType<typeof useCreateVault>;
