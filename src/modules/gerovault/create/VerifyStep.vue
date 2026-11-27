<template>
  <div v-if="vault" class="verify-step">
    <!-- The vault every cosigner builds from the same keys. -->
    <section class="glass-panel gvc-card" :aria-labelledby="ids.vault" data-test="create-vault">
      <h2 :id="ids.vault" class="t-heading gvc-card__title">{{ $t('gerovault.create.vault.title') }}</h2>
      <dl class="gvc-facts t-body-sm">
        <dt>{{ $t('gerovault.vault.id') }}</dt>
        <dd class="g-mono">{{ details ? vault.vaultId : fingerprint(vault.vaultId) }}</dd>
        <dt>{{ $t('gerovault.create.vault.address') }}</dt>
        <dd class="g-mono verify-step__copyable">
          <span>{{ details ? vault.addresses.base : shortAddress(vault.addresses.base) }}</span>
          <CopyButton :value="String(vault.addresses.base)" x-small />
        </dd>
      </dl>
      <GNote v-if="addressActivity === 'used'" icon="mdi-alert-outline" role="status" data-test="create-address-used">
        {{ $t('gerovault.create.vault.addressUsed') }}
      </GNote>
      <p v-else-if="addressActivity === 'unreadable'" class="t-caption gvc-faint" data-test="create-address-unreadable">
        {{ $t('gerovault.create.vault.addressUnreadable') }}
      </p>
      <template v-if="details">
        <dl class="gvc-facts t-caption" data-test="create-vault-details">
          <dt>{{ $t('gerovault.create.vault.reward') }}</dt>
          <dd class="g-mono">{{ vault.addresses.reward }}</dd>
          <dt>{{ $t('gerovault.create.vault.paymentScriptHash') }}</dt>
          <dd class="g-mono">{{ vault.scripts.payment.hash }}</dd>
          <dt>{{ $t('gerovault.create.vault.stakeScriptHash') }}</dt>
          <dd class="g-mono">{{ vault.scripts.stake.hash }}</dd>
        </dl>
        <div v-for="script in scriptViews" :key="script.labelKey" class="verify-step__script">
          <span class="t-label">{{ $t(script.labelKey) }}</span>
          <pre class="gvc-mono-block g-mono t-caption">{{ $t('gerovault.create.vault.scriptText', { threshold: script.threshold, keys: script.keys }) }}</pre>
        </div>
      </template>
    </section>

    <!-- The ceremony: the same 40 digits and the same code on every cosigner's screen. -->
    <section class="glass-panel gvc-card" :aria-labelledby="ids.number" data-test="create-verification">
      <h2 :id="ids.number" class="t-heading gvc-card__title">
        {{ $t('gerovault.create.verify.number') }}
        <InfoTooltip :label="$t('gerovault.create.verify.number')" :text="$t('gerovault.create.verify.numberInfo')" />
      </h2>
      <template v-if="view">
        <ol class="verify-step__groups" :aria-label="$t('gerovault.create.verify.groupsLabel')" data-test="create-verify-number">
          <li v-for="(group, i) in view.groups" :key="i" class="t-heading g-mono">{{ group }}</li>
        </ol>
        <GNote icon="mdi-alert-outline" role="status">{{ $t('gerovault.create.verify.notRecoveryWords') }}</GNote>
        <VerificationQr :payload="view.qrPayload" :label="$t('gerovault.create.verify.qr')" />
        <p v-if="details" class="t-caption g-mono gvc-faint verify-step__digest">{{ view.digest }}</p>
      </template>
      <GNote v-else-if="noManifest === 'EXTERNAL_COSIGNERS'" icon="mdi-information-outline" role="status" data-test="create-verify-external">
        {{ $t('gerovault.create.verify.externalNote') }}
      </GNote>
      <GNote v-else-if="noManifest" tone="error" icon="mdi-alert-circle-outline" role="alert">
        {{ $t('gerovault.create.verify.ackRefused', { code: noManifest }) }}
      </GNote>
    </section>

    <!-- Who holds each key, and how this device verified them. -->
    <section class="glass-panel gvc-card" :aria-labelledby="ids.holders" data-test="create-holders">
      <div class="gvc-card__head">
        <h2 :id="ids.holders" class="t-heading gvc-card__title">{{ $t('gerovault.create.holders.title') }}</h2>
        <span class="t-caption g-mono gvc-faint">{{ $t('gerovault.create.holders.progress', { verified: verifiedCount, total: vault.cosigners.length }) }}</span>
      </div>
      <ul class="verify-step__holders">
        <li class="verify-step__holder">
          <span class="verify-step__avatar t-label" aria-hidden="true">{{ $t('gerovault.create.own.you').slice(0, 1) }}</span>
          <div class="verify-step__who">
            <span class="t-body">{{ $t('gerovault.create.own.you') }}</span>
            <span class="t-caption g-mono gvc-faint">{{ fingerprint(vault.own.hashes.payment) }}<template v-if="details"> {{ vault.own.paths.payment }}</template></span>
          </div>
          <span class="gvc-chip t-caption">{{ $t('gerovault.create.holders.yourKey') }}</span>
        </li>
        <li v-for="row in rows" :key="row.credential" class="verify-step__holder" :data-test="`create-holder-${row.credential}`">
          <span class="verify-step__avatar t-label" aria-hidden="true">{{ row.initial }}</span>
          <div class="verify-step__who">
            <span class="t-body">{{ row.label }}</span>
            <span class="t-caption g-mono gvc-faint">{{ fingerprint(row.credential) }}</span>
          </div>
          <div class="verify-step__actions">
            <template v-if="row.canVerify && !row.verified">
              <GButton v-if="confirming === row.credential" compact tier="tertiary" data-test="create-number-close" @click="confirming = null">{{ $t('common.cancel') }}</GButton>
              <template v-else>
                <GButton compact tier="secondary" data-test="create-number-match" @click="confirming = row.credential">{{ $t('gerovault.invite.verify.onACall') }}</GButton>
                <GButton compact tier="secondary" data-test="create-scan-qr" @click="scanning = row">{{ $t('gerovault.create.holders.scanQr') }}</GButton>
              </template>
            </template>
            <span class="gvc-chip t-caption" :class="row.verified ? 'gvc-chip--ok' : 'gvc-chip--wait'">{{ $t(row.stateKey) }}</span>
          </div>
          <!-- The number read in turns: this side reads 1 to 4 and ticks 5 to 8 (GV-61, UX rule 8). -->
          <VerifyTogether
            v-if="view && confirming === row.credential && !row.verified"
            class="verify-step__together"
            :groups="view.groups"
            role="initiator"
            :peer="row.rawLabel"
            :can-cancel="flow.setup.value?.state === 'open'"
            @confirm="confirmNumber(row.credential)"
            @cancel-setup="cancelSetup()"
          />
        </li>
      </ul>
    </section>

    <!-- Funding waits for the library's gate, whatever the amount. -->
    <div class="verify-step__funding">
      <GNote v-if="!fundingOpen" icon="mdi-lock-outline" role="status">{{ $t('gerovault.create.funding.closed') }}</GNote>
      <p v-else class="t-body-sm gvc-muted" role="status">{{ $t('gerovault.create.funding.open') }}</p>
      <GButton tier="secondary" :disabled="!fundingOpen || !saved" data-test="create-fund" :to="saved && fundingOpen ? vaultRoute : undefined">
        {{ $t('gerovault.create.funding.fund') }}
      </GButton>
    </div>

    <!-- After the save: open the vault, or publish its registration. -->
    <section v-if="saved" class="glass-panel gvc-card" :aria-labelledby="ids.saved" data-test="create-saved">
      <h2 :id="ids.saved" class="t-heading gvc-card__title">
        <v-icon size="small" color="success" aria-hidden="true">mdi-check-circle-outline</v-icon>{{ $t('gerovault.create.saved') }}
      </h2>
      <div class="verify-step__registration">
        <div>
          <span class="t-label">{{ $t('gerovault.create.registration.title') }}</span>
          <InfoTooltip :label="$t('gerovault.create.registration.title')" :text="$t('gerovault.create.registration.info')" />
          <p v-if="registrationTx" class="t-caption g-mono gvc-faint" data-test="create-registration-done">
            {{ $t('gerovault.create.registration.done', { txId: fingerprint(registrationTx) }) }}
          </p>
        </div>
        <GButton tier="secondary" :disabled="!!registrationTx" data-test="create-register" @click="registering = true">
          {{ $t('gerovault.create.registration.publish') }}
        </GButton>
      </div>
    </section>

    <QrScanDialog :is-open="scanning !== null" :label="scanning?.label ?? ''" :check="checkQr" @close="scanning = null" />
    <RegistrationDialog
      v-if="registering"
      :is-open="registering"
      :scripts="vault.scripts"
      @close="registering = false"
      @submitted="registrationTx = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, useId } from 'vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import InfoTooltip from '@/shared/components/InfoTooltip.vue';
