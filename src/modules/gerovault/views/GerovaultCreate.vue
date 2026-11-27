<template>
  <div class="gerovault-create">
    <header class="gerovault-create__header">
      <div class="gerovault-create__title">
        <GButton tier="tertiary" compact :to="{ name: GEROVAULT_OVERVIEW_ROUTE }">
          <v-icon size="small" start aria-hidden="true">mdi-chevron-left</v-icon>{{ $t('common.back') }}
        </GButton>
        <h1 class="t-title">{{ $t('gerovault.createVault') }}</h1>
      </div>
      <div v-if="flow && !walletChanged" class="gerovault-create__tools">
        <CreateSteps :step="flow.step.value" :saved="flow.saved.value !== null" />
        <DetailsToggle v-model="detailsOn" :peeking="peeking" />
      </div>
    </header>

    <section v-if="!flow || walletChanged" class="glass-panel gerovault-create__unavailable" data-test="create-unavailable">
      <EmptyState icon="mdi-shield-plus-outline" :message="$t('gerovault.createUnavailable')" />
      <p class="t-body-sm gvc-muted">{{ $t(unavailableKey) }}</p>
    </section>

    <template v-else>
      <div class="gerovault-create__layout">
        <div class="gerovault-create__main">
          <TemplateStep v-if="flow.step.value === 'template'" :flow="flow" />
          <template v-else-if="flow.step.value === 'cosigners'">
            <OwnKeysCard :flow="flow" :key-source="keySource" :details="detailsVisible" @cancel-pending="cancelPending($event)" />
            <CosignerCard
              v-for="(draft, i) in flow.drafts.value"
              :key="draft.id"
              :flow="flow"
              :draft="draft"
              :reading="flow.readings.value[i]"
              :position="i + 2"
              :details="detailsVisible"
              :invite="inviteProps"
              @show-qr="qrOpen = true"
            />
            <GNote v-if="setupStarted" icon="mdi-information-outline" role="status" data-test="create-can-close">
              {{ $t('gerovault.invite.setup.canClose', { name: displayLabel(flow.setup.value?.name ?? '') }) }}
            </GNote>
            <GNote v-if="flow.inviteProblem.value && flow.inviteProblem.value.n === undefined && !flow.unlockProblem.value" tone="error" icon="mdi-alert-circle-outline" role="alert">
              {{ $t(inviteProblemKey(flow.inviteProblem.value.code)) }}
            </GNote>
            <GNote v-if="flow.buildProblem.value" tone="error" icon="mdi-alert-circle-outline" role="alert">
              {{ $t('gerovault.create.buildProblem', { code: flow.buildProblem.value }) }}
            </GNote>
          </template>
          <VerifyStep v-else :flow="flow" :details="detailsVisible" />
        </div>
        <aside class="gerovault-create__aside">
          <VaultSummary :flow="flow" :network-name="networkName" :details="detailsVisible" />
        </aside>
      </div>

      <GNote v-if="flow.saveProblem.value" tone="error" icon="mdi-alert-circle-outline" role="alert">
        {{ $t(saveProblemKey(flow.saveProblem.value), { code: flow.saveProblem.value }) }}
      </GNote>
      <footer class="gerovault-create__footer">
        <GButton v-if="flow.step.value !== 'template'" :disabled="flow.saved.value !== null || flow.building.value" data-test="create-back" @click="flow.back()">
          {{ $t('common.back') }}
        </GButton>
        <span v-else />
        <span class="gerovault-create__next">
        <GButton v-if="flow.step.value === 'cosigners' && setupStarted && !flow.cosignersReady.value" tier="secondary" :to="{ name: GEROVAULT_OVERVIEW_ROUTE }" data-test="create-done-for-now">
          {{ $t('gerovault.invite.setup.doneForNow') }}
        </GButton>
        <GButton
          v-if="flow.step.value === 'template'"
          tier="primary"
          :disabled="flow.templateIssue.value !== undefined"
          data-test="create-continue"
          @click="flow.goToCosigners()"
        >
          {{ $t('common.continue') }}
        </GButton>
        <GButton
          v-else-if="flow.step.value === 'cosigners'"
          tier="primary"
          :disabled="!flow.cosignersReady.value"
          :loading="flow.building.value"
          data-test="create-continue"
          @click="flow.goToVerify()"
        >
          {{ $t('common.continue') }}
        </GButton>
        <GButton v-else-if="flow.saved.value" tier="primary" :to="vaultRoute" data-test="create-open">
          {{ $t('gerovault.create.openVault') }}
        </GButton>
        <GButton v-else tier="primary" :loading="flow.saving.value" data-test="create-save" @click="flow.save()">
          {{ $t('gerovault.create.save') }}
        </GButton>
        </span>
      </footer>
      <InviteQrDialog v-if="qrOpen" :is-open="qrOpen" :flow="flow" :network="networkName" @close="qrOpen = false" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRoute } from 'vue-router';
