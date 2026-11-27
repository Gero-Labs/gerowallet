<template>
  <div class="gerovault-spend">
    <header class="gerovault-spend__header">
      <div class="gerovault-spend__heading">
        <GButton tier="tertiary" compact :to="{ name: GEROVAULT_VAULT_ROUTE, params: { vaultId } }">
          <v-icon size="small" start aria-hidden="true">mdi-chevron-left</v-icon>{{ $t('common.back') }}
        </GButton>
        <h1 class="t-title">{{ $t('gerovault.spend.title') }}</h1>
        <p v-if="ready && ready.context.name !== undefined" class="t-body-sm gerovault-spend__vault-name">{{ displayLabel(ready.context.name) }}</p>
      </div>
      <DetailsToggle v-if="ready" v-model="detailsOn" :peeking="peeking" />
    </header>

    <section v-if="load.status === 'loading'" class="glass-panel gerovault-spend__panel" aria-busy="true">
      <EmptyState icon="mdi-safe" :message="$t('gerovault.spend.loading')" />
    </section>

    <section v-else-if="load.status === 'unavailable'" class="glass-panel gerovault-spend__panel" data-test="spend-unavailable">
      <EmptyState icon="mdi-bank-transfer-out" :message="$t(unavailableKey(load.reason))" />
    </section>

    <template v-else-if="ready">
      <!-- 1. Propose: recipients and amounts. -->
      <section v-if="phase === 'form'" class="glass-panel gerovault-spend__panel" data-test="spend-form">
        <div class="gerovault-spend__balance">
          <span class="t-label">{{ $t('gerovault.spend.balance') }}</span>
          <ErrorState v-if="utxoError" :message="$t('gerovault.spend.error.utxos')" retryable @retry="loadUtxos()" />
          <template v-else-if="utxos">
            <VaultValue :value="balance" :details="detailsVisible" />
            <p class="t-caption gerovault-spend__hint">{{ $t('gerovault.spend.balanceNote') }}</p>
          </template>
          <v-progress-linear v-else indeterminate color="primary" :aria-label="$t('gerovault.spend.loading')" />
        </div>

        <form class="gerovault-spend__form" novalidate @submit.prevent="build()">
          <fieldset v-for="(recipient, i) in recipients" :key="recipient.id" class="gerovault-spend__recipient" data-test="recipient">
            <legend class="t-label">{{ $t('gerovault.spend.recipient', { n: i + 1 }) }}</legend>
            <v-text-field
              v-model="recipient.address"
              :label="$t('gerovault.spend.recipientAddress')"
              :error-messages="fieldErrors[`${recipient.id}.address`]"
              variant="outlined"
              density="compact"
              spellcheck="false"
              autocomplete="off"
              hide-details="auto"
              data-test="recipient-address"
            />
            <v-text-field
              v-model="recipient.ada"
              :label="$t('gerovault.spend.amountAda')"
              :error-messages="fieldErrors[`${recipient.id}.ada`]"
              variant="outlined"
              density="compact"
              inputmode="decimal"
              autocomplete="off"
              hide-details="auto"
              data-test="recipient-ada"
            />
            <div v-for="token in recipient.tokens" :key="token.id" class="gerovault-spend__token">
              <v-select
                v-model="token.unit"
                :items="tokenItems"
                :label="$t('gerovault.spend.token')"
                variant="outlined"
                density="compact"
                hide-details="auto"
                attach
              />
              <v-text-field
                v-model="token.quantity"
                :label="$t('common.quantity')"
                :error-messages="fieldErrors[`${recipient.id}.${token.id}`]"
                variant="outlined"
                density="compact"
                inputmode="numeric"
                hide-details="auto"
              />
              <GButton tier="tertiary" compact :aria-label="$t('common.remove')" @click="removeToken(recipient, token.id)">
                <v-icon size="small" aria-hidden="true">mdi-close</v-icon>
              </GButton>
            </div>
            <div class="gerovault-spend__row-actions">
              <GButton v-if="tokenItems.length > 0" tier="tertiary" compact @click="addToken(recipient)">
                <v-icon size="small" start aria-hidden="true">mdi-plus</v-icon>{{ $t('gerovault.spend.addToken') }}
              </GButton>
              <GButton v-if="recipients.length > 1" tier="tertiary" compact @click="removeRecipient(recipient.id)">
                {{ $t('common.remove') }}
              </GButton>
            </div>
          </fieldset>

          <GButton tier="secondary" compact class="gerovault-spend__add" @click="addRecipient()">
            <v-icon size="small" start aria-hidden="true">mdi-plus</v-icon>{{ $t('gerovault.spend.addRecipient') }}
          </GButton>

          <p class="t-caption gerovault-spend__hint">{{ $t('gerovault.spend.validity') }}</p>
          <GNote v-if="buildError" tone="error" icon="mdi-alert-circle-outline" role="alert" data-test="build-error">{{ buildError }}</GNote>
          <GButton tier="primary" type="submit" :loading="building" :disabled="!utxos" data-test="build-button">
            {{ $t('gerovault.spend.build') }}
          </GButton>
        </form>
      </section>

      <!-- 2 to 4. The approval sheet, this wallet's signature, and the file for the other owners. -->
      <template v-else-if="session && review && progress">
        <SpendApprovalSheet
          :review="review"
          :network="ready.context.network"
          :payment-script-hash="ready.context.paymentScriptHash"
          :own-collateral-key-hash="ownCollateralKeyHash"
          :details="detailsVisible"
        />
        <SpendSignersCard :progress="progress" :details="detailsVisible" />

        <section class="glass-panel gerovault-spend__panel">
          <VaultSignPanel
            :support="support"
            :signed="ownSigned"
            :disabled="review.status !== 'ready'"
            :busy="signing"
            :error="signError"
            @sign="sign"
          />
          <div class="gerovault-spend__actions">
            <GButton tier="tertiary" :disabled="signing" data-test="discard" @click="discard()">{{ $t('gerovault.spend.discard') }}</GButton>
          </div>
        </section>

        <section v-if="ownSigned" class="glass-panel gerovault-spend__panel" data-test="share">
          <h2 class="t-heading gerovault-spend__section-title">{{ $t('gerovault.spend.share.title') }}</h2>
          <p class="t-body gerovault-spend__hint">{{ $t('gerovault.spend.share.text') }}</p>
          <div class="gerovault-spend__actions">
            <GButton tier="secondary" data-test="save-bundle" @click="saveBundle()">
              <v-icon size="small" start aria-hidden="true">mdi-download</v-icon>{{ $t('gerovault.spend.share.saveBundle') }}
            </GButton>
            <GButton tier="primary" :to="{ name: GEROVAULT_IMPORT_SIGNATURES_ROUTE, params: { vaultId } }" data-test="collect">
              {{ $t('gerovault.spend.share.collect') }}
            </GButton>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { Cardano } from '@cardano-sdk/core';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import DetailsToggle from '@/shared/components/DetailsToggle.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import { useDetailsLayer } from '@/shared/composables/useDetailsLayer';
