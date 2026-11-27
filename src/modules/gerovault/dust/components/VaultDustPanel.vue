<template>
  <section class="vault-dust glass-panel" :aria-labelledby="headingId" data-test="vault-dust" :aria-busy="state === 'loading' ? 'true' : 'false'">
    <header class="vault-dust__head">
      <h2 :id="headingId" class="t-label">{{ $t('gerovault.dust.title') }}</h2>
      <GButton v-if="state === 'ready' || state === 'error'" tier="tertiary" compact data-test="vault-dust-refresh" @click="refresh()">
        <v-icon size="small" start aria-hidden="true">mdi-refresh</v-icon>{{ $t('gerovault.dust.refresh') }}
      </GButton>
    </header>
    <p class="t-body-sm vault-dust__intro">{{ $t('gerovault.dust.intro') }}</p>

    <p v-if="state === 'unavailable'" class="t-body-sm" data-test="vault-dust-unavailable">{{ $t('gerovault.dust.unavailable') }}</p>
    <div v-else-if="state === 'loading' || state === 'idle'" class="g-skeleton vault-dust__skeleton" role="status" :aria-label="$t('common.loading')"></div>
    <GNote v-else-if="state === 'error'" tone="error" icon="mdi-alert-circle-outline" role="alert" data-test="vault-dust-error">
      {{ $t('gerovault.dust.readFailed') }}
    </GNote>

    <template v-else>
      <dl class="vault-dust__rows">
        <div class="vault-dust__row">
          <dt class="t-body-sm">{{ $t('gerovault.dust.cnight') }}</dt>
          <dd class="t-body-sm g-num" data-test="vault-dust-cnight">{{ cnightText }}</dd>
        </div>
        <div class="vault-dust__row">
          <dt class="t-body-sm">{{ $t('gerovault.dust.stake.label') }}</dt>
          <dd class="t-body-sm" data-test="vault-dust-stake">{{ $t(stakeKey) }}</dd>
        </div>
        <div class="vault-dust__row vault-dust__row--stack">
          <dt class="t-body-sm">{{ $t('gerovault.dust.registration.label') }}</dt>
          <dd data-test="vault-dust-registration">
            <template v-if="registeredTo">
              <span class="t-caption">{{ $t('gerovault.dust.registration.to') }}</span>
              <ChunkedAddress :address="registeredTo" />
            </template>
            <span v-else class="t-body-sm">{{ $t('gerovault.dust.registration.none') }}</span>
          </dd>
        </div>
        <div class="vault-dust__row">
          <dt class="t-body-sm">{{ $t('gerovault.dust.midnight.label') }}</dt>
          <dd class="t-body-sm" data-test="vault-dust-generation">{{ $t(generationKey, { amount: capacityText }) }}</dd>
        </div>
      </dl>
      <GNote v-if="registeredTo && generation && !generation.registered" icon="mdi-timer-sand" role="status" data-test="vault-dust-pending">
        {{ $t('gerovault.dust.midnight.pending') }}
      </GNote>

      <!-- Proposals: each is built here and signed by the owners like a spend. -->
      <template v-if="!proposed">
        <div v-if="account?.registered !== true && registrations.length === 0" class="vault-dust__action">
          <p class="t-body-sm">{{ $t('gerovault.dust.stake.why', { amount: depositText }) }}</p>
          <GButton tier="secondary" :loading="busy === 'stake_register'" :disabled="!!busy" data-test="vault-dust-register-stake" @click="run({ kind: 'stake_register' })">
            {{ $t('gerovault.dust.action.registerStake') }}
          </GButton>
        </div>

        <div v-if="registrations.length === 0" class="vault-dust__action" data-test="vault-dust-register">
          <h3 class="t-body vault-dust__subtitle">{{ $t('gerovault.dust.register.title') }}</h3>
          <ul class="vault-dust__facts t-body-sm">
            <li>{{ $t('gerovault.dust.fact.key') }}</li>
            <li>{{ $t('gerovault.dust.fact.activation') }}</li>
            <li>{{ $t('gerovault.dust.fact.forks') }}</li>
            <li>{{ $t('gerovault.dust.fact.collateral') }}</li>
          </ul>
          <p v-if="destinations.length === 0" class="t-body-sm" data-test="vault-dust-no-destination">{{ $t('gerovault.dust.picker.none') }}</p>
          <template v-else>
            <v-select
              v-model="destinationKey"
              :items="destinationItems"
              :label="$t('gerovault.dust.picker.label')"
              variant="outlined"
              density="compact"
              hide-details="auto"
              attach
              data-test="vault-dust-destination"
            />
            <ChunkedAddress v-if="chosen" :address="chosen.dustAddress" />
          </template>
          <p v-if="account?.registered === false" class="t-caption">{{ $t('gerovault.dust.stakeFirst') }}</p>
          <GButton
            tier="primary"
            :disabled="!chosen || account?.registered === false || !!busy"
            :loading="busy === 'dust_register'"
            data-test="vault-dust-register-dust"
            @click="chosen && run({ kind: 'dust_register', dustAddress: chosen.dustAddress })"
          >
            {{ $t('gerovault.dust.action.registerDust') }}
          </GButton>
        </div>

        <div v-else class="vault-dust__action" data-test="vault-dust-deregister">
          <!-- Until a preprod test shows otherwise, removing the registration may not stop generation. -->
          <GNote v-if="registeredTo" icon="mdi-information-outline" role="status" data-test="vault-dust-keeps-going">
            {{ $t('gerovault.dust.keepsGoing', { address: registeredTo }) }}
          </GNote>
          <v-checkbox v-model="alsoStake" density="compact" hide-details color="primary" :disabled="!!busy" data-test="vault-dust-also-stake">
            <template #label>
              <span class="t-body-sm">{{ $t('gerovault.dust.action.alsoStake', { amount: depositText }) }}</span>
            </template>
          </v-checkbox>
          <GButton
            tier="secondary"
            :disabled="!!busy"
            :loading="busy === 'dust_deregister'"
            data-test="vault-dust-deregister-dust"
            @click="run({ kind: 'dust_deregister', deregisterStake: alsoStake })"
          >
            {{ $t('gerovault.dust.action.deregister') }}
          </GButton>
        </div>

        <div v-if="account?.registered === true && registrations.length === 0" class="vault-dust__action">
          <GButton tier="tertiary" :disabled="!!busy" :loading="busy === 'stake_deregister'" data-test="vault-dust-deregister-stake" @click="run({ kind: 'stake_deregister' })">
            {{ $t('gerovault.dust.action.deregisterStake', { amount: depositText }) }}
          </GButton>
        </div>

        <GNote v-if="error" tone="error" icon="mdi-alert-circle-outline" role="alert" data-test="vault-dust-build-error">{{ error }}</GNote>
      </template>

      <section v-else class="vault-dust__proposed" role="status" data-test="vault-dust-proposed">
        <h3 class="t-body vault-dust__subtitle">{{ $t('gerovault.dust.proposed.title') }}</h3>
        <p class="t-body-sm">{{ $t('gerovault.dust.proposed.text') }}</p>
        <div class="vault-dust__buttons">
          <GButton tier="secondary" data-test="vault-dust-save" @click="saveProposal()">
            <v-icon size="small" start aria-hidden="true">mdi-download</v-icon>{{ $t('gerovault.dust.proposed.save') }}
          </GButton>
          <GButton tier="primary" :to="{ name: GEROVAULT_IMPORT_SIGNATURES_ROUTE, params: { vaultId: record?.vaultId } }" data-test="vault-dust-collect">
            {{ $t('gerovault.dust.proposed.collect') }}
          </GButton>
        </div>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, toRef, useId, watch } from 'vue';
