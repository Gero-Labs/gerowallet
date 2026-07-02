// src/sidepanel/composables/useAgentDock.ts
import { ref, type Ref } from 'vue';
import i18n from '@/plugins/i18n';
import { defaultAgentProvider } from '@/services/agent/agentProvider';
import type { AgentProvider } from '@/services/agent/types';
import { parseIntent } from '@/services/agent/intentRouter';
import { resolveSymbolToAssetId } from '@/services/agent/tokenResolver';
import { parseSwapIntent } from '@/services/agent/swapIntent';
import type { SwapIntent } from '@/services/agent/swapIntent';
import { parseStakingIntent } from '@/services/agent/stakingIntent';
import type { StakingIntent } from '@/services/agent/stakingIntent';
import { parseAllowanceIntent } from '@/services/agent/allowanceIntent';
import { buildWalletContext } from '@/services/agent/walletContext';
import { detectHeldTokenMention } from '@/services/agent/tokenMention';
import { walletStore } from '@/stores/walletStore';

export type DockMessageIntent =
  | { type: 'chart-token'; symbol: string; assetId: string | null }
  | { type: 'swap'; swap: SwapIntent }
  | { type: 'staking'; staking: StakingIntent }
  | { type: 'allowance' };

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
      // Snapshot the connected wallet so the agent answers with real portfolio data
      // instead of asking the user to connect (the dock only opens inside an unlocked wallet).
      const res = await provider.chat({ message: trimmed, history, context: buildWalletContext() });
      const parsed = parseIntent(trimmed);
      // A held token mentioned anywhere in the message lets us chart it (its unit IS the
      // market-api assetId, so no resolver round-trip needed).
      const mention = detectHeldTokenMention(
        trimmed,
        (walletStore.tokens || {}) as Record<
          string,
          { unit: string; name?: string; metadata?: { ticker?: string; name?: string } | null }
        >,
      );
      let intent: DockMessageIntent | undefined;
      if (parsed.type === 'chart-token') {
        const assetId =
          mention && mention.symbol === parsed.symbol
            ? mention.assetId
            : await resolver(parsed.symbol);
        intent = { type: 'chart-token', symbol: parsed.symbol, assetId };
      } else {
        const swapParsed = parseSwapIntent(trimmed);
        if (swapParsed) {
          intent = { type: 'swap', swap: swapParsed };
        } else {
          const stakingParsed = parseStakingIntent(trimmed);
          if (stakingParsed) {
            intent = { type: 'staking', staking: stakingParsed };
          } else if (parseAllowanceIntent(trimmed)) {
            intent = { type: 'allowance' };
          } else if (mention) {
            // a held token was named in a general question -> show its chart under the reply
            intent = { type: 'chart-token', symbol: mention.symbol, assetId: mention.assetId };
          }
        }
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
