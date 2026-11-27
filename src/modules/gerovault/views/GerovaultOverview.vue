<template>
  <div class="gerovault-page">
    <header class="gerovault-page__header">
      <div class="gerovault-page__title">
        <h1 class="t-title">{{ $t('gerovault.title') }}</h1>
        <InfoTooltip :label="$t('gerovault.about.label')" :text="$t('gerovault.about.text')" />
      </div>
      <div class="gerovault-page__actions">
        <DetailsToggle v-model="detailsOn" :peeking="peeking" />
        <GButton tier="secondary" :disabled="state === 'noWallet'" data-test="overview-import" @click="importOpen = true">
          {{ $t('gerovault.importPackage') }}
        </GButton>
        <GButton tier="primary" :to="{ name: GEROVAULT_CREATE_ROUTE }" data-test="overview-create">{{ $t('gerovault.createVault') }}</GButton>
      </div>
    </header>

    <VaultInvitationsPanel
      v-if="state !== 'noWallet'"
      :wallet-id="eligibility.ok ? eligibility.walletId : null"
      :key-source="eligibility.ok ? eligibility.keySource : null"
      :client="inviteClient"
      :auth="inviteAuth"
      :unlock-account-key="unlockAccountKey"
      :store="vaultStore"
    />

    <div v-if="state === 'loading'" class="g-skeleton gerovault-page__skeleton" role="status" :aria-label="$t('common.loading')"></div>
    <section v-else-if="state === 'unavailable'" class="glass-panel" data-test="overview-unavailable">
      <ErrorState :message="$t('gerovault.detail.storeUnavailable')" retryable @retry="reload()" />
    </section>
    <section v-else-if="state === 'noWallet'" class="glass-panel">
      <EmptyState icon="mdi-wallet-outline" :message="$t('gerovault.detail.noWallet')" />
    </section>
    <section v-else-if="vaults.length === 0" class="glass-panel" data-test="overview-empty">
      <EmptyState icon="mdi-shield-lock-outline" :message="$t('gerovault.detail.overview.empty')" />
    </section>

    <template v-else>
      <ul v-if="accepted.length > 0" class="gerovault-page__list" data-test="overview-accepted">
        <li v-for="vault in accepted" :key="vault.vaultId">
          <VaultListCard :record="vault" :wallet-network="walletNetwork" :details-visible="detailsVisible" />
        </li>
      </ul>

      <!-- Quarantined vaults: shown for review, never funded from this wallet, never signed for. -->
      <section v-if="candidates.length > 0" class="gerovault-page__candidates" data-test="overview-candidates">
        <div class="gerovault-page__section-title">
          <h2 class="t-label">{{ $t('gerovault.detail.overview.candidates') }}</h2>
          <InfoTooltip :label="$t('gerovault.detail.candidate.aboutLabel')" :text="$t('gerovault.detail.candidate.about')" />
        </div>
        <ul class="gerovault-page__list">
          <li v-for="vault in candidates" :key="vault.vaultId">
            <VaultListCard :record="vault" :wallet-network="walletNetwork" :details-visible="detailsVisible" />
          </li>
        </ul>
      </section>
    </template>

    <RecoveryImportDialog v-if="importOpen" :is-open="importOpen" @close="importOpen = false" @saved="onSaved" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import DetailsToggle from '@/shared/components/DetailsToggle.vue';
import InfoTooltip from '@/shared/components/InfoTooltip.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import { useDetailsLayer } from '@/shared/composables/useDetailsLayer';
import { GEROVAULT_CREATE_ROUTE } from '@/modules/gerovault/gerovaultRoutes';
import { useGerovaultWallet } from '@/modules/gerovault/detail/context';
import { useVaultList } from '@/modules/gerovault/detail/useVaults';
import VaultListCard from '@/modules/gerovault/detail/components/VaultListCard.vue';
import RecoveryImportDialog from '@/modules/gerovault/recovery/RecoveryImportDialog.vue';
import VaultInvitationsPanel from '@/modules/gerovault/invites/VaultInvitationsPanel.vue';
import { inviteClient, passKeyAuth, type InviteAuth } from '@/modules/gerovault/invites/inviteClient';
import { createEligibility } from '@/modules/gerovault/create/eligibility';
import { passKeyMultisigAccountKey, requestMultisigAccountKey } from '@/modules/gerovault/create/ownAccountKey';
import { OwnAccountKeyError } from '@/modules/gerovault/create/ownAccountKeyFlow';
import { vaultStore } from '@/db/vaultStore';
import { walletStore } from '@/stores/walletStore';
import type { MultisigAccountPublicKey } from '@/shared/gerovault';

defineOptions({ name: 'GerovaultOverview' });

const { enabled: detailsOn, peeking, visible: detailsVisible } = useDetailsLayer('gerovault.overview');

const wallet = useGerovaultWallet();
const walletNetwork = computed(() => wallet()?.network);
const { state, vaults, accepted, candidates, reload } = useVaultList();

const importOpen = ref(false);

// Invitations answer with the logged wallet, behind its own credential (as the create flow).
const eligibility = computed(() => createEligibility(walletStore.loggedWallet));

async function inviteAuth(password: string): Promise<InviteAuth> {
  const e = eligibility.value;
  const logged = walletStore.loggedWallet;
  if (!e.ok || !logged) throw new OwnAccountKeyError('not-found');
  if (e.keySource === 'passkey') return passKeyAuth(logged);
  return e.keySource === 'password' ? { password } : {};
}

async function unlockAccountKey(password: string): Promise<MultisigAccountPublicKey> {
  const e = eligibility.value;
  const logged = walletStore.loggedWallet;
  if (!e.ok || !logged) throw new OwnAccountKeyError('not-found');
  if (e.keySource === 'passkey') return passKeyMultisigAccountKey(logged);
  return requestMultisigAccountKey(e.walletId, e.keySource === 'password' ? password : undefined);
}

/** A restored vault was kept or accepted: show it in the list. */
function onSaved(): void {
  void reload();
}
</script>

<style scoped>
.gerovault-page {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}
.gerovault-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--g-s-4);
}
.gerovault-page__title {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  min-width: 0;
}
.gerovault-page__title h1 {
  margin: 0;
}
.gerovault-page__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--g-s-3);
}
.gerovault-page__skeleton {
  height: calc(var(--g-row-h-panel) * 2);
}
.gerovault-page__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}
.gerovault-page__candidates {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.gerovault-page__section-title {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
}
.gerovault-page__section-title h2 {
  margin: 0;
}
</style>