import type { Cardano } from '@cardano-sdk/core';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatLovelaceAsAda } from '@/shared/utils/format';
import type { UnsignedTxBundle, VaultRecord } from '@/modules/gerovault/contracts';
import { GEROVAULT_IMPORT_SIGNATURES_ROUTE } from '@/modules/gerovault/gerovaultRoutes';
import { bundleFileName, signingFileText } from '@/modules/gerovault/spend/bundle';
import { errorText } from '@/modules/gerovault/spend/display';
import { saveTextFile } from '@/modules/gerovault/spend/files';
import ChunkedAddress from '@/modules/gerovault/spend/components/ChunkedAddress.vue';
import { networkStore } from '@/stores/networkStore';
import type { OperationRequest } from '../buildOperation';
import { useVaultDust } from '../useVaultDust';

defineOptions({ name: 'VaultDustPanel' });

const props = defineProps<{ record: VaultRecord | undefined; utxos: readonly Cardano.Utxo[] }>();

const { t } = useTranslation();
const headingId = useId();
const { state, account, registrations, registeredTo, generation, generationError, cnight, destinations, refresh, propose } =
  useVaultDust(toRef(props, 'record'), toRef(props, 'utxos'));

/** NIGHT has six decimals, as ADA. */
const cnightText = computed(() => (cnight.value > 0n ? t('gerovault.dust.cnightAmount', { amount: formatLovelaceAsAda(cnight.value) }) : t('gerovault.dust.cnightNone')));
const depositText = computed(() => formatLovelaceAsAda(account.value?.deposit ?? BigInt(networkStore.epochParams?.stakeKeyDeposit ?? 2_000_000)));
const stakeKey = computed(() => (account.value?.registered === true
  ? 'gerovault.dust.stake.registered'
  : account.value?.registered === false ? 'gerovault.dust.stake.notRegistered' : 'gerovault.dust.stake.unknown'));
