<!-- src/sidepanel/components/AgentDock.vue -->
<template>
  <div class="agent-dock">
    <button
      class="agent-dock__fab"
      :class="{ 'is-open': dock.isOpen.value, 'is-hidden': isAnySheetOpen }"
      :aria-label="dock.isOpen.value ? $t('copilot.close') : $t('copilot.open')"
      :tabindex="isAnySheetOpen ? -1 : 0"
      @click="dock.toggle()"
    >
      <v-icon v-if="!dock.isOpen.value" size="22" color="#00DFF3">mdi-robot-outline</v-icon>
      <v-icon v-else size="22" color="#00DFF3">mdi-close</v-icon>
    </button>

    <transition name="dock-panel">
      <div v-if="dock.isOpen.value" class="agent-dock__panel">
        <header class="agent-dock__head">
          <div class="agent-dock__head-text">
            <span class="agent-dock__title">{{ $t('copilot.title') }}</span>
            <span class="agent-dock__status">
              {{ dock.busy.value ? $t('copilot.status.thinking') : $t('copilot.status.ready') }}
            </span>
          </div>
          <button
            class="agent-dock__close"
            :aria-label="$t('copilot.close')"
            @click="dock.close()"
          >
            <v-icon size="18" color="rgba(232,237,245,0.60)">mdi-close</v-icon>
          </button>
        </header>

        <div ref="scroll" class="agent-dock__messages">
          <div
            v-if="dock.messages.value.length === 0 && !dock.busy.value"
            class="agent-dock__empty"
          >
            <div class="agent-dock__empty-orb">G</div>
            <p class="agent-dock__empty-h">{{ $t('copilot.greeting.line1') }}</p>
            <p class="agent-dock__empty-sub">{{ $t('copilot.greeting.line2') }}</p>
            <div class="agent-dock__chips">
              <button class="chip" @click="quickSend($t('copilot.suggest.portfolio'))">
                {{ $t('copilot.suggest.portfolio') }}
              </button>
              <button class="chip" @click="quickSend($t('copilot.suggest.staking'))">
                {{ $t('copilot.suggest.staking') }}
              </button>
              <button class="chip" @click="quickSend($t('copilot.suggest.swap'))">
                {{ $t('copilot.suggest.swap') }}
              </button>
            </div>
          </div>

          <transition-group name="msg" tag="div" class="agent-dock__list">
            <div
              v-for="m in dock.messages.value"
              :key="m.id"
              :class="['agent-dock__msg', m.role]"
            >
              <div v-if="m.role === 'assistant'" class="agent-dock__avatar">G</div>
              <div class="agent-dock__bubble">
                <!-- assistant replies are markdown (escaped-first, then rendered); user text stays plain -->
                <div
                  v-if="m.role === 'assistant'"
                  class="agent-dock__md"
                  v-html="renderMarkdown(m.text)"
                ></div>
                <p v-else class="agent-dock__text">{{ m.text }}</p>
                <div v-if="m.intent" class="agent-dock__card">
                  <ChartCard
                    v-if="m.intent.type === 'chart-token'"
                    :symbol="m.intent.symbol"
                    :asset-id="m.intent.assetId"
                  />
                  <SwapCard
                    v-else-if="m.intent.type === 'swap'"
                    :intent="m.intent.swap"
                  />
                  <StakingCard
                    v-else-if="m.intent.type === 'staking'"
                    :intent="m.intent.staking"
                  />
                  <AllowanceCard v-else-if="m.intent.type === 'allowance'" />
                </div>
              </div>
            </div>
          </transition-group>

          <div v-if="dock.busy.value" class="agent-dock__msg assistant">
            <div class="agent-dock__avatar">G</div>
            <div class="agent-dock__busy" :aria-label="$t('copilot.status.thinking')">
              <span class="dot"></span>
              <span class="dot"></span>
              <span class="dot"></span>
            </div>
          </div>
        </div>

        <footer class="agent-dock__input">
          <input
            v-model="draft"
            :placeholder="$t('copilot.placeholder')"
            @keyup.enter="submit()"
          />
          <button
            class="agent-dock__send"
            :disabled="dock.busy.value"
            :aria-label="$t('copilot.send')"
            @click="submit()"
          >
            <v-icon size="16" color="#0A0C16">mdi-send</v-icon>
          </button>
        </footer>
        <p class="agent-dock__disclaimer">{{ $t('copilot.disclaimer') }}</p>
      </div>
    </transition>
  </div>