import { useTranslation } from '@/shared/composables/useTranslation';
import { displayLabel } from '@/shared/gerovault';
import { GEROVAULT_IMPORT_SIGNATURES_ROUTE, GEROVAULT_VAULT_ROUTE } from '@/modules/gerovault/gerovaultRoutes';
import { buildVaultSpend, parseAdaAmount, parseTokenQuantity, readRecipientAddress, utxoTotal, vaultUtxos, type SpendRecipient } from '@/modules/gerovault/spend/buildSpend';
import { bundleFileName, createUnsignedBundle, signingFileText } from '@/modules/gerovault/spend/bundle';
import { errorText, tokenName, unavailableKey } from '@/modules/gerovault/spend/display';
import { VaultSpendError } from '@/modules/gerovault/spend/errors';
import { saveTextFile } from '@/modules/gerovault/spend/files';
import { reviewBundle, type SpendReview } from '@/modules/gerovault/spend/review';
import { accountCollateralKeyHash, signerSupport } from '@/modules/gerovault/spend/signer';
import { PLAIN_SPEND_PLAN, witnessPlanOf } from '@/modules/gerovault/dust/operations';
import { requestVaultWitnessFile } from '@/modules/gerovault/spend/signClient';
import { clearSpendSession, spendSession, spendSessionKey, startSpendSession, updateSpendSession } from '@/modules/gerovault/spend/spendSession';
import { useVaultSpend } from '@/modules/gerovault/spend/useVaultSpend';
import { addSignature, signingProgress, verifyWitnessFile } from '@/modules/gerovault/spend/witnesses';
import SpendApprovalSheet from '@/modules/gerovault/spend/components/SpendApprovalSheet.vue';
import SpendSignersCard from '@/modules/gerovault/spend/components/SpendSignersCard.vue';
import VaultSignPanel from '@/modules/gerovault/spend/components/VaultSignPanel.vue';
import VaultValue from '@/modules/gerovault/spend/components/VaultValue.vue';