/** DUST has 15 decimals. */
const capacityText = computed(() => {
  const raw = generation.value?.currentCapacity;
  if (!raw || !/^[0-9]+$/.test(raw)) return '0';
  const value = BigInt(raw);
  const whole = value / 10n ** 15n;
  const fraction = ((value % 10n ** 15n) / 10n ** 9n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
});
const generationKey = computed(() => {
  if (generationError.value) return 'gerovault.dust.midnight.unknown';
  if (!generation.value) return 'gerovault.dust.midnight.unknown';
  return generation.value.registered ? 'gerovault.dust.midnight.active' : 'gerovault.dust.midnight.inactive';
});

const destinationKey = ref<string | null>(null);
const destinationItems = computed(() => destinations.value.map(d => ({ title: d.label, value: d.key })));
const chosen = computed(() => destinations.value.find(d => d.key === destinationKey.value) ?? null);
watch(destinations, list => {
  if (!list.some(d => d.key === destinationKey.value)) destinationKey.value = list[0]?.key ?? null;
}, { immediate: true });

const alsoStake = ref(false);
const busy = ref<OperationRequest['kind'] | null>(null);
const error = ref<string | null>(null);
const proposed = ref<UnsignedTxBundle | null>(null);
watch(() => props.record?.vaultId, () => {
  proposed.value = null;
  error.value = null;
});

async function run(request: OperationRequest): Promise<void> {
  if (busy.value) return;
  busy.value = request.kind;
  error.value = null;
  try {
    proposed.value = await propose(request);
  } catch (failure) {
    error.value = errorText(failure, t);
  } finally {
    busy.value = null;
  }
}

function saveProposal(): void {
  if (proposed.value) saveTextFile(bundleFileName(proposed.value), signingFileText(proposed.value));
}
</script>

<style scoped>
.vault-dust {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
  min-width: 0;
}
.vault-dust__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}
.vault-dust__head h2,
.vault-dust p,
.vault-dust__subtitle {
  margin: 0;
}
.vault-dust__intro {
  color: var(--g-text-2);
}
.vault-dust__skeleton {
  height: var(--g-btn-h);
}
.vault-dust__rows {
  display: flex;
  flex-direction: column;
  margin: 0;
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
}
.vault-dust__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--g-s-4);
  padding: var(--g-s-2) var(--g-s-3);
}
.vault-dust__row + .vault-dust__row {
  border-top: 1px solid var(--g-hairline-1);
}
.vault-dust__row--stack {
  flex-direction: column;
  align-items: stretch;
  gap: var(--g-s-1);
}
.vault-dust__row dd {
  margin: 0;
  min-width: 0;
  color: var(--g-text-1);
}
.vault-dust__action,
.vault-dust__proposed {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-2);
}
.vault-dust__facts {
  margin: 0;
  padding-left: var(--g-s-4);
  color: var(--g-text-2);
}
.vault-dust__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}
</style>