import { displayLabel } from '@/shared/gerovault';
import { GEROVAULT_OVERVIEW_ROUTE, GEROVAULT_VAULT_ROUTE } from '@/modules/gerovault/gerovaultRoutes';
import { fingerprint, scriptKeys } from './createVault';
import { COSIGNER_STATE_KEYS, QR_REFUSAL_KEYS, VERIFIED_BY_KEYS } from './messages';
import QrScanDialog from './QrScanDialog.vue';
import RegistrationDialog from './RegistrationDialog.vue';
import VerificationQr from './VerificationQr.vue';
import VerifyTogether from '@/modules/gerovault/invites/VerifyTogether.vue';
import { useRouter } from 'vue-router';
import type { CreateVaultFlow } from './useCreateVault';

const props = defineProps<{ flow: CreateVaultFlow; details: boolean }>();
const { vault, view, manifestState, verification, saved, addressActivity } = props.flow;

interface HolderRow {
  readonly credential: string;
  readonly label: string;
  /** The label as stored, for components that isolate it themselves. */
  readonly rawLabel: string;
  readonly initial: string;
  /** A Gero cosigner, verified by the number or the QR. External cosigners verify with a file. */
  readonly canVerify: boolean;
  readonly verified: boolean;
  readonly stateKey: string;
}

