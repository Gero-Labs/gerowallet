<template>
  <!-- The account's native stake accounts (Nexus /stakes) with Stake, Unstake and Withdraw. -->
  <section class="glass-panel sol-card" data-test="sol-staking">
    <div class="sol-card__header">
      <span class="t-heading">{{ $t('solana.staking.title') }}</span>
      <GButton tier="primary" compact :disabled="!info" data-test="sol-stake-open" @click="open('stake')">
        {{ $t('solana.staking.stake') }}
      </GButton>
    </div>

    <div v-if="stakes && stakes.accounts.length" class="sol-staking__summary">
      <div class="sol-staking__figure">
        <span class="t-label">{{ $t('solana.staking.staked') }}</span>
        <span class="g-num sol-staking__value" data-test="sol-staked-total">{{ hide ? '••••' : formatSol(totalStakedLamports(stakes.accounts)) }} {{ ticker }}</span>
      </div>
      <div class="sol-staking__figure">
        <span class="t-label">{{ $t('solana.staking.earning') }}</span>
        <span class="g-num sol-staking__value">{{ hide ? '••••' : formatSol(totalActiveLamports(stakes.accounts)) }} {{ ticker }}</span>
      </div>
    </div>
    <span v-if="info" class="t-caption" data-test="sol-epoch">{{ $t('solana.staking.epoch', { epoch: info.epoch, percent: epochPercent }) }}</span>

    <div v-if="failed && (!stakes || !info)" class="sol-staking__failed" role="alert">
      <span class="t-caption">{{ $t('solana.staking.loadFailed') }}</span>
      <GButton tier="tertiary" compact :loading="loading" @click="load()">{{ $t('common.retry') }}</GButton>
    </div>
    <p v-if="stakes && !stakes.accounts.length" class="t-caption sol-empty">{{ $t('solana.staking.empty', { ticker }) }}</p>
    <ul v-else-if="stakes" class="sol-list">
      <li v-for="account in stakes.accounts" :key="account.address" class="sol-stake-row" data-test="sol-stake-row">
        <div class="sol-stake-row__main">
          <span class="sol-stake-row__validator">{{ validatorName(account) }}</span>
          <a
            :href="solscanUrl('account', account.address, networkName)"
            target="_blank"
            rel="noopener noreferrer"
            class="t-caption g-mono sol-stake-row__address"
            :title="account.address"
          >{{ shortId(account.address) }}</a>
        </div>
        <div class="sol-stake-row__side">
          <span class="g-num sol-stake-row__amount">{{ hide ? '••••' : formatSol(account.lamports) }} {{ ticker }}</span>
          <span :class="['t-caption', 'sol-stake-row__state', `sol-stake-row__state--${account.state}`]">
            {{ $t(stakeStateKey(account.state)) }}<template v-if="account.lockedUp"> · {{ $t('solana.staking.lockedUp') }}</template>
          </span>
        </div>
        <div v-if="actionsOf(account).unstake || actionsOf(account).withdraw" class="sol-stake-row__actions">
          <GButton v-if="actionsOf(account).unstake" tier="secondary" compact data-test="sol-unstake" @click="open('unstake', account)">
            {{ $t('solana.staking.unstake') }}
          </GButton>
          <GButton v-if="actionsOf(account).withdraw" tier="secondary" compact data-test="sol-withdraw" @click="open('withdraw', account)">
            {{ $t('solana.staking.withdraw') }}
          </GButton>
        </div>
      </li>
    </ul>
    <span v-if="stakes?.truncated" class="t-caption">{{ $t('solana.staking.truncated') }}</span>
    <span v-if="stakes?.accounts.some((a) => a.voter && byVote.get(a.voter)?.name)" class="t-caption">{{ $t('solana.staking.selfDeclared') }}</span>

    <SolanaStakeDialog
      v-model="dialogOpen"
      :action="dialogAction"
      :account="dialogAccount"
      :validators="validators"
      :validators-failed="validatorsFailed"
      :info="info"
      @done="reloadAfterAction()"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { walletStore } from '@/stores/walletStore';
import networks from '@/utils/networks';
import GButton from '@/shared/components/GButton/GButton.vue';
import SolanaStakeDialog from '@/modules/transactions/dialogs/SolanaStakeDialog.vue';
import { useSolanaStaking } from '@/shared/composables/useSolanaStaking';
import { formatSol } from '@/chains/solana/solanaAmount';
import { solscanUrl } from '@/chains/solana/solanaExplorer';
import {
  stakeActions,
  stakeStateKey,
  totalActiveLamports,
  totalStakedLamports,
  type SolanaStakeAccount,
} from '@/chains/solana/solanaStaking';
import type { SolanaStakeAction } from '@/chains/solana/solanaStakeTransfer';

const { stakes, validators, info, byVote, loading, failed, validatorsFailed, load, reloadAfterAction, owner } = useSolanaStaking();

const networkName = computed(() => walletStore.loggedWallet?.network ?? '');
const ticker = computed(() => networks.resolveCurrencyTicker(walletStore.loggedWallet?.chain, networkName.value));
const hide = computed(() => walletStore.config?.hideBalances || false);
const epochPercent = computed(() => (info.value ? Math.floor((info.value.slotIndex * 100) / info.value.slotsInEpoch) : 0));

const dialogOpen = ref(false);
const dialogAction = ref<SolanaStakeAction>('stake');
const dialogAccount = shallowRef<SolanaStakeAccount | null>(null);

function open(action: SolanaStakeAction, account: SolanaStakeAccount | null = null): void {
  dialogAction.value = action;
  dialogAccount.value = account;
  dialogOpen.value = true;
}

function actionsOf(account: SolanaStakeAccount) {
  return stakeActions(account, owner.value);
}

function shortId(id: string): string {
  return `${id.slice(0, 6)}…${id.slice(-6)}`;
}

/** The validator's published name (self-declared), else its vote account; none when undelegated. */
function validatorName(account: SolanaStakeAccount): string {
  if (!account.voter) return '—';
  return byVote.value.get(account.voter)?.name ?? shortId(account.voter);
}
</script>

<style scoped>
.sol-card {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  height: 100%;
  padding: var(--g-s-4);
}

.sol-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.sol-staking__summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-6);
}

.sol-staking__figure {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.sol-staking__value {
  color: var(--g-text-1);
  font-weight: 600;
}

.sol-staking__failed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.sol-empty {
  margin: 0;
}

.sol-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sol-stake-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-2) var(--g-s-3);
  padding: var(--g-s-3) 0;
  border-top: 1px solid var(--g-hairline-1);
}

.sol-stake-row__main {
  display: flex;
  flex: 1 1 160px;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.sol-stake-row__validator {
  overflow: hidden;
  color: var(--g-text-1);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sol-stake-row__address {
  color: var(--g-text-3);
}

.sol-stake-row__side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.sol-stake-row__amount {
  color: var(--g-text-1);
}

.sol-stake-row__state--active {
  color: var(--g-success);
}

.sol-stake-row__state--activating,
.sol-stake-row__state--deactivating {
  color: var(--g-warning);
}

.sol-stake-row__actions {
  display: flex;
  gap: var(--g-s-2);
}
</style>
