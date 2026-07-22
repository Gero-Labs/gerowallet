<template>
  <BaseDialog
    :is-open="value" :title="$t('poolOperator.wizardTitle')" icon="mdi-server-network"
    size="md" :persistent="busy" @close="close"
  >
    <div class="pa-4">
      <!-- Progress dots -->
      <div class="wizard-dots mb-5">
        <div v-for="(s, i) in steps" :key="s.id" class="wizard-dot-wrap">
          <div class="wizard-dot" :class="{ active: i === currentIndex, done: isDone(s.id) }">
            <v-icon v-if="isDone(s.id)" x-small color="white">mdi-check</v-icon>
            <span v-else>{{ i + 1 }}</span>
          </div>
          <span class="wizard-dot-label t-label">{{ $t(s.labelKey) }}</span>
        </div>
      </div>

      <ColdKeyStep v-if="current === 'cold'" @done="onColdDone" @busy="busy = $event" />
      <VrfStep
        v-else-if="current === 'vrf'" :pool-id="poolId" :chain="chain" :network="network"
        @done="onVrfDone" @busy="busy = $event"
      />
      <ConfirmStep v-else :pool-id="poolId" :vrf-key-hash="vrfKeyHash" @finish="onFinish" />
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed, toRefs, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { walletStore } from '@/stores/walletStore';
import ColdKeyStep from './steps/ColdKeyStep.vue';
import VrfStep from './steps/VrfStep.vue';
import ConfirmStep from './steps/ConfirmStep.vue';

const props = defineProps<{ value: boolean }>();
const emit = defineEmits(['input', 'configured']);

const { coldKeySource, poolId, vrfKeyHash } = toRefs(poolOperatorStore);
const chain = computed(() => walletStore.loggedWallet?.chain || '');
const network = computed(() => walletStore.loggedWallet?.network || '');

const steps = [
  { id: 'cold', labelKey: 'poolOperator.wizardStepCold' },
  { id: 'vrf', labelKey: 'poolOperator.wizardStepVrf' },
  { id: 'confirm', labelKey: 'poolOperator.wizardStepConfirm' },
] as const;

const busy = ref(false);
const coldDone = computed(() => coldKeySource.value !== 'none' && !!poolId.value);
const vrfDone = computed(() => !!vrfKeyHash.value);

function firstIncomplete(): 'cold' | 'vrf' | 'confirm' {
  if (!coldDone.value) return 'cold';
  if (!vrfDone.value) return 'vrf';
  return 'confirm';
}

const current = ref<'cold' | 'vrf' | 'confirm'>(firstIncomplete());
watch(() => props.value, (v) => { if (v) current.value = firstIncomplete(); });

const currentIndex = computed(() => steps.findIndex((s) => s.id === current.value));
function isDone(id: string) {
  if (id === 'cold') return coldDone.value;
  if (id === 'vrf') return vrfDone.value;
  return false;
}

function onColdDone() { current.value = 'vrf'; }
function onVrfDone() { current.value = 'confirm'; }
function onFinish() { emit('configured'); close(); }
function close() { if (!busy.value) emit('input', false); }
</script>

<style lang="scss" scoped>
.wizard-dots { display: flex; justify-content: space-between; }
.wizard-dot-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
.wizard-dot {
  width: 28px; height: 28px; border-radius: var(--g-r-pill);
  display: flex; align-items: center; justify-content: center;
  background: var(--g-raised); color: var(--g-text-2);
  border: 1px solid var(--g-hairline-2); font-size: 13px;
}
.wizard-dot.active { border-color: var(--g-accent); color: var(--g-text-1); }
.wizard-dot.done { background: var(--g-accent); color: white; border-color: var(--g-accent); }
.wizard-dot-label { color: var(--g-text-3); }
</style>
