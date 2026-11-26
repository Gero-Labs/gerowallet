<template>
  <div class="gerovault-import-signatures">
    <header class="gerovault-import-signatures__header">
      <div class="gerovault-import-signatures__heading">
        <GButton tier="tertiary" compact :to="{ name: GEROVAULT_VAULT_ROUTE, params: { vaultId } }">
          <v-icon size="small" start aria-hidden="true">mdi-chevron-left</v-icon>{{ $t('common.back') }}
        </GButton>
        <h1 class="t-title">{{ $t('gerovault.spend.importSignatures.title') }}</h1>
        <p v-if="ready && ready.context.name !== undefined" class="t-body-sm gerovault-import-signatures__vault-name">{{ displayLabel(ready.context.name) }}</p>
      </div>
      <DetailsToggle v-if="ready" v-model="detailsOn" :peeking="peeking" />
    </header>

    <section v-if="load.status === 'loading'" class="glass-panel gerovault-import-signatures__panel" aria-busy="true">
      <EmptyState icon="mdi-safe" :message="$t('gerovault.spend.loading')" />
    </section>

    <section v-else-if="load.status === 'unavailable'" class="glass-panel gerovault-import-signatures__panel" data-test="collect-unavailable">
      <EmptyState icon="mdi-file-sign" :message="$t(unavailableKey(load.reason, 'gerovault.spend.importSignatures.unavailable'))" />
    </section>

    <template v-else-if="ready">
      <!-- A transaction file: one a co-owner sent to sign, or the proposer's own to collect for. -->
      <section v-if="!session" class="glass-panel gerovault-import-signatures__panel" data-test="open-bundle">
        <h2 class="t-heading gerovault-import-signatures__section-title">{{ $t('gerovault.spend.collect.openTitle') }}</h2>
        <p class="t-body gerovault-import-signatures__text">{{ $t('gerovault.spend.collect.openText') }}</p>
        <input
          ref="bundleInput"
          type="file"
          class="g-sr-only"
          accept=".json,application/json"
          :aria-label="$t('gerovault.spend.collect.openButton')"
          data-test="bundle-input"
          @change="openBundle"
        >
        <GNote v-if="openError" tone="error" icon="mdi-alert-circle-outline" role="alert" data-test="open-error">{{ openError }}</GNote>
        <div class="gerovault-import-signatures__actions">
          <GButton tier="primary" :loading="opening" @click="bundleInput?.click()">
            <v-icon size="small" start aria-hidden="true">mdi-file-upload-outline</v-icon>{{ $t('gerovault.spend.collect.openButton') }}
          </GButton>
        </div>
      </section>

      <template v-else-if="review && progress">
        <section v-if="session.submittedTxId" class="glass-panel gerovault-import-signatures__panel" role="status" data-test="submitted">
          <h2 class="t-heading gerovault-import-signatures__section-title">{{ $t('gerovault.spend.collect.submitted') }}</h2>
          <p class="g-mono t-body-sm gerovault-import-signatures__tx">{{ session.submittedTxId }}</p>
          <div class="gerovault-import-signatures__actions">
            <ExplorerLink type="tx" :id="session.submittedTxId" small />
            <GButton tier="secondary" @click="closeTransaction()">{{ $t('gerovault.spend.collect.another') }}</GButton>
          </div>
        </section>

        <SpendApprovalSheet
          :review="review"
          :network="ready.context.network"
          :payment-script-hash="ready.context.paymentScriptHash"
          :details="detailsVisible"
        />
        <SpendSignersCard :progress="progress" :details="detailsVisible" />

        <template v-if="!session.submittedTxId">
          <!-- This wallet's own signature, and its file for whoever collects. -->
          <section class="glass-panel gerovault-import-signatures__panel">
            <VaultSignPanel
              :support="support"
              :signed="!!ownSignature"
              :disabled="review.status !== 'ready'"
              :busy="signing"
              :error="signError"
              @sign="sign"
            />
            <template v-if="ownSignature">
              <p class="t-body gerovault-import-signatures__text">{{ $t('gerovault.spend.collect.saveSignatureText') }}</p>
              <div class="gerovault-import-signatures__actions">
                <GButton tier="secondary" data-test="save-signature" @click="saveOwnSignature()">
                  <v-icon size="small" start aria-hidden="true">mdi-download</v-icon>{{ $t('gerovault.spend.collect.saveSignature') }}
                </GButton>
              </div>
            </template>
          </section>

          <!-- Other owners' signature files, then submission at threshold. -->
          <section class="glass-panel gerovault-import-signatures__panel" data-test="collect">
            <h2 class="t-heading gerovault-import-signatures__section-title">{{ $t('gerovault.spend.collect.addTitle') }}</h2>
            <input
              ref="witnessInput"
              type="file"
              class="g-sr-only"
              accept=".json,application/json"
              multiple
              :aria-label="$t('gerovault.spend.collect.addButton')"
              data-test="witness-input"
              @change="addWitnessFiles"
            >
            <ul v-if="importResults.length" class="gerovault-import-signatures__results" aria-live="polite" data-test="import-results">
              <li v-for="(result, i) in importResults" :key="i" class="t-body-sm" :class="`gerovault-import-signatures__result--${result.tone}`">
                <v-icon size="14" aria-hidden="true">{{ result.tone === 'ok' ? 'mdi-check' : 'mdi-alert-outline' }}</v-icon>
                <span>{{ result.text }}</span>
              </li>
            </ul>
            <GNote v-if="submitError" tone="error" icon="mdi-alert-circle-outline" role="alert" data-test="submit-error">
              {{ submitError }}
              <span v-if="detailsVisible && submitDetail" class="g-mono gerovault-import-signatures__detail">{{ submitDetail }}</span>
            </GNote>
            <div class="gerovault-import-signatures__actions">
              <GButton tier="tertiary" :disabled="submitting" data-test="close-transaction" @click="closeTransaction()">{{ $t('gerovault.spend.collect.another') }}</GButton>
              <GButton tier="secondary" :disabled="review.status !== 'ready' || submitting" @click="witnessInput?.click()">
                <v-icon size="small" start aria-hidden="true">mdi-file-upload-outline</v-icon>{{ $t('gerovault.spend.collect.addButton') }}
              </GButton>
              <GButton
                tier="primary"
                :disabled="review.status !== 'ready' || !progress.complete"
                :loading="submitting"
                data-test="submit"
                @click="submit()"
              >
                {{ $t('gerovault.spend.collect.submit') }}
              </GButton>
            </div>
          </section>
        </template>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { TX_SUBMIT_UNCONFIRMED_MESSAGE } from '@/chrome/config';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import DetailsToggle from '@/shared/components/DetailsToggle.vue';