defineOptions({ name: 'GerovaultSpend' });

interface TokenDraft { id: number; unit: string; quantity: string }
interface RecipientDraft { id: number; address: string; ada: string; tokens: TokenDraft[] }

const route = useRoute();
const { t } = useTranslation();
const vaultId = computed(() => String(route.params['vaultId'] ?? ''));
const { load, wallet, walletId, currentSlot, protocolParameters } = useVaultSpend(vaultId);
const { enabled: detailsOn, peeking, visible: detailsVisible } = useDetailsLayer('gerovault.spend');

const ready = computed(() => (load.value.status === 'ready' ? load.value : null));
const support = computed(() => signerSupport(wallet.value));
const describe = (error: unknown) => errorText(error, t);

// 1. Propose
let nextId = 1;
const newRecipient = (): RecipientDraft => ({ id: nextId++, address: '', ada: '', tokens: [] });
const recipients = reactive<RecipientDraft[]>([newRecipient()]);
const fieldErrors = ref<Record<string, string>>({});
const buildError = ref<string | null>(null);
const building = ref(false);
const utxos = ref<Cardano.Utxo[] | null>(null);
const utxoError = ref(false);

const balance = computed(() => {
  const total = utxoTotal(utxos.value ?? []);
  return {
    lovelace: total.lovelace,
    tokens: [...total.assets].map(([id, quantity]) => ({ policyId: id.slice(0, 56), assetNameHex: id.slice(56), quantity })),
  };
});
const tokenItems = computed(() => balance.value.tokens.map(token => ({
  title: `${tokenName(token) || t('gerovault.spend.tokenNameless')} (${token.policyId.slice(0, 8)})`,
  value: `${token.policyId}${token.assetNameHex}`,
})));

function addRecipient(): void {
  recipients.push(newRecipient());
}
function removeRecipient(id: number): void {
  const index = recipients.findIndex(r => r.id === id);
  if (index >= 0 && recipients.length > 1) recipients.splice(index, 1);
}
function addToken(recipient: RecipientDraft): void {
  recipient.tokens.push({ id: nextId++, unit: tokenItems.value[0]?.value ?? '', quantity: '' });
}
function removeToken(recipient: RecipientDraft, id: number): void {
  recipient.tokens = recipient.tokens.filter(token => token.id !== id);
}

async function loadUtxos(): Promise<void> {
  const current = ready.value;
  if (!current) return;
  utxoError.value = false;
  utxos.value = null;
  try {
    utxos.value = vaultUtxos(await current.reader.utxos(current.context.baseAddress), current.context);
  } catch {
    utxoError.value = true;
  }
}

/** The typed form as recipients, with an error under each field that does not read. */
function readForm(): SpendRecipient[] | null {
  const context = ready.value?.context;
  if (!context) return null;
  const errors: Record<string, string> = {};
  const read: SpendRecipient[] = [];
  for (const draft of recipients) {
    let address = '';
    let lovelace = 0n;
    const assets = new Map<Cardano.AssetId, bigint>();
    try {
      address = readRecipientAddress(draft.address, context);
    } catch (error) {
      errors[`${draft.id}.address`] = describe(error);
    }
    try {
      lovelace = draft.ada.trim() === '' && draft.tokens.length > 0 ? 0n : parseAdaAmount(draft.ada);
    } catch (error) {
      errors[`${draft.id}.ada`] = describe(error);
    }
    for (const token of draft.tokens) {
      try {
        if (!token.unit) throw new VaultSpendError('INVALID_AMOUNT', 'No token chosen');
        const unit = token.unit as Cardano.AssetId;
        assets.set(unit, (assets.get(unit) ?? 0n) + parseTokenQuantity(token.quantity));
      } catch (error) {
        errors[`${draft.id}.${token.id}`] = describe(error);
      }
    }
    read.push({ address, lovelace, assets });
  }
  fieldErrors.value = errors;
  return Object.keys(errors).length === 0 ? read : null;
}

