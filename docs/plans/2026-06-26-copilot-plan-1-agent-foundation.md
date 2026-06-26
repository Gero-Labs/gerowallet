# Gero Copilot - Plan 1: Agent Foundation (read-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a global "ask Gero" dock available on every sidepanel route that chats via Nexus and renders an inline token price chart for a "chart/price <token>" request - proving the dock + provider abstraction + intent routing + generative-UI pattern with zero custody risk.

**Architecture:** The sidepanel UI calls Nexus directly over axios (exactly like `src/api/market-api.ts`), so the Fluxpoint api-key stays server-side in Nexus (the spec's "centralize in Nexus"). A swappable `AgentProvider` wraps the client. A deterministic `intentRouter` parses requests into typed intents; the `useAgentDock` composable holds conversation state and routes intents; `AgentDock.vue` renders text and an inline `ChartCard.vue` (reusing the existing `TradingViewChart.vue` + `market-api`). The dock mounts once in `src/sidepanel/App.vue` next to `DAppOverlay`, so it persists across all routes.

**Tech Stack:** Vue 2.7 + TypeScript + Vuetify 2.7, Vite, Vitest 3.2.4 (co-located `.spec.ts`), axios, `lightweight-charts` (via existing `TradingViewChart.vue`).

**Prerequisite (backend, tracked separately):** A Nexus proxy endpoint `POST /api/agent/chat` that accepts `{ message: string, context?: object, history?: {role,text}[], max_tokens?: number }`, forwards to Fluxpoint `POST /chat` with the server-side `api-key` and `max_tokens >= 800` (Kimi reasoning consumes the budget; a low cap returns an empty reply), and returns `{ reply: string, used_tools?: object|null, model?: string }`. Unit tests in this plan mock the HTTP layer and do not require the live endpoint; live/manual verification (Task 8) does.

**Testing note:** Pure-TS units (client, provider, intent router, token resolver, composable) are TDD with Vitest. `.vue` components and the mount/i18n wiring are verified with `npm run typecheck` + `npm run build` + a manual run, because the repo has no component-render test setup. Run a single spec with `npx vitest run <path>`.

---

### Task 1: Agent API client (`agent.client.ts`)

**Files:**
- Create: `src/api/agent.client.ts`
- Test: `src/api/agent.client.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/api/agent.client.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('agent-api client', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_NEXUS_URL', 'https://nexus.example.test');
    vi.resetModules();
  });

  it('uses VITE_NEXUS_URL as baseURL', async () => {
    const mod = await import('./agent.client');
    expect(mod.agentAxiosInstance.defaults.baseURL).toBe('https://nexus.example.test');
  });

  it('chat() posts to /api/agent/chat and maps the reply', async () => {
    const mod = await import('./agent.client');
    const spy = vi
      .spyOn(mod.agentAxiosInstance, 'post')
      .mockResolvedValue({ data: { reply: 'hello', model: 'kimi-k2.6', used_tools: null } } as never);

    const result = await mod.agentApi.chat({ message: 'hi', maxTokens: 800 });

    expect(spy).toHaveBeenCalledWith('/api/agent/chat', {
      message: 'hi',
      context: undefined,
      history: undefined,
      max_tokens: 800,
    });
    expect(result).toEqual({ reply: 'hello', model: 'kimi-k2.6', usedTools: null });
  });

  it('chat() defaults max_tokens to 800 when omitted', async () => {
    const mod = await import('./agent.client');
    const spy = vi
      .spyOn(mod.agentAxiosInstance, 'post')
      .mockResolvedValue({ data: { reply: 'ok' } } as never);

    await mod.agentApi.chat({ message: 'hi' });

    expect(spy).toHaveBeenCalledWith('/api/agent/chat', expect.objectContaining({ max_tokens: 800 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/agent.client.spec.ts`
Expected: FAIL with "Cannot find module './agent.client'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/api/agent.client.ts
import axios, { AxiosInstance } from 'axios';

// @ts-ignore Vite env
const NEXUS_BASE: string = import.meta.env.VITE_NEXUS_URL || '';

export const agentAxiosInstance: AxiosInstance = axios.create({
  baseURL: NEXUS_BASE,
  timeout: 60_000,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
});

export interface AgentTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AgentChatInput {
  message: string;
  context?: Record<string, unknown>;
  history?: AgentTurn[];
  maxTokens?: number;
}

export interface AgentChatResult {
  reply: string;
  model?: string;
  usedTools?: unknown;
}

export const agentApi = {
  async chat(input: AgentChatInput): Promise<AgentChatResult> {
    const { data } = await agentAxiosInstance.post('/api/agent/chat', {
      message: input.message,
      context: input.context,
      history: input.history,
      max_tokens: input.maxTokens ?? 800,
    });
    return { reply: data.reply, model: data.model, usedTools: data.used_tools ?? null };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/agent.client.spec.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/api/agent.client.ts src/api/agent.client.spec.ts
git commit -m "feat(copilot): agent API client over Nexus proxy"
```

---

### Task 2: Agent types + swappable `AgentProvider`

**Files:**
- Create: `src/services/agent/types.ts`
- Create: `src/services/agent/agentProvider.ts`
- Test: `src/services/agent/agentProvider.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/agent/agentProvider.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { NexusAgentProvider } from './agentProvider';
import { agentApi } from '@/api/agent.client';

describe('NexusAgentProvider', () => {
  it('delegates chat() to agentApi.chat with the same input', async () => {
    const spy = vi.spyOn(agentApi, 'chat').mockResolvedValue({ reply: 'yo' });
    const provider = new NexusAgentProvider();

    const out = await provider.chat({ message: 'gm' });

    expect(spy).toHaveBeenCalledWith({ message: 'gm' });
    expect(out.reply).toBe('yo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/agent/agentProvider.spec.ts`
Expected: FAIL with "Cannot find module './agentProvider'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/agent/types.ts
import type { AgentChatInput, AgentChatResult } from '@/api/agent.client';

export type { AgentChatInput, AgentChatResult };

export interface AgentProvider {
  chat(input: AgentChatInput): Promise<AgentChatResult>;
}
```

```typescript
// src/services/agent/agentProvider.ts
import { agentApi } from '@/api/agent.client';
import type { AgentProvider, AgentChatInput, AgentChatResult } from './types';

/** Fluxpoint-backed provider (via the Nexus proxy). Swappable behind the AgentProvider interface. */
export class NexusAgentProvider implements AgentProvider {
  chat(input: AgentChatInput): Promise<AgentChatResult> {
    return agentApi.chat(input);
  }
}

export const defaultAgentProvider: AgentProvider = new NexusAgentProvider();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/agent/agentProvider.spec.ts`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add src/services/agent/types.ts src/services/agent/agentProvider.ts src/services/agent/agentProvider.spec.ts
git commit -m "feat(copilot): swappable AgentProvider interface + Nexus provider"
```

---

### Task 3: Deterministic intent router

**Files:**
- Create: `src/services/agent/intentRouter.ts`
- Test: `src/services/agent/intentRouter.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/agent/intentRouter.spec.ts
import { describe, it, expect } from 'vitest';
import { parseIntent } from './intentRouter';

describe('parseIntent', () => {
  it('detects a chart-token intent and extracts the symbol (uppercased)', () => {
    expect(parseIntent('chart snek')).toEqual({ type: 'chart-token', symbol: 'SNEK' });
    expect(parseIntent('show me the price of GERO please')).toEqual({ type: 'chart-token', symbol: 'GERO' });
  });

  it('falls back to a plain chat intent', () => {
    expect(parseIntent('gm how are you')).toEqual({ type: 'chat' });
    expect(parseIntent('')).toEqual({ type: 'chat' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/agent/intentRouter.spec.ts`
Expected: FAIL with "Cannot find module './intentRouter'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/agent/intentRouter.ts
export type AgentIntent =
  | { type: 'chart-token'; symbol: string }
  | { type: 'chat' };

const CHART_RE = /\b(?:chart|price)\b[^a-z0-9]*(?:of\s+|the\s+)*([a-z0-9]{2,12})\b/i;
const STOPWORDS = new Set(['the', 'price', 'chart', 'of', 'me', 'please', 'show', 'for']);

/** Deterministic parse of a user message into a typed intent. No LLM involved. */
export function parseIntent(text: string): AgentIntent {
  const match = CHART_RE.exec(text || '');
  if (match) {
    const candidate = match[1];
    if (!STOPWORDS.has(candidate.toLowerCase())) {
      return { type: 'chart-token', symbol: candidate.toUpperCase() };
    }
  }
  return { type: 'chat' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/agent/intentRouter.spec.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/services/agent/intentRouter.ts src/services/agent/intentRouter.spec.ts
git commit -m "feat(copilot): deterministic intent router (chart-token)"
```

---

### Task 4: Token resolver (symbol -> assetId via market-api)

**Files:**
- Create: `src/services/agent/tokenResolver.ts`
- Test: `src/services/agent/tokenResolver.spec.ts`

> Confirm the exact function name/shape on `marketApi` for "top tokens" before writing Step 3 (the explore report cited `getTopByVolume`; if the real export differs, use the real one and keep the resolver's own surface unchanged). Each token has `assetId` and `assetNameAscii`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/agent/tokenResolver.spec.ts
import { describe, it, expect, vi } from 'vitest';
import * as market from '@/api/market-api';
import { resolveSymbolToAssetId } from './tokenResolver';

describe('resolveSymbolToAssetId', () => {
  it('matches a token by case-insensitive ascii name and returns its assetId', async () => {
    vi.spyOn(market.marketApi, 'getTopByVolume').mockResolvedValue([
      { assetId: 'aaa.534e454b', assetNameAscii: 'SNEK' },
      { assetId: 'bbb.4745524f', assetNameAscii: 'GERO' },
    ] as never);

    expect(await resolveSymbolToAssetId('gero')).toBe('bbb.4745524f');
  });

  it('returns null when no token matches', async () => {
    vi.spyOn(market.marketApi, 'getTopByVolume').mockResolvedValue([
      { assetId: 'aaa.534e454b', assetNameAscii: 'SNEK' },
    ] as never);

    expect(await resolveSymbolToAssetId('doesnotexist')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/agent/tokenResolver.spec.ts`
Expected: FAIL with "Cannot find module './tokenResolver'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/agent/tokenResolver.ts
import { marketApi } from '@/api/market-api';

/** Resolve a ticker/symbol to a market-api assetId by matching ascii name. Returns null if unknown. */
export async function resolveSymbolToAssetId(symbol: string): Promise<string | null> {
  const needle = (symbol || '').trim().toLowerCase();
  if (!needle) return null;
  const tokens = await marketApi.getTopByVolume(100);
  const hit = tokens.find(
    (t: { assetNameAscii?: string }) => (t.assetNameAscii || '').toLowerCase() === needle,
  );
  return hit ? (hit as { assetId: string }).assetId : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/agent/tokenResolver.spec.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/services/agent/tokenResolver.ts src/services/agent/tokenResolver.spec.ts
git commit -m "feat(copilot): symbol->assetId resolver via market-api"
```

---

### Task 5: `useAgentDock` composable (state + send + intent routing)

**Files:**
- Create: `src/sidepanel/composables/useAgentDock.ts`
- Test: `src/sidepanel/composables/useAgentDock.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/sidepanel/composables/useAgentDock.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { createAgentDock } from './useAgentDock';
import type { AgentProvider } from '@/services/agent/types';

function fakeProvider(reply: string): AgentProvider {
  return { chat: vi.fn().mockResolvedValue({ reply }) };
}

describe('useAgentDock', () => {
  it('toggle() flips isOpen', () => {
    const dock = createAgentDock(fakeProvider('x'));
    expect(dock.isOpen.value).toBe(false);
    dock.toggle();
    expect(dock.isOpen.value).toBe(true);
  });

  it('send() appends the user message then the assistant reply', async () => {
    const dock = createAgentDock(fakeProvider('hello back'));
    await dock.send('gm');
    expect(dock.messages.value.map((m) => [m.role, m.text])).toEqual([
      ['user', 'gm'],
      ['assistant', 'hello back'],
    ]);
    expect(dock.busy.value).toBe(false);
  });

  it('attaches a chart-token intent (with resolved assetId) to the assistant message', async () => {
    const resolver = vi.fn().mockResolvedValue('bbb.4745524f');
    const dock = createAgentDock(fakeProvider('here is GERO'), resolver);
    await dock.send('chart gero');
    const last = dock.messages.value[dock.messages.value.length - 1];
    expect(last.intent).toEqual({ type: 'chart-token', symbol: 'GERO', assetId: 'bbb.4745524f' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sidepanel/composables/useAgentDock.spec.ts`
Expected: FAIL with "Cannot find module './useAgentDock'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/sidepanel/composables/useAgentDock.ts
import { ref, type Ref } from 'vue';
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

let nextId = 1;

export function createAgentDock(
  provider: AgentProvider = defaultAgentProvider,
  resolver: (symbol: string) => Promise<string | null> = resolveSymbolToAssetId,
) {
  const isOpen: Ref<boolean> = ref(false);
  const busy: Ref<boolean> = ref(false);
  const messages: Ref<DockMessage[]> = ref([]);

  const open = () => { isOpen.value = true; };
  const close = () => { isOpen.value = false; };
  const toggle = () => { isOpen.value = !isOpen.value; };

  async function send(text: string): Promise<void> {
    const trimmed = (text || '').trim();
    if (!trimmed || busy.value) return;
    messages.value.push({ id: nextId++, role: 'user', text: trimmed });
    busy.value = true;
    try {
      const history = messages.value.map((m) => ({ role: m.role, text: m.text }));
      const res = await provider.chat({ message: trimmed, history });
      const parsed = parseIntent(trimmed);
      let intent: DockMessageIntent | undefined;
      if (parsed.type === 'chart-token') {
        intent = { type: 'chart-token', symbol: parsed.symbol, assetId: await resolver(parsed.symbol) };
      }
      messages.value.push({ id: nextId++, role: 'assistant', text: res.reply, intent });
    } catch (err) {
      messages.value.push({
        id: nextId++,
        role: 'assistant',
        text: 'Sorry, I could not reach the agent right now. Please try again.',
      });
    } finally {
      busy.value = false;
    }
  }

  return { isOpen, busy, messages, open, close, toggle, send };
}

/** Singleton instance shared by the dock UI so the conversation persists across routes. */
export const agentDock = createAgentDock();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sidepanel/composables/useAgentDock.spec.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/composables/useAgentDock.ts src/sidepanel/composables/useAgentDock.spec.ts
git commit -m "feat(copilot): useAgentDock composable (state + send + intent routing)"
```

---

### Task 6: `ChartCard.vue` (inline generative-UI widget)

**Files:**
- Create: `src/sidepanel/components/agent/ChartCard.vue`

> Verify the exact `marketApi.getCandles(assetId, resolution)` signature and the `TradingViewChart` props (`data`, `height`) against the explore report before finalizing. `CandlestickDataPoint = { time, open, high, low, close, volume? }`.

- [ ] **Step 1: Implement the component**

```vue
<!-- src/sidepanel/components/agent/ChartCard.vue -->
<template>
  <div class="agent-chart-card">
    <div class="agent-chart-card__header">
      <span class="agent-chart-card__symbol">{{ symbol }}</span>
      <span v-if="error" class="agent-chart-card__error">{{ error }}</span>
    </div>
    <div v-if="loading" class="agent-chart-card__loading">{{ $t('copilot.chart.loading') }}</div>
    <TradingViewChart v-else-if="candles.length" :data="candles" height="180px" />
    <div v-else-if="!error" class="agent-chart-card__empty">{{ $t('copilot.chart.noData') }}</div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted } from 'vue';
import TradingViewChart from '@/shared/components/TradingViewChart.vue';
import { marketApi } from '@/api/market-api';

export default defineComponent({
  name: 'ChartCard',
  components: { TradingViewChart },
  props: {
    symbol: { type: String, required: true },
    assetId: { type: String, default: null },
  },
  setup(props) {
    const candles = ref<unknown[]>([]);
    const loading = ref(true);
    const error = ref('');

    onMounted(async () => {
      if (!props.assetId) {
        error.value = 'Token not found';
        loading.value = false;
        return;
      }
      try {
        candles.value = await marketApi.getCandles(props.assetId, '1h');
      } catch (e) {
        error.value = 'Could not load chart';
      } finally {
        loading.value = false;
      }
    });

    return { candles, loading, error };
  },
});
</script>

<style scoped>
.agent-chart-card { border-radius: 12px; padding: 8px; background: rgba(255, 255, 255, 0.04); }
.agent-chart-card__header { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }
.agent-chart-card__symbol { font-weight: 600; }
.agent-chart-card__error, .agent-chart-card__empty, .agent-chart-card__loading { opacity: 0.7; font-size: 12px; }
</style>
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: no new errors referencing `ChartCard.vue`. (The repo's typecheck may already report pre-existing errors; confirm none are introduced by this file.)

- [ ] **Step 3: Commit**

```bash
git add src/sidepanel/components/agent/ChartCard.vue
git commit -m "feat(copilot): inline ChartCard widget reusing TradingViewChart"
```

---

### Task 7: `AgentDock.vue` (floating dock + message list)

**Files:**
- Create: `src/sidepanel/components/AgentDock.vue`

- [ ] **Step 1: Implement the component**

```vue
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

export default defineComponent({
  name: 'AgentDock',
  components: { ChartCard },
  setup() {
    const draft = ref('');
    const dock = agentDock;
    async function submit() {
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
  position: fixed; bottom: 80px; right: 16px; z-index: 99;
  width: 48px; height: 48px; border-radius: 50%; border: none;
  font-weight: 700; cursor: pointer; background: var(--v-primary-base, #5b6cff); color: #fff;
}
.agent-dock__panel {
  position: fixed; bottom: 140px; right: 16px; z-index: 99;
  width: 320px; max-height: 60vh; display: flex; flex-direction: column;
  border-radius: 16px; overflow: hidden; backdrop-filter: blur(20px);
  background: rgba(20, 20, 28, 0.92);
}
.agent-dock__head { display: flex; justify-content: space-between; padding: 10px 12px; font-weight: 600; }
.agent-dock__messages { flex: 1; overflow-y: auto; padding: 8px 12px; display: flex; flex-direction: column; gap: 8px; }
.agent-dock__msg.user { align-self: flex-end; }
.agent-dock__text { margin: 0; font-size: 13px; }
.agent-dock__input { display: flex; gap: 6px; padding: 8px 12px; }
.agent-dock__input input { flex: 1; border-radius: 10px; border: none; padding: 8px; }
.agent-dock__disclaimer { font-size: 10px; opacity: 0.5; padding: 0 12px 8px; margin: 0; }
.agent-dock__busy { opacity: 0.6; }
</style>
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: no new errors referencing `AgentDock.vue`.

- [ ] **Step 3: Commit**

```bash
git add src/sidepanel/components/AgentDock.vue
git commit -m "feat(copilot): global AgentDock UI (floating dock + message list)"
```

---

### Task 8: Mount the dock on every route + i18n + manual verification

**Files:**
- Modify: `src/sidepanel/App.vue` (add `<AgentDock />` next to `<DAppOverlay />`)
- Modify: `src/plugins/i18n/us.ts` (add `copilot` keys)
- Modify: `src/plugins/i18n/de.ts` (add `copilot` keys)

- [ ] **Step 1: Add the i18n keys (English)**

In `src/plugins/i18n/us.ts`, add a top-level `copilot` block (match the file's existing object/quote style):

```typescript
copilot: {
  title: 'Gero Copilot',
  open: 'Open Gero Copilot',
  close: 'Close',
  send: 'Send',
  placeholder: 'Ask Gero anything...',
  disclaimer: 'Information only, not financial advice. DYOR.',
  chart: {
    loading: 'Loading chart...',
    noData: 'No chart data available.',
  },
},
```

- [ ] **Step 2: Add the i18n keys (German)**

In `src/plugins/i18n/de.ts`, add the matching block:

```typescript
copilot: {
  title: 'Gero Copilot',
  open: 'Gero Copilot oeffnen',
  close: 'Schliessen',
  send: 'Senden',
  placeholder: 'Frag Gero alles...',
  disclaimer: 'Nur Informationen, keine Finanzberatung. DYOR.',
  chart: {
    loading: 'Diagramm wird geladen...',
    noData: 'Keine Diagrammdaten verfuegbar.',
  },
},
```

- [ ] **Step 3: Mount the dock in `src/sidepanel/App.vue`**

In the logged-in branch (the `<template v-else>` that renders `<MiniLayout ... />` and `<DAppOverlay />`), add `<AgentDock />` as a sibling after `<DAppOverlay />`, and import it.

Template:
```vue
    <MiniLayout
      @wallet-switch="showWalletSwitcher = true"
      @settings="openDashboardSettings"
    />
    <DAppOverlay />
    <AgentDock />
```

Script (add to imports and `components`):
```typescript
import AgentDock from '@/sidepanel/components/AgentDock.vue';
// ...
components: {
  // ...existing,
  AgentDock,
},
```

- [ ] **Step 4: Typecheck, lint, build**

Run: `npm run typecheck`
Expected: no new errors from the files in this plan.

Run: `npm run lint`
Expected: clean for the touched files (fix any reported issues per the repo's "fix ESLint in every file you touch" rule).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual verification (requires the Nexus `/api/agent/chat` proxy)**

Run: `npm run dev`, load the extension, open the sidepanel.
- Confirm the round "GERO" dock button is visible on the Home route and remains visible after navigating to Market, Card, Activity, etc. (persists across routes).
- Click it; the panel opens. Type "gm" and Send; an assistant text reply renders.
- Type "chart snek"; the assistant reply renders with an inline price chart below it (the `ChartCard`).
- Confirm the "Information only, not financial advice. DYOR." disclaimer is visible.

Expected: dock is reachable on every screen; chat replies render; "chart <token>" produces an inline chart.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/App.vue src/plugins/i18n/us.ts src/plugins/i18n/de.ts
git commit -m "feat(copilot): mount global AgentDock on every sidepanel route + i18n"
```

---

## Self-Review

- **Spec coverage (Plan 1 scope = Phase 0 read foundation):** global dock on every route (Task 7-8), `AgentProvider` abstraction (Task 2), per-message intent routing + generative-UI inline widget (Tasks 3-7), Nexus-centralized call path keeping the key server-side (Task 1 + prerequisite), no-advice disclaimer surfaced (Task 8). Proactive feed, swap/actions, and the Agent Allowance are explicitly out of Plan 1 and get their own plans.
- **Out of scope here (later plans):** per-screen `ScreenContext` injection beyond the dock, the proactive "friend" engine, P&L / cashback / card read cards, streaming responses, and all write/sign actions.
- **Type consistency:** `AgentChatInput`/`AgentChatResult` defined in Task 1 and re-exported in Task 2; `DockMessageIntent.assetId: string | null` flows from Task 5 into `ChartCard` props (Task 6) and the dock template (Task 7); `parseIntent` (Task 3) and `resolveSymbolToAssetId` (Task 4) are consumed in Task 5.
- **Known follow-ups to verify during execution:** confirm the real `marketApi.getCandles` and `getTopByVolume` signatures and the `TradingViewChart` prop names against the codebase before Tasks 4/6 (flagged inline); confirm the sidepanel `App.vue` logged-in branch structure before editing (Task 8).