</template>

<script lang="ts">
import { defineComponent, nextTick, ref, watch } from 'vue';
import { agentDock } from '@/sidepanel/composables/useAgentDock';
import { renderMarkdown } from '@/services/agent/renderMarkdown';
import { useSheetVisibility } from '@/sidepanel/composables/useSheetVisibility';
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
    const scroll = ref<HTMLElement | null>(null);
    const { isAnySheetOpen } = useSheetVisibility();

    // Nothing may compete for attention while the user is mid-flow —
    // signing above all. Close the chat panel the instant a sheet opens
    // (the FAB itself just fades out via the is-hidden class below), and
    // reopening it is one tap away once the sheet closes.
    watch(isAnySheetOpen, (open) => {
      if (open && dock.isOpen.value) dock.close();
    });

    async function submit(): Promise<void> {
      const text = draft.value;
      draft.value = '';
      await dock.send(text);
    }

    function quickSend(text: string): void {
      draft.value = text;
      void submit();
    }

    watch(
      () => [dock.messages.value.length, dock.busy.value],
      () => {
        void nextTick(() => {
          const el = scroll.value;
          if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        });
      },
    );

    return { draft, dock, submit, quickSend, scroll, renderMarkdown, isAnySheetOpen };
  },
});
</script>

<style scoped>
.agent-dock {
  --surface: rgba(10, 12, 22, 0.92);
  --surface-border: rgba(0, 199, 243, 0.22);
  --text-primary: #e8edf5;
  --text-muted: rgba(232, 237, 245, 0.5);
  --text-placeholder: rgba(232, 237, 245, 0.38);
  --accent: #00dff3;
  --accent-08: rgba(0, 223, 243, 0.08);
  --accent-12: rgba(0, 223, 243, 0.12);
  --accent-14: rgba(0, 223, 243, 0.14);
  --accent-18: rgba(0, 223, 243, 0.18);
  --accent-30: rgba(0, 223, 243, 0.3);
  --accent-35: rgba(0, 223, 243, 0.35);
  --accent-60: rgba(0, 223, 243, 0.6);
  --accent-80: rgba(0, 223, 243, 0.8);
  --user-bubble-bg: rgba(0, 223, 243, 0.14);
  --asst-bubble-bg: rgba(255, 255, 255, 0.05);
  --asst-bubble-border: rgba(255, 255, 255, 0.08);
  --input-bg: rgba(255, 255, 255, 0.07);
  --input-border: rgba(255, 255, 255, 0.12);
  --divider: rgba(255, 255, 255, 0.07);
  --panel-shadow: 0 8px 40px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4);
  --fab-bg: rgba(10, 12, 22, 0.96);
  --fab-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  --gradient-send: linear-gradient(135deg, #00c7f3 0%, #00ffd1 100%);
}

/* ── FAB ──────────────────────────────────────────────────────────────── */
.agent-dock__fab {
  position: fixed;
  bottom: 80px;
  right: 16px;
  z-index: 1001;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  cursor: pointer;
  background: var(--fab-bg);
  border: 1.5px solid var(--accent-35);
  box-shadow: var(--fab-shadow);
  animation: fab-pulse 4s ease-in-out infinite;
  transition: box-shadow 150ms ease, border-color 150ms ease;
}

.agent-dock__fab:hover {
  box-shadow: var(--fab-shadow), 0 0 0 3px rgba(0, 223, 243, 0.2);
}

.agent-dock__fab.is-open {
  border: 1.5px solid var(--accent-80);
  animation-play-state: paused;
}

/* Nothing may compete for attention while the user reviews a sheet — most of
   all a signing request. Faded rather than unmounted so it resumes exactly
   where it was the instant the sheet closes. */
.agent-dock__fab.is-hidden {
  opacity: 0;
  pointer-events: none;
  animation-play-state: paused;
  transition: opacity 150ms ease;
}

@keyframes fab-pulse {
  0%,
  100% {
    box-shadow: var(--fab-shadow), 0 0 0 0 rgba(0, 223, 243, 0.3);
  }
  50% {
    box-shadow: var(--fab-shadow), 0 0 0 8px rgba(0, 223, 243, 0);
  }
}