// 2 to 4. Review, sign, share
const sessionKey = computed(() => (ready.value && walletId.value !== null ? spendSessionKey(walletId.value, ready.value.context.vaultId) : null));
const session = computed(() => (sessionKey.value ? spendSession(sessionKey.value) ?? null : null));
const review = ref<SpendReview | null>(null);
/** What the witness set needs beyond payment signatures: read from this device's own sheet. */
const plan = computed(() => (ready.value && review.value?.status === 'ready' ? witnessPlanOf(review.value.operation, ready.value.context) : PLAIN_SPEND_PLAN));
/** This wallet's first address key hash, so the sheet can say a DUST operation's collateral is its own. */
const ownCollateralKeyHash = ref<string | null>(null);
watch(() => wallet.value?.publicKey, key => {
  void accountCollateralKeyHash(key).then(hash => { ownCollateralKeyHash.value = hash ?? null; });
}, { immediate: true });
const phase = computed<'form' | 'review'>(() => (session.value && review.value ? 'review' : 'form'));
const progress = computed(() => (session.value && ready.value ? signingProgress(session.value.collection, ready.value.context, plan.value) : null));
const ownSigned = computed(() => !!progress.value?.owners.some(o => o.participant.self && o.signed));
const signing = ref(false);
const signError = ref<string | null>(null);

async function refreshReview(): Promise<void> {
  const current = ready.value;
  const active = session.value;
  if (!current || !active) {
    review.value = null;
    return;
  }
  review.value = await reviewBundle(active.bundle, current.context, { currentSlot: currentSlot.value, knownVaults: current.knownVaults });
}

async function build(): Promise<void> {
  const key = sessionKey.value;
  const current = ready.value;
  if (!key || !current || building.value || !utxos.value) return;
  buildError.value = null;
  const read = readForm();
  if (!read) return;
  building.value = true;
  try {
    if (!protocolParameters.value || currentSlot.value === null) throw new VaultSpendError('PARAMS_UNAVAILABLE', 'Not synced');
    const built = await buildVaultSpend({
      context: current.context,
      utxos: utxos.value,
      recipients: read,
      protocolParameters: protocolParameters.value,
      currentSlot: currentSlot.value,
    });
    const bundle = await createUnsignedBundle(current.context, built, current.reader.txCbor);
    startSpendSession(key, bundle);
    await refreshReview();
  } catch (error) {
    buildError.value = describe(error);
  } finally {
    building.value = false;
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
    const verified = await verifyWitnessFile(file, active.bundle, current.context, plan.value);
    updateSpendSession(key, { collection: addSignature(active.collection, verified).collection });
  } catch (error) {
    signError.value = describe(error);
  } finally {
    signing.value = false;
  }
}

function saveBundle(): void {
  const active = session.value;
  if (active) saveTextFile(bundleFileName(active.bundle), signingFileText(active.bundle));
}

function discard(): void {
  if (sessionKey.value) clearSpendSession(sessionKey.value);
  review.value = null;
  signError.value = null;
}

watch(ready, current => {
  if (!current) return;
  void loadUtxos();
  void refreshReview();
}, { immediate: true });
</script>

<style scoped>
.gerovault-spend {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
  max-width: var(--g-content-max);
}
.gerovault-spend__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--g-s-4);
}
.gerovault-spend__heading {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-2);
  min-width: 0;
}
.gerovault-spend__heading h1,
.gerovault-spend__vault-name,
.gerovault-spend__section-title {
  margin: 0;
}
.gerovault-spend__vault-name {
  overflow-wrap: anywhere;
}
.gerovault-spend__panel {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.gerovault-spend__balance {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.gerovault-spend__hint {
  margin: 0;
}
.gerovault-spend__form {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}
.gerovault-spend__recipient {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  margin: 0;
  padding: var(--g-s-3);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}
.gerovault-spend__recipient legend {
  padding: 0 var(--g-s-1);
}
.gerovault-spend__token {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--g-s-2);
}
.gerovault-spend__row-actions,
.gerovault-spend__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--g-s-2);
}
.gerovault-spend__add {
  align-self: flex-start;
}
</style>