import ExplorerLink from '@/shared/components/ExplorerLink.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import { useDetailsLayer } from '@/shared/composables/useDetailsLayer';
import { useTranslation } from '@/shared/composables/useTranslation';
import { displayLabel } from '@/shared/gerovault';
import { GEROVAULT_VAULT_ROUTE } from '@/modules/gerovault/gerovaultRoutes';
import { checkBundleForVault, parseUnsignedBundle, signingFileText } from '@/modules/gerovault/spend/bundle';
import { MAX_BUNDLE_FILE_BYTES, MAX_WITNESS_FILE_BYTES } from '@/modules/gerovault/spend/constants';
import { errorText, participantName, unavailableKey } from '@/modules/gerovault/spend/display';
import { VaultSpendError } from '@/modules/gerovault/spend/errors';
import { readTextFile, saveTextFile } from '@/modules/gerovault/spend/files';
import { reviewBundle, type SpendReview } from '@/modules/gerovault/spend/review';
import { signerSupport } from '@/modules/gerovault/spend/signer';
import { requestVaultWitnessFile } from '@/modules/gerovault/spend/signClient';
import { clearSpendSession, spendSession, spendSessionKey, startSpendSession, updateSpendSession } from '@/modules/gerovault/spend/spendSession';
import { useVaultSpend } from '@/modules/gerovault/spend/useVaultSpend';
import {
  addSignature,
  assembleTransaction,
  createWitnessFile,
  parseWitnessFile,
  signingProgress,
  verifyWitnessFile,
  witnessFileName,
} from '@/modules/gerovault/spend/witnesses';
import SpendApprovalSheet from '@/modules/gerovault/spend/components/SpendApprovalSheet.vue';
import SpendSignersCard from '@/modules/gerovault/spend/components/SpendSignersCard.vue';
import VaultSignPanel from '@/modules/gerovault/spend/components/VaultSignPanel.vue';