/* ── Panel ────────────────────────────────────────────────────────────── */
.agent-dock__panel {
  position: fixed;
  bottom: 140px;
  right: 16px;
  z-index: 1000;
  width: 320px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--surface-border);
  box-shadow: var(--panel-shadow);
  backdrop-filter: blur(24px) saturate(140%);
}

.agent-dock__panel::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 0;
  background: radial-gradient(
    ellipse 280px 200px at 50% -10%,
    rgba(0, 199, 243, 0.16) 0%,
    rgba(138, 43, 226, 0.08) 55%,
    transparent 100%
  );
  animation: aurora-drift 8s ease-in-out infinite;
}

@keyframes aurora-drift {
  0%,
  100% {
    opacity: 1;
    transform: translateX(0);
  }
  50% {
    opacity: 0.72;
    transform: translateX(4px);
  }
}

.agent-dock__head,
.agent-dock__messages,
.agent-dock__input,
.agent-dock__disclaimer {
  position: relative;
  z-index: 1;
}

/* ── Header ───────────────────────────────────────────────────────────── */
.agent-dock__head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: rgba(0, 199, 243, 0.06);
  border-bottom: 1px solid var(--divider);
}

.agent-dock__head-text {
  display: flex;
  flex-direction: column;
}

.agent-dock__title {
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
}

.agent-dock__status {
  font-size: 11px;
  color: rgba(0, 223, 243, 0.85);
}

.agent-dock__close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: color 150ms ease;
}

.agent-dock__close:hover :deep(.v-icon) {
  color: #ffffff !important;
}

/* ── Messages ─────────────────────────────────────────────────────────── */
.agent-dock__messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.agent-dock__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.agent-dock__messages::-webkit-scrollbar {
  width: 4px;
}

.agent-dock__messages::-webkit-scrollbar-track {
  background: transparent;
}

.agent-dock__messages::-webkit-scrollbar-thumb {
  background: var(--accent-30);
  border-radius: 4px;
}

.agent-dock__msg {
  display: flex;
}

.agent-dock__msg.user {
  justify-content: flex-end;
}

.agent-dock__msg.assistant {
  justify-content: flex-start;
}

.agent-dock__avatar {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  align-self: flex-start;
  margin-right: 6px;
  margin-top: 2px;
  border-radius: 50%;
  background: rgba(0, 223, 243, 0.15);
  border: 1px solid rgba(0, 223, 243, 0.3);
  color: #00dff3;
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
}

.agent-dock__bubble {
  max-width: 88%;
}

.agent-dock__msg.user .agent-dock__bubble {
  background: var(--user-bubble-bg);
  border: 1px solid var(--accent-35);
  border-radius: 18px 18px 4px 18px;
  padding: 9px 13px;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--text-primary);
}

.agent-dock__msg.assistant .agent-dock__bubble {
  background: var(--asst-bubble-bg);
  border: 1px solid var(--asst-bubble-border);
  border-radius: 4px 18px 18px 18px;
  padding: 10px 14px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--text-primary);
}

.agent-dock__text {
  margin: 0;
  word-break: break-word;
  white-space: pre-wrap;
}

/* ── Rendered markdown (assistant replies; v-html, so children need :deep) ─ */
.agent-dock__md {
  margin: 0;
  word-break: break-word;
}

.agent-dock__md :deep(p) {
  margin: 0 0 8px;
}

.agent-dock__md :deep(p:last-child) {
  margin-bottom: 0;
}

.agent-dock__md :deep(strong) {
  font-weight: 700;
  color: #ffffff;
}

.agent-dock__md :deep(ul),
.agent-dock__md :deep(ol) {
  margin: 4px 0 8px;
  padding-left: 18px;
}

.agent-dock__md :deep(ul:last-child),
.agent-dock__md :deep(ol:last-child) {
  margin-bottom: 0;
}

.agent-dock__md :deep(li) {
  margin: 3px 0;
}

.agent-dock__md :deep(li::marker) {
  color: var(--accent-60);
}

.agent-dock__md :deep(code) {
  font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 12px;
  background: var(--accent-12);
  color: #7fe9f5;
  padding: 1px 5px;
  border-radius: 5px;
  word-break: break-all;
}

.agent-dock__md :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.agent-dock__md :deep(.md-h) {
  font-weight: 700;
  color: #ffffff;
  margin: 8px 0 4px;
}