const rows = computed<HolderRow[]>(() => {
  const current = vault.value;
  if (!current) return [];
  return current.cosigners.map(c => {
    const status = verification.value?.cosigners.find(s => s.credential === c.hashes.payment);
    const verified = status?.state === 'verified';
    const external = c.source === 'external';
    const stateKey = verified && status?.method
      ? VERIFIED_BY_KEYS[status.method]
      : external ? COSIGNER_STATE_KEYS.importerOnly : COSIGNER_STATE_KEYS[status?.state ?? 'unverified'];
    return {
      credential: c.hashes.payment,
      label: displayLabel(c.label),
      rawLabel: c.label,
      initial: [...c.label][0]?.toUpperCase() ?? '?',
      canVerify: !external && view.value !== null,
      verified,
      stateKey,
    };
  });
});

/** Why there is no verification number: external cosigners, or this device's refusal code. */
const noManifest = computed(() => {
  const state = manifestState.value;
  if (state?.ok !== false) return undefined;
  return state.reason === 'ACK_REFUSED' ? state.code : state.reason;
});

const verifiedCount = computed(() => verification.value?.verified ?? 0);
const fundingOpen = computed(() => verification.value?.fundingOpen === true);
const vaultRoute = computed(() => (vault.value ? { name: GEROVAULT_VAULT_ROUTE, params: { vaultId: vault.value.vaultId } } : undefined));

const scriptViews = computed(() => {
  const current = vault.value;
  if (!current) return [];
  return [
    { labelKey: 'gerovault.create.vault.paymentScript', script: current.scripts.payment },
    { labelKey: 'gerovault.create.vault.stakeScript', script: current.scripts.stake },
  ].map(({ labelKey, script }) => {
    const { threshold, keys } = scriptKeys(script);
    return { labelKey, threshold, keys: keys.map(fingerprint).join(', ') };
  });
});

function shortAddress(address: string): string {
  return address.length > 24 ? `${address.slice(0, 14)}...${address.slice(-8)}` : address;
}

const confirming = ref<string | null>(null);
const scanning = ref<HolderRow | null>(null);
const registering = ref(false);
const registrationTx = ref('');

async function confirmNumber(credential: string): Promise<void> {
  confirming.value = null;
  await props.flow.confirmNumber(credential);
}

const router = useRouter();

/** "Doesn't match": the setup stops (its invitations end, this wallet's index is released). */
async function cancelSetup(): Promise<void> {
  confirming.value = null;
  if (await props.flow.cancelSetup()) await router.push({ name: GEROVAULT_OVERVIEW_ROUTE });
}

async function checkQr(payload: string): Promise<string | undefined> {
  const row = scanning.value;
  if (!row) return QR_REFUSAL_KEYS.MALFORMED_QR;
  const refusal = await props.flow.applyQr(row.credential, payload);
  return refusal ? QR_REFUSAL_KEYS[refusal] : undefined;
}

const base = useId();
const ids = reactive({ vault: `${base}-vault`, number: `${base}-number`, holders: `${base}-holders`, saved: `${base}-saved` });
</script>

<style scoped>
.verify-step {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}
.verify-step__copyable {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--g-s-1);
}
.verify-step__script {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.verify-step__groups {
  display: grid;
  grid-template-columns: repeat(4, max-content);
  justify-content: center;
  gap: var(--g-s-2) var(--g-s-5);
  margin: 0;
  padding: var(--g-s-4);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  list-style: none;
  color: var(--g-text-1);
}
.verify-step__digest {
  overflow-wrap: anywhere;
}
.verify-step__holders {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
.verify-step__holder {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--g-s-3);
  padding: var(--g-s-3) 0;
  border-top: 1px solid var(--g-hairline-1);
}
.verify-step__holder:first-child {
  border-top: 0;
}
.verify-step__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-pill);
  color: var(--g-text-2);
}
.verify-step__who {
  display: flex;
  flex: 1 1 160px;
  flex-direction: column;
  min-width: 0;
}
.verify-step__together {
  flex: 1 1 100%;
}
.verify-step__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}
.verify-step__funding {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--g-s-3);
}
.verify-step__funding :deep(.g-note) {
  flex: 1 1 280px;
}
.verify-step__registration {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--g-s-3);
}
@media (max-width: 520px) {
  .verify-step__groups {
    grid-template-columns: repeat(2, max-content);
  }
}
</style>