defineOptions({ name: 'GerovaultImportSignatures' });

const route = useRoute();
const { t } = useTranslation();
const vaultId = computed(() => String(route.params['vaultId'] ?? ''));
const { load, wallet, walletId, currentSlot } = useVaultSpend(vaultId);
const { enabled: detailsOn, peeking, visible: detailsVisible } = useDetailsLayer('gerovault.spend');

const ready = computed(() => (load.value.status === 'ready' ? load.value : null));
const support = computed(() => signerSupport(wallet.value));
const sessionKey = computed(() => (ready.value && walletId.value !== null ? spendSessionKey(walletId.value, ready.value.context.vaultId) : null));
const session = computed(() => (sessionKey.value ? spendSession(sessionKey.value) ?? null : null));
const review = ref<SpendReview | null>(null);
const progress = computed(() => (session.value && ready.value ? signingProgress(session.value.collection, ready.value.context) : null));
const ownSignature = computed(() => session.value?.collection.signatures.find(s => s.signer.credential === ready.value?.context.self.credential) ?? null);
const describe = (error: unknown) => errorText(error, t);

const bundleInput = ref<HTMLInputElement | null>(null);
const witnessInput = ref<HTMLInputElement | null>(null);
const opening = ref(false);
const openError = ref<string | null>(null);
const signing = ref(false);
const signError = ref<string | null>(null);
const submitting = ref(false);
const submitError = ref<string | null>(null);
const submitDetail = ref<string | null>(null);
const importResults = ref<{ tone: 'ok' | 'refused'; text: string }[]>([]);

async function refreshReview(): Promise<void> {
  const current = ready.value;
  const active = session.value;
  review.value = current && active
    ? await reviewBundle(active.bundle, current.context, { currentSlot: currentSlot.value, knownVaults: current.knownVaults })
    : null;
}

function takeFiles(event: Event): File[] {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  return files;
}

async function openBundle(event: Event): Promise<void> {
  const key = sessionKey.value;
  const current = ready.value;
  const [file] = takeFiles(event);
  if (!key || !current || !file) return;
  opening.value = true;
  openError.value = null;
  try {
    const text = await readTextFile(file, MAX_BUNDLE_FILE_BYTES);
    if (text === null) throw new VaultSpendError('BUNDLE_INVALID', 'Too large', 'size');
    const bundle = parseUnsignedBundle(text);
    checkBundleForVault(bundle, current.context);
    startSpendSession(key, bundle);
    importResults.value = [];
    await refreshReview();
  } catch (error) {
    openError.value = describe(error);
  } finally {
    opening.value = false;
  }
}

async function sign(password: string): Promise<void> {
  const key = sessionKey.value;
  const current = ready.value;
  const active = session.value;
  if (!key || !current || !active || signing.value || review.value?.status !== 'ready') return;
  signing.value = true;
  signError.value = null;
  try {
    if (walletId.value === null) throw new VaultSpendError('UNSUPPORTED_WALLET', 'No wallet');
    // Signed in the background worker, where the root key is; only the witness file comes back.
    const file = await requestVaultWitnessFile({ walletId: walletId.value, vaultId: current.context.vaultId, bundle: active.bundle, password });
    const verified = await verifyWitnessFile(file, active.bundle, current.context);
    updateSpendSession(key, { collection: addSignature(active.collection, verified).collection });
  } catch (error) {
    signError.value = describe(error);
  } finally {
    signing.value = false;
  }
}

function saveOwnSignature(): void {
  const active = session.value;
  const own = ownSignature.value;
  if (!active || !own) return;
  const file = createWitnessFile(active.bundle, own.signer, [own.witness]);
  saveTextFile(witnessFileName(file), signingFileText(file));
}

