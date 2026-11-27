/**
 * State of the create flow, for `GerovaultCreate.vue`: the three steps (template, cosigners,
 * verify), this wallet's keys, the cosigners as typed and as read, the built vault, its first
 * manifest, the verification records and the save. Every decision is a call into `createVault.ts`;
 * this file only keeps the results and drops stale ones.
 *
 * Dependencies are passed in, so the flow runs in a test without a wallet, a database or a page.
 */
import { computed, getCurrentScope, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue';
import { encodeVaultPublicKeys, multisigAccountPublicKey, vaultKeyHashes, type CosignerVerification, type MultisigAccountPublicKey, type VaultNetwork } from '@/shared/gerovault';
import { InviteClientError, type InviteAuth, type InviteClient, type InviteClientCode, type LinkAnswer, type SetupViewModel } from '@/modules/gerovault/invites/inviteClient';
import { vaultKeysFromRaw } from '@/modules/gerovault/invites/rawKeys';
import type { VaultChainReader, VaultRecord, VaultStore } from '@/modules/gerovault/contracts';
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
  type ReadyCosigner,
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
  /**
   * The vault network's chain reader (`createVaultChainReader`), to say whether the new vault's
   * address already has transactions. A display only: nothing waits on it. Absent: not checked.
   */
  readonly reader?: Pick<VaultChainReader, 'history'>;
  /** Milliseconds since the epoch. */
  readonly now?: () => number;
  /**
   * Cosigners by invitation (`GEROVAULT_INVITE_*`). Absent, or a background that does not answer:
   * the flow is the paste flow only.
   */
  readonly invites?: CreateInviteDeps;
}

export interface CreateInviteDeps {
  readonly client: Pick<InviteClient, 'status' | 'holds' | 'startSetup' | 'unlockSetup' | 'updateTerms' | 'getSetup' | 'refreshSetup' | 'invite' | 'link' | 'withdrawLink' | 'remind' | 'revoke' | 'markVerified' | 'completeSetup' | 'cancelSetup'>;
  /** The credential of one request from what the user typed (`passKeyAuth` for a PassKey wallet). */
  readonly auth: (password: string) => Promise<InviteAuth>;
  /** Reopen this setup (the Vaults overview's "Continue setup"). */
  readonly resumeSetupId?: string;
  /** The vault's name when the user left it empty: an invitation always names the vault. */
  readonly untitledName: string;
  /** How often an open setup reads its answers, in milliseconds. */
  readonly pollMs?: number;
}

/** `checking`: asking the background; `on`: invitations; `off`: the paste flow only. */
export type InviteMode = 'checking' | 'on' | 'off';

export interface InviteProblem {
  readonly code: InviteClientCode;
  /** The cosigner slot the problem is about, when there is one. */
  readonly n?: number;
  readonly details?: Record<string, unknown>;
}

/**
 * What the chain says about the built vault's address, as a provider reports it (never proof):
 * `used` means a vault with these very scripts has been paid or spent from before.
 */
export type AddressActivity = 'unknown' | 'checking' | 'none' | 'used' | 'unreadable';

/** Why this wallet's keys could not be unlocked. */
export type UnlockProblem = OwnAccountKeyErrorCode | 'TOO_MANY_PENDING' | 'INDEX_SPACE_EXHAUSTED' | 'INVALID_HISTORY' | 'STORE_UNAVAILABLE' | 'NETWORK' | 'EXPIRED';

export interface DraftRow extends CosignerDraft {
  /** A local key for lists. */
  readonly id: number;
  /** `invite`: by name, QR or link (the setup's slot at this row's position); `paste`: keys typed or pasted. */
  readonly mode: 'invite' | 'paste';
}

/** The unlock problem of an invitation error. */
function unlockProblemOf(code: InviteClientCode): UnlockProblem {
  switch (code) {
    case 'WRONG_PASSWORD': return 'wrong-password';
    case 'WALLET_LOCKED': return 'locked';
    case 'CANCELLED': return 'cancelled';
    case 'NOT_FOUND': return 'not-found';
    case 'UNAVAILABLE': return 'unavailable';
    case 'TOO_MANY_PENDING':
    case 'INDEX_SPACE_EXHAUSTED':
    case 'INVALID_HISTORY':
    case 'EXPIRED':
      return code;
    case 'NETWORK':
    case 'RATE_LIMITED':
    case 'BROKEN_SERVER':
    case 'SERVER':
      return 'NETWORK';
    default:
      return 'not-supported';
  }
}