.agent-dock__md :deep(.md-h:first-child) {
  margin-top: 0;
}

.agent-dock__md :deep(.md-h1) {
  font-size: 15px;
}

.agent-dock__md :deep(.md-h2) {
  font-size: 14px;
}

.agent-dock__md :deep(.md-h3) {
  font-size: 13.5px;
}

.agent-dock__card {
  margin-top: 8px;
  border-top: 1px solid rgba(0, 199, 243, 0.12);
  padding-top: 8px;
}

/* ── Thinking indicator ───────────────────────────────────────────────── */
.agent-dock__busy {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--asst-bubble-bg);
  border: 1px solid var(--asst-bubble-border);
  border-radius: 4px 18px 18px 18px;
  padding: 10px 14px;
}

.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #00dff3;
  display: inline-block;
  margin: 0 2px;
  animation: dot-pulse 1.1s ease-in-out infinite;
}

.dot:nth-child(2) {
  animation-delay: 160ms;
}

.dot:nth-child(3) {
  animation-delay: 320ms;
}

@keyframes dot-pulse {
  0%,
  60%,
  100% {
    opacity: 0.25;
    transform: scale(0.85);
  }
  30% {
    opacity: 1;
    transform: scale(1.1);
  }
}

/* ── Empty state ──────────────────────────────────────────────────────── */
.agent-dock__empty {
  padding: 8px 6px 4px;
  animation: msg-in 300ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes msg-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.agent-dock__empty-orb {
  width: 32px;
  height: 32px;
  margin: 0 auto 10px;
  border-radius: 50%;
  background: var(--accent-12);
  border: 1px solid var(--accent-30);
  font-size: 16px;
  font-weight: 700;
  color: #00dff3;
  line-height: 32px;
  text-align: center;
}

.agent-dock__empty-h {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
  text-align: center;
}

.agent-dock__empty-sub {
  font-size: 12px;
  color: rgba(232, 237, 245, 0.6);
  margin: 0;
  text-align: center;
}

.agent-dock__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin-top: 16px;
}

.chip {
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  background: var(--accent-08);
  border: 1px solid var(--accent-30);
  font-size: 11px;
  font-weight: 500;
  color: rgba(0, 223, 243, 0.9);
  cursor: pointer;
  transition: background 120ms ease;
}

.chip:hover {
  background: var(--accent-18);
}

/* ── Input footer ─────────────────────────────────────────────────────── */
.agent-dock__input {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  border-top: 1px solid var(--divider);
  background: transparent;
}

.agent-dock__input input {
  flex: 1;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary);
  caret-color: var(--accent);
  outline: none;
  transition: border-color 180ms ease;
}

.agent-dock__input input::placeholder {
  color: var(--text-placeholder);
}

.agent-dock__input input:focus {
  border-color: var(--accent-60);
  box-shadow: 0 0 0 2px rgba(0, 223, 243, 0.15);
}

.agent-dock__send {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  background: var(--gradient-send);
  transition: opacity 150ms ease, box-shadow 150ms ease;
}

.agent-dock__send:disabled {
  opacity: 0.35;
  cursor: default;
}

.agent-dock__send:hover:not(:disabled) {
  box-shadow: 0 0 0 3px rgba(0, 223, 243, 0.25);
}

/* ── Disclaimer ───────────────────────────────────────────────────────── */
.agent-dock__disclaimer {
  flex-shrink: 0;
  font-size: 10.5px;
  color: var(--text-muted);
  padding: 4px 14px 10px;
  margin: 0;
  text-align: center;
}

/* ── Panel open/close transition ──────────────────────────────────────── */
.dock-panel-enter-active {
  animation: panel-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.dock-panel-leave-active {
  animation: panel-out 160ms cubic-bezier(0.4, 0, 1, 1) both;
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes panel-out {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
}

/* ── Message entrance transition ──────────────────────────────────────── */
.msg-enter-active {
  transition: opacity 220ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.msg-enter {
  opacity: 0;
}

.agent-dock__msg.assistant.msg-enter {
  transform: translateX(-16px);
}

.agent-dock__msg.user.msg-enter {
  transform: translateX(16px);
}

.msg-enter-to {
  transform: translateX(0);
  opacity: 1;
}
</style>
