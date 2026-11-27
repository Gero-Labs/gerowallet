<template>
  <!-- The panel's staking, as the dashboard's SolanaStakingCard shows it: the account's stake
       accounts (Nexus /stakes) with Stake, Unstake and Withdraw in a sheet. -->
  <section class="sol-stk" data-test="sol-panel-staking">
    <div class="sol-stk__header">
      <span class="t-heading">{{ $t('solana.staking.title') }}</span>
      <GButton tier="secondary" compact :disabled="!info" data-test="sol-panel-stake" @click="open('stake')">
        {{ $t('solana.staking.stake') }}
      </GButton>
    </div>

    <div v-if="stakes && stakes.accounts.length" class="sol-stk__summary t-caption">
      <span>{{ $t('solana.staking.staked') }}</span>
      <span class="g-num sol-stk__total" data-test="sol-panel-staked-total">{{ hide ? '••••' : formatSol(totalStakedLamports(stakes.accounts)) }} {{ ticker }}</span>
    </div>
    <span v-if="info" class="t-caption sol-stk__line">{{ $t('solana.staking.epoch', { epoch: info.epoch, percent: epochPercent }) }}</span>

    <div v-if="failed && (!stakes || !info)" class="sol-stk__failed sol-stk__line" role="alert">
      <span class="t-caption">{{ $t('solana.staking.loadFailed') }}</span>
      <GButton tier="tertiary" compact :loading="loading" @click="load()">{{ $t('common.retry') }}</GButton>
    </div>
    <p v-if="stakes && !stakes.accounts.length" class="t-caption sol-stk__line sol-stk__empty">{{ $t('solana.staking.empty', { ticker }) }}</p>
    <ul v-else-if="stakes" class="sol-stk__list">
      <li v-for="account in stakes.accounts" :key="account.address" class="sol-stk__row" data-test="sol-panel-stake-row">
        <div class="sol-stk__main">
          <span class="sol-stk__name">{{ stakeValidatorName(account, byVote) }}</span>
          <span :class="['t-caption', `sol-stk__state--${account.state}`]">
            {{ $t(stakeStateKey(account.state)) }}<template v-if="account.lockedUp"> · {{ $t('solana.staking.lockedUp') }}</template>
          </span>
        </div>
        <span class="g-num sol-stk__value">{{ hide ? '••••' : formatSol(account.lamports) }} {{ ticker }}</span>
        <div v-if="actionsOf(account).unstake || actionsOf(account).withdraw" class="sol-stk__actions">
          <GButton v-if="actionsOf(account).unstake" tier="tertiary" compact data-test="sol-panel-unstake" @click="open('unstake', account)">
            {{ $t('solana.staking.unstake') }}
          </GButton>
          <GButton v-if="actionsOf(account).withdraw" tier="tertiary" compact data-test="sol-panel-withdraw" @click="open('withdraw', account)">
            {{ $t('solana.staking.withdraw') }}
          </GButton>
        </div>
      </li>
    </ul>
    <span v-if="stakes?.truncated" class="t-caption sol-stk__line">{{ $t('solana.staking.truncated') }}</span>
    <span v-if="namedValidators" class="t-caption sol-stk__line">{{ $t('solana.staking.selfDeclared') }}</span>

    <SolanaStakeSheet
      v-model="sheetOpen"
      :action="sheetAction"
      :account="sheetAccount"
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
import SolanaStakeSheet from './flows/SolanaStakeSheet.vue';
import { useSolanaStaking } from '@/shared/composables/useSolanaStaking';
import { formatSol } from '@/chains/solana/solanaAmount';
import {
  stakeActions,
  stakeStateKey,
  stakeValidatorName,
  totalStakedLamports,
  type SolanaStakeAccount,
} from '@/chains/solana/solanaStaking';
import type { SolanaStakeAction } from '@/chains/solana/solanaStakeTransfer';

const { stakes, validators, info, byVote, loading, failed, validatorsFailed, load, reloadAfterAction, ensureValidators, owner } = useSolanaStaking();

const ticker = computed(() => networks.resolveCurrencyTicker(walletStore.loggedWallet?.chain, walletStore.loggedWallet?.network));
const hide = computed(() => walletStore.config?.hideBalances || false);
const epochPercent = computed(() => (info.value ? Math.floor((info.value.slotIndex * 100) / info.value.slotsInEpoch) : 0));
const namedValidators = computed(() => !!stakes.value?.accounts.some((a) => a.voter && byVote.value.get(a.voter)?.name));

const sheetOpen = ref(false);
const sheetAction = ref<SolanaStakeAction>('stake');
const sheetAccount = shallowRef<SolanaStakeAccount | null>(null);

function open(action: SolanaStakeAction, account: SolanaStakeAccount | null = null): void {
  if (action === 'stake') ensureValidators();
  sheetAction.value = action;
  sheetAccount.value = account;
  sheetOpen.value = true;
}

function actionsOf(account: SolanaStakeAccount) {
  return stakeActions(account, owner.value);
}
</script>

<style scoped>
.sol-stk {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.sol-stk__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--g-s-4) var(--g-s-4) var(--g-s-2);
}

.sol-stk__summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 var(--g-s-4);
}

.sol-stk__total {
  color: var(--g-text-1);
  font-weight: 600;
}

.sol-stk__line {
  margin: 0;
  padding: 0 var(--g-s-4);
}

.sol-stk__failed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.sol-stk__empty {
  color: var(--g-text-3);
}

.sol-stk__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sol-stk__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-1) var(--g-s-2);
  margin: 2px var(--g-s-2);
  padding: 10px var(--g-s-4);
  border-top: 1px solid var(--g-hairline-1);
  font-size: 13px;
}

.sol-stk__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.sol-stk__name {
  overflow: hidden;
  color: var(--g-text-1);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sol-stk__value {
  color: var(--g-text-2);
  text-align: right;
}

.sol-stk__state--active {
  color: var(--g-success);
}

.sol-stk__state--activating,
.sol-stk__state--deactivating {
  color: var(--g-warning);
}

.sol-stk__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--g-s-2);
  width: 100%;
}
</style>