import DetailsToggle from '@/shared/components/DetailsToggle.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import { useDetailsLayer } from '@/shared/composables/useDetailsLayer';
import { vaultStore } from '@/db/vaultStore';
import { walletStore } from '@/stores/walletStore';
import { GEROVAULT_OVERVIEW_ROUTE, GEROVAULT_VAULT_ROUTE } from '@/modules/gerovault/gerovaultRoutes';
import CosignerCard from '@/modules/gerovault/create/CosignerCard.vue';
import CreateSteps from '@/modules/gerovault/create/CreateSteps.vue';
import OwnKeysCard from '@/modules/gerovault/create/OwnKeysCard.vue';
import TemplateStep from '@/modules/gerovault/create/TemplateStep.vue';
import VaultSummary from '@/modules/gerovault/create/VaultSummary.vue';
import VerifyStep from '@/modules/gerovault/create/VerifyStep.vue';
import { createEligibility, type KeySource } from '@/modules/gerovault/create/eligibility';
import { UNAVAILABLE_KEYS, saveProblemKey } from '@/modules/gerovault/create/messages';
import { passKeyMultisigAccountKey, requestMultisigAccountKey } from '@/modules/gerovault/create/ownAccountKey';
import { OwnAccountKeyError } from '@/modules/gerovault/create/ownAccountKeyFlow';
import { useCreateVault } from '@/modules/gerovault/create/useCreateVault';
import { createVaultChainReader } from '@/modules/gerovault/chain/vaultChainReader';
import InviteQrDialog from '@/modules/gerovault/invites/InviteQrDialog.vue';
import { inviteClient, passKeyAuth, type InviteAuth } from '@/modules/gerovault/invites/inviteClient';
import { inviteProblemKey } from '@/modules/gerovault/invites/messages';
import { displayLabel } from '@/shared/gerovault';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { Contact } from '@/models/types';
import '@/modules/gerovault/create/createCard.css';

defineOptions({ name: 'GerovaultCreate' });

/**
 * Create a phase 1 vault (standard template) on preprod: name and threshold, this wallet's keys
 * and each cosigner's, the vault every cosigner builds from the same keys, the verification
 * ceremony, and the save. The logic is in `create/`; this page only lays the steps out.
 */
const eligibility = createEligibility(walletStore.loggedWallet);
const keySource: KeySource = eligibility.ok ? eligibility.keySource : 'password';
const { t } = useTranslation();
const route = useRoute();
// "Continue setup" from the Vaults overview: the setup this page reopens.
const resumeSetupId = typeof route.query['setup'] === 'string' && /^[0-9a-f]{32}$/.test(route.query['setup']) ? route.query['setup'] : undefined;

/** The credential of one invitation request: a password, the PassKey's root key bytes, or a Google session. */
async function inviteAuth(password: string): Promise<InviteAuth> {
  const wallet = walletStore.loggedWallet;
  if (!wallet || !eligibility.ok || wallet.id !== eligibility.walletId) throw new OwnAccountKeyError('not-found');
  if (keySource === 'passkey') return passKeyAuth(wallet);
  return keySource === 'password' ? { password } : {};
}