async function addWitnessFiles(event: Event): Promise<void> {
  const key = sessionKey.value;
  const current = ready.value;
  const files = takeFiles(event);
  if (!key || !current || files.length === 0 || review.value?.status !== 'ready') return;
  const results: { tone: 'ok' | 'refused'; text: string }[] = [];
  for (const file of files) {
    const active = spendSession(key);
    if (!active) break;
    try {
      const text = await readTextFile(file, MAX_WITNESS_FILE_BYTES);
      if (text === null) throw new VaultSpendError('WITNESS_INVALID', 'Too large', 'malformed');
      const verified = await verifyWitnessFile(parseWitnessFile(text), active.bundle, current.context);
      const { collection, added } = addSignature(active.collection, verified);
      updateSpendSession(key, { collection });
      const index = current.context.owners.indexOf(verified.signer.credential);
      const name = participantName(verified.signer, t('gerovault.spend.signers.owner', { n: index + 1 }));
      results.push(added
        ? { tone: 'ok', text: t('gerovault.spend.collect.added', { file: file.name, name }) }
        : { tone: 'ok', text: t('gerovault.spend.collect.duplicate', { file: file.name, name }) });
    } catch (error) {
      results.push({ tone: 'refused', text: t('gerovault.spend.collect.refused', { file: file.name, reason: describe(error) }) });
    }
  }
  importResults.value = [...results, ...importResults.value].slice(0, 20);
}

async function submit(): Promise<void> {
  const key = sessionKey.value;
  const current = ready.value;
  const active = session.value;
  if (!key || !current || !active || submitting.value) return;
  submitting.value = true;
  submitError.value = null;
  submitDetail.value = null;
  try {
    // The sheet is computed again first: an expired proposal is not submitted.
    await refreshReview();
    if (review.value?.status !== 'ready') return;
    const txCbor = assembleTransaction(active.bundle, current.context, active.collection);
    const txId = await current.reader.submit(txCbor);
    updateSpendSession(key, { submittedTxId: txId || active.bundle.txId });
  } catch (error) {
    if (error instanceof VaultSpendError) {
      submitError.value = describe(error);
    } else if (error instanceof Error && error.message === TX_SUBMIT_UNCONFIRMED_MESSAGE) {
      // The broadcast may have worked: say so rather than invite a second submission blindly.
      submitError.value = t('gerovault.spend.error.submitUnconfirmed');
    } else {
      submitError.value = t('gerovault.spend.error.submit');
      submitDetail.value = error instanceof Error ? error.message : null;
    }
  } finally {
    submitting.value = false;
  }
}

function closeTransaction(): void {
  if (sessionKey.value) clearSpendSession(sessionKey.value);
  review.value = null;
  importResults.value = [];
  signError.value = null;
  submitError.value = null;
  submitDetail.value = null;
}

watch(ready, current => {
  if (current) void refreshReview();
}, { immediate: true });
</script>

<style scoped>
.gerovault-import-signatures {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
  max-width: var(--g-content-max);
}
.gerovault-import-signatures__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--g-s-4);
}
.gerovault-import-signatures__heading {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-2);
  min-width: 0;
}
.gerovault-import-signatures__heading h1,
.gerovault-import-signatures__vault-name,
.gerovault-import-signatures__section-title,
.gerovault-import-signatures__text {
  margin: 0;
}
.gerovault-import-signatures__vault-name,
.gerovault-import-signatures__tx,
.gerovault-import-signatures__detail {
  overflow-wrap: anywhere;
}
.gerovault-import-signatures__tx {
  margin: 0;
  color: var(--g-text-1);
}
.gerovault-import-signatures__detail {
  display: block;
}
.gerovault-import-signatures__panel {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}
.gerovault-import-signatures__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: var(--g-s-2);
}
.gerovault-import-signatures__results {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.gerovault-import-signatures__results li {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-1);
  overflow-wrap: anywhere;
}
.gerovault-import-signatures__result--ok {
  color: var(--g-success);
}
.gerovault-import-signatures__result--refused {
  color: var(--g-error);
}
</style>
