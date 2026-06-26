// src/sidepanel/composables/useAgentDock.ts
import { ref, type Ref } from 'vue';
import i18n from '@/plugins/i18n';
import { defaultAgentProvider } from '@/services/agent/agentProvider';
import type { AgentProvider } from '@/services/agent/types';
import { parseIntent } from '@/services/agent/intentRouter';
import { resolveSymbolToAssetId } from '@/services/agent/tokenResolver';

export interface DockMessageIntent {
  type: 'chart-token';
  symbol: string;
  assetId: string | null;
}

export interface DockMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  intent?: DockMessageIntent;
}

export function createAgentDock(
  provider: AgentProvider = defaultAgentProvider,
  resolver: (symbol: string) => Promise<string | null> = resolveSymbolToAssetId,
) {
  let nextId = 1;
  const isOpen: Ref<boolean> = ref(false);
  const busy: Ref<boolean> = ref(false);
  const messages: Ref<DockMessage[]> = ref([]);

  const open = () => {
    isOpen.value = true;
  };

  const close = () => {
    isOpen.value = false;
  };

  const toggle = () => {
    isOpen.value = !isOpen.value;
  };

  async function send(text: string): Promise<void> {
    const trimmed = (text || '').trim();
    if (!trimmed || busy.value) return;
    const history = messages.value.map((m) => ({ role: m.role, text: m.text }));
    messages.value.push({ id: nextId++, role: 'user', text: trimmed });
    busy.value = true;
    try {
      const res = await provider.chat({ message: trimmed, history });
      const parsed = parseIntent(trimmed);
      let intent: DockMessageIntent | undefined;
      if (parsed.type === 'chart-token') {
        intent = { type: 'chart-token', symbol: parsed.symbol, assetId: await resolver(parsed.symbol) };
      }
      messages.value.push({ id: nextId++, role: 'assistant', text: res.reply, intent });
    } catch {
      messages.value.push({
        id: nextId++,
        role: 'assistant',
        text: i18n.t('copilot.error.agentUnavailable') as string,
      });
    } finally {
      busy.value = false;
    }
  }

  return { isOpen, busy, messages, open, close, toggle, send };
}

/** Singleton instance shared by the dock UI so the conversation persists across routes. */
export const agentDock = createAgentDock();