const flow = eligibility.ok
  ? useCreateVault({
    store: vaultStore,
    walletId: eligibility.walletId,
    network: eligibility.network,
    reader: createVaultChainReader(eligibility.network),
    unlockAccountKey: async (password: string) => {
      const wallet = walletStore.loggedWallet;
      if (!wallet || wallet.id !== eligibility.walletId) throw new OwnAccountKeyError('not-found');
      if (keySource === 'passkey') return passKeyMultisigAccountKey(wallet);
      return requestMultisigAccountKey(eligibility.walletId, keySource === 'password' ? password : undefined);
    },
    invites: {
      client: inviteClient,
      auth: inviteAuth,
      ...(resumeSetupId ? { resumeSetupId } : {}),
      untitledName: t('gerovault.invite.untitled'),
    },
  })
  : null;

// A clock for "expires in 6 d", ticking with the page.
const now = ref(Date.now());
const clock = setInterval(() => { now.value = Date.now(); }, 30_000);
onBeforeUnmount(() => clearInterval(clock));

const contacts = computed(() => Object.values((walletStore.contacts ?? {}) as Record<string, Contact>)
  .filter(c => typeof c?.name === 'string' && typeof c.address === 'string')
  .map(c => ({ name: c.name, address: c.address, ...(c.handle ? { handle: c.handle } : {}) })));

const inviteProps = computed(() => (eligibility.ok
  ? { walletId: eligibility.walletId, contacts: contacts.value, resolve: inviteClient.resolve, now: now.value }
  : undefined));

/** Someone was invited or joined: the setup waits in Vaults, and this screen can close. */
const setupStarted = computed(() => !!flow?.setup.value?.slots.some(s => s.status !== 'empty'));
const qrOpen = ref(false);

/** TOO_MANY_PENDING: cancel one of this device's open setups, then try again. */
async function cancelPending(setupId: string): Promise<void> {
  await inviteClient.cancelSetup(setupId).catch(() => undefined);
  if (flow) flow.inviteProblem.value = null;
  if (flow) flow.unlockProblem.value = null;
}

// The flow belongs to the wallet it started with; switching wallets mid-flow ends it.
const walletChanged = computed(() => eligibility.ok && walletStore.loggedWallet?.id !== eligibility.walletId);

const unavailableKey = computed(() => {
  if (walletChanged.value) return 'gerovault.create.unavailable.walletChanged';
  return eligibility.ok === false ? UNAVAILABLE_KEYS[eligibility.reason] : UNAVAILABLE_KEYS.NO_WALLET;
});

const networkName = computed(() => walletStore.loggedWallet?.network ?? '');

const vaultRoute = computed(() => {
  const saved = flow?.saved.value;
  return saved ? { name: GEROVAULT_VAULT_ROUTE, params: { vaultId: saved.vaultId } } : { name: GEROVAULT_OVERVIEW_ROUTE };
});

const { enabled: detailsOn, peeking, visible: detailsVisible } = useDetailsLayer('gerovault.create');
</script>

<style scoped>
.gerovault-create {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.gerovault-create__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--g-s-4);
}
.gerovault-create__title {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-2);
}
.gerovault-create__title h1 {
  margin: 0;
}
.gerovault-create__tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--g-s-4);
}
.gerovault-create__unavailable {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
  padding-bottom: var(--g-s-5);
}
.gerovault-create__layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 340px);
  align-items: start;
  gap: var(--g-s-4);
}
.gerovault-create__main,
.gerovault-create__aside {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  min-width: 0;
}
.gerovault-create__next {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
}
.gerovault-create__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
@media (max-width: 960px) {
  .gerovault-create__layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .gerovault-create__aside {
    order: -1;
  }
}
</style>