/** A cosigner's keys from their checked ACCEPT, read as the paste flow reads keys. */
async function acceptedCosigner(accept: { label: string; payment: string; stake: string }): Promise<CosignerReading> {
  try {
    const vaultKeys = vaultKeysFromRaw(accept.payment, accept.stake);
    const cosigner: ReadyCosigner = Object.freeze({ source: 'gero', label: accept.label, vaultKeys, encoded: encodeVaultPublicKeys(vaultKeys), hashes: await vaultKeyHashes(vaultKeys) });
    return { ok: true, cosigner };
  } catch {
    return { ok: false, problem: 'INVALID_VAULT_KEYS' };
  }
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

  // Invitations (GV-87): a setup in the background, one slot per cosigner -------------------------
  const inviteMode = ref<InviteMode>(deps.invites ? 'checking' : 'off');
  const setup = shallowRef<SetupViewModel | null>(null);
  const inviteProblem = shallowRef<InviteProblem | null>(null);
  const inviteBusy = ref<number | 'setup' | null>(null);

  function setupFailure(error: unknown, n?: number): void {
    const code = error instanceof InviteClientError ? error.code : 'SERVER';
    const details = error instanceof InviteClientError ? error.details : undefined;
    // The vault key closed in the worker: the own card asks for the credential again.
    if (code === 'LOCKED' && setup.value) setup.value = { ...setup.value, signerReady: false };
    inviteProblem.value = { code, ...(n !== undefined ? { n } : {}), ...(details ? { details } : {}) };
  }

  async function checkInvites(): Promise<void> {
    const inv = deps.invites;
    if (!inv) return;
    try {
      await inv.client.status();
    } catch {
      inviteMode.value = 'off';
      return;
    }
    if (inv.resumeSetupId) {
      try {
        const resumed = await inv.client.getSetup(inv.resumeSetupId);
        if (resumed.state === 'open' && resumed.walletId === deps.walletId && resumed.network === deps.network) {
          setup.value = resumed;
          template.name = resumed.name;
          template.owners = clampOwners(resumed.owners);
          template.threshold = clampThreshold(resumed.threshold, template.owners);
          template.acknowledged = true;
          syncDrafts();
          step.value = 'cosigners';
        } else {
          inviteProblem.value = { code: resumed.state === 'expired' ? 'EXPIRED' : 'NOT_FOUND' };
        }
      } catch (error) {
        setupFailure(error);
      }
    }
    inviteMode.value = 'on';
    if (setup.value) void refreshSetup();
  }

  /** Starts the setup (this wallet's index and keys, in the worker), or reopens its vault key. */
  async function unlockByInvitation(inv: CreateInviteDeps, password: string): Promise<void> {
    let answer: { setup: SetupViewModel; accountKey: string };
    try {
      const auth = await inv.auth(password);
      answer = setup.value
        ? await inv.client.unlockSetup(setup.value.setupId, auth)
        : await inv.client.startSetup({ walletId: deps.walletId, name: template.name.trim() || inv.untitledName, owners: template.owners, threshold: template.threshold }, auth);
    } catch (error) {
      const code = error instanceof InviteClientError ? error.code : 'SERVER';
      unlockProblem.value = unlockProblemOf(code);
      if (error instanceof InviteClientError && error.details) inviteProblem.value = { code, details: error.details };
      return;
    }
    const keys = await ownVaultKeys(multisigAccountPublicKey(answer.accountKey), { index: answer.setup.ownIndex, reused: false });
    // The page derives the same keys the worker signs with, or nothing goes further.
    if (keys.vaultKeys.payment !== answer.setup.ownPayment || keys.vaultKeys.stake !== answer.setup.ownStake) {
      unlockProblem.value = 'not-supported';
      return;
    }
    setup.value = answer.setup;
    own.value = keys;
    inviteProblem.value = null;
  }

  /** The template changed after the setup started: the background takes it while nobody is invited. */
  async function syncTerms(): Promise<void> {
    const current = setup.value;
    if (!current || !deps.invites) return;
    const name = template.name.trim() || deps.invites.untitledName;
    if (current.name === name && current.owners === template.owners && current.threshold === template.threshold) return;
    try {
      setup.value = await deps.invites.client.updateTerms(current.setupId, { name, owners: template.owners, threshold: template.threshold });
    } catch (error) {
      // Invitations went out with the old terms: keep them.
      template.name = current.name;
      template.owners = current.owners;
      template.threshold = current.threshold;
      syncDrafts();
      setupFailure(error);
    }
  }

  async function onSetup(run: (inv: CreateInviteDeps, setupId: string) => Promise<SetupViewModel>, n?: number): Promise<boolean> {
    const inv = deps.invites;
    const current = setup.value;
    if (!inv || !current || inviteBusy.value !== null) return false;
    inviteBusy.value = n ?? 'setup';
    inviteProblem.value = null;
    try {
      setup.value = await run(inv, current.setupId);
      return true;
    } catch (error) {
      setupFailure(error, n);
      return false;
    } finally {
      inviteBusy.value = null;
    }
  }

  const inviteCosigner = (n: number, target: { stakeCredential: string; handle?: string; label?: string }) =>
    onSetup((inv, id) => inv.client.invite(id, n, target), n);
  const remindCosigner = (n: number) => onSetup((inv, id) => inv.client.remind(id, n), n);
  const revokeCosigner = (n: number) => onSetup((inv, id) => inv.client.revoke(id, n), n);

  /** A one-time QR (10 minutes) or a link to copy. Null when it could not be made (`inviteProblem` says why). */
  async function makeLink(kind: 'qr' | 'link'): Promise<LinkAnswer | null> {
    const inv = deps.invites;
    const current = setup.value;
    if (!inv || !current) return null;
    inviteProblem.value = null;
    try {
      const answer = await inv.client.link(current.setupId, kind);
      setup.value = answer.setup;
      return answer;
    } catch (error) {
      setupFailure(error);
      return null;
    }
  }

  async function withdrawLink(joinTokenHash: string): Promise<void> {
    const current = setup.value;
    if (!current || !deps.invites) return;
    setup.value = await deps.invites.client.withdrawLink(current.setupId, joinTokenHash).catch(() => current);
  }

  let refreshing: Promise<void> | null = null;
  /** Reads the answers gero-sync holds (a cosigner's keys fill in once their ACCEPT checked out). */
  function refreshSetup(): Promise<void> {
    const inv = deps.invites;
    const current = setup.value;
    if (!inv || !current || current.state !== 'open') return Promise.resolve();
    refreshing ??= inv.client.refreshSetup(current.setupId)
      .then(next => { setup.value = next; })
      .catch(error => {
        const code = error instanceof InviteClientError ? error.code : 'SERVER';
        // A poll that fails offline is quiet; the next one tries again.
        if (code !== 'NETWORK' && code !== 'UNAVAILABLE') setupFailure(error);
      })
      .finally(() => { refreshing = null; });
    return refreshing;
  }

  async function markSlotVerified(credential: string): Promise<void> {
    const inv = deps.invites;
    const current = setup.value;
    const cosigner = vault.value?.cosigners.find(c => c.hashes.payment === credential);
    if (!inv || !current || !cosigner) return;
    const slot = current.slots.find(s => s.accept?.payment === cosigner.vaultKeys.payment);
    if (!slot) return;
    setup.value = await inv.client.markVerified(current.setupId, slot.n).catch(() => current);
  }

  /** Ends the setup: its invitations read as cancelled, and this wallet's index is released. */
  async function cancelSetup(): Promise<boolean> {
    return onSetup((inv, id) => inv.client.cancelSetup(id));
  }

  if (deps.invites) {
    void checkInvites();
    const timer = setInterval(() => {
      if (step.value !== 'template' && !saved.value) void refreshSetup();
    }, deps.invites.pollMs ?? 8000);
    if (getCurrentScope()) onScopeDispose(() => clearInterval(timer));
  }

  // 2 and 3. This wallet's keys ------------------------------------------------------------------
  const own = shallowRef<OwnVaultKeys | null>(null);
  const unlocking = ref(false);
  const unlockProblem = ref<UnlockProblem | null>(null);

  async function unlock(password: string): Promise<void> {
    if (unlocking.value) return;
    if (own.value && !(inviteMode.value === 'on' && setup.value && !setup.value.signerReady)) return;
    unlocking.value = true;
    unlockProblem.value = null;
    try {
      if (inviteMode.value === 'on' && deps.invites) {
        await unlockByInvitation(deps.invites, password);
        return;
      }
      let records: readonly VaultRecord[];
      try {
        records = await deps.store.list(deps.walletId);
      } catch {
        unlockProblem.value = 'STORE_UNAVAILABLE';
        return;
      }
      // The indexes the wallet's invitations hold count too: a pasted vault never takes one.
      let holds;
      try {
        holds = inviteMode.value === 'off' || !deps.invites ? undefined : await deps.invites.client.holds(deps.walletId);
      } catch {
        holds = undefined;
      }
      const allocation = allocateOwnIndex(records, holds);
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
    while (rows.length < wanted) rows.push({ id: nextId++, ...EMPTY_COSIGNER, mode: 'invite' });
    drafts.value = rows;
  }
  syncDrafts();

  function updateDraft(id: number, patch: Partial<CosignerDraft> & { mode?: DraftRow['mode'] }): void {
    drafts.value = drafts.value.map(row => (row.id === id ? { ...row, ...patch } : row));
  }

  async function readRow(row: DraftRow, position: number): Promise<CosignerReading> {
    if (inviteMode.value !== 'on' || row.mode === 'paste') return readCosigner(row);
    const accept = setup.value?.slots[position]?.accept;
    return accept ? acceptedCosigner(accept) : { ok: false, problem: 'INVITE_PENDING' };
  }

  async function readAll(): Promise<readonly CosignerReading[]> {
    const seq = ++readSeq;
    const raw = await Promise.all(drafts.value.map((row, i) => readRow(row, i)));
    const checked = withoutDuplicates(own.value?.hashes, raw);
    if (seq === readSeq) readings.value = checked;
    return checked;
  }
  watch([drafts, own, setup, inviteMode], () => { void readAll(); }, { immediate: true });

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

  const addressActivity = ref<AddressActivity>('unknown');
  let activitySeq = 0;

  async function checkAddress(address: string): Promise<void> {
    const seq = ++activitySeq;
    if (!deps.reader) return;
    addressActivity.value = 'checking';
    let activity: AddressActivity;
    try {
      activity = (await deps.reader.history(address, { pageSize: 1 })).length > 0 ? 'used' : 'none';
    } catch {
      activity = 'unreadable';
    }
    if (seq === activitySeq) addressActivity.value = activity;
  }

  async function refreshVerification(): Promise<void> {
    const state = manifestState.value;
    verification.value = state?.ok ? await verificationState(state.manifest, state.ack, records.value) : null;
  }

  function goToCosigners(): void {
    if (templateIssue.value !== undefined || saved.value) return;
    syncDrafts();
    step.value = 'cosigners';
    void syncTerms();
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
      try {
        manifestState.value = await firstManifest(vault.value, nowSeconds());
        records.value = [];
        await refreshVerification();
      } catch (error) {
        vault.value = null;
        manifestState.value = null;
        buildProblem.value = codeOf(error) ?? 'UNKNOWN';
        return;
      }
      void checkAddress(String(vault.value.addresses.base));
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
      activitySeq++;
      addressActivity.value = 'unknown';
      step.value = 'cosigners';
    } else if (step.value === 'cosigners') {
      step.value = 'template';
    }
  }

  // Records made after the save are written to the stored vault as well.
  async function keepRecords(next: readonly CosignerVerification[]): Promise<void> {
    records.value = next;
    await refreshVerification();
    if (!saved.value || !vault.value) return;
    try {
      saved.value = await deps.store.update(deps.walletId, vault.value.vaultId, { verifications: next });
      saveProblem.value = null;
    } catch (error) {
      saveProblem.value = codeOf(error) ?? 'UNKNOWN';
    }
  }

  async function confirmNumber(credential: string): Promise<void> {
    const state = manifestState.value;
    if (!vault.value || !state?.ok) return;
    await keepRecords(recordNumberMatch(vault.value, state.manifest, records.value, credential, nowSeconds()));
    await markSlotVerified(credential);
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
      // The vault holds the index now: the setup closes on gero-sync (its open invitations end).
      if (setup.value && deps.invites) {
        const done = await deps.invites.client.completeSetup(setup.value.setupId, saved.value.vaultId).catch(() => null);
        if (done) setup.value = done;
      }
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
    inviteMode,
    setup,
    inviteProblem,
    inviteBusy,
    inviteCosigner,
    remindCosigner,
    revokeCosigner,
    makeLink,
    withdrawLink,
    refreshSetup,
    cancelSetup,
    drafts,
    readings,
    updateDraft,
    cosignersReady,
    vault,
    manifestState,
    view,
    records,
    verification,
    addressActivity,
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
