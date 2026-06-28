<!-- src/sidepanel/components/AgentDock.vue -->
<template>
  <div class="agent-dock">
    <button
      class="agent-dock__fab"
      :aria-label="$t('copilot.open')"
      @click="dock.toggle()"
    >GERO</button>

    <div v-if="dock.isOpen.value" class="agent-dock__panel">
      <header class="agent-dock__head">
        <span>{{ $t('copilot.title') }}</span>
        <button :aria-label="$t('copilot.close')" @click="dock.close()">x</button>
      </header>

      <div ref="scroll" class="agent-dock__messages">
        <div v-for="m in dock.messages.value" :key="m.id" :class="['agent-dock__msg', m.role]">
          <p class="agent-dock__text">{{ m.text }}</p>
          <ChartCard
            v-if="m.intent && m.intent.type === 'chart-token'"
            :symbol="m.intent.symbol"
            :asset-id="m.intent.assetId"
          />
          <SwapCard
            v-else-if="m.intent && m.intent.type === 'swap'"
            :intent="m.intent.swap"
          />
          <StakingCard
            v-else-if="m.intent && m.intent.type === 'staking'"
            :intent="m.intent.staking"
          />
          <AllowanceCard
            v-else-if="m.intent && m.intent.type === 'allowance'"
          />
        </div>
        <p v-if="dock.busy.value" class="agent-dock__busy">...</p>
      </div>

      <footer class="agent-dock__input">
        <input
          v-model="draft"
          :placeholder="$t('copilot.placeholder')"
          @keyup.enter="submit()"
        />
        <button :disabled="dock.busy.value" @click="submit()">{{ $t('copilot.send') }}</button>
      </footer>
      <p class="agent-dock__disclaimer">{{ $t('copilot.disclaimer') }}</p>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import { agentDock } from '@/sidepanel/composables/useAgentDock';
import ChartCard from '@/sidepanel/components/agent/ChartCard.vue';
import SwapCard from '@/sidepanel/components/agent/SwapCard.vue';
import StakingCard from '@/sidepanel/components/agent/StakingCard.vue';
import AllowanceCard from '@/sidepanel/components/agent/AllowanceCard.vue';

export default defineComponent({
  name: 'AgentDock',
  components: { ChartCard, SwapCard, StakingCard, AllowanceCard },
  setup() {
    const draft = ref('');
    const dock = agentDock;

    async function submit(): Promise<void> {
      const text = draft.value;
      draft.value = '';
      await dock.send(text);
    }

    return { draft, dock, submit };
  },
});
</script>

<style scoped>
.agent-dock__fab {
  position: fixed;
  bottom: 80px;
  right: 16px;
  z-index: 99;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  font-weight: 700;
  cursor: pointer;
  background: var(--v-primary-base, #5b6cff);
  color: #fff;
}

.agent-dock__panel {
  position: fixed;
  bottom: 140px;
  right: 16px;
  z-index: 99;
  width: 320px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  overflow: hidden;
  backdrop-filter: blur(20px);
  background: rgba(20, 20, 28, 0.92);
}

.agent-dock__head {
  display: flex;
  justify-content: space-between;
  padding: 10px 12px;
  font-weight: 600;
}

.agent-dock__messages {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-dock__msg.user {
  align-self: flex-end;
}

.agent-dock__text {
  margin: 0;
  font-size: 13px;
}

.agent-dock__input {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
}

.agent-dock__input input {
  flex: 1;
  border-radius: 10px;
  border: none;
  padding: 8px;
}

.agent-dock__disclaimer {
  font-size: 10px;
  opacity: 0.5;
  padding: 0 12px 8px;
  margin: 0;
}

.agent-dock__busy {
  opacity: 0.6;
}
</style>
