// DEV ONLY: the agent key (AGENT_TOKEN) is exposed to the client bundle via vite envPrefix
// (['VITE_','AGENT_'] in vite.config.mts) so the dock can call Fluxpoint directly in dev.
// Production must use the Nexus proxy and must NOT expose this key to the client.
import axios, { type AxiosInstance } from 'axios';

const NEXUS_BASE: string = import.meta.env['VITE_NEXUS_URL'] || '';

export const agentAxiosInstance: AxiosInstance = axios.create({
  baseURL: NEXUS_BASE,
  timeout: 60_000,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
});

// DEV ONLY: direct-to-Fluxpoint fallback. Active only when the agent key is present.
// Reads AGENT_TOKEN (the single source in .env.development, exposed via vite envPrefix);
// falls back to VITE_FLUXPOINT_API_KEY if that is set instead. Uses a SEPARATE axios
// instance so the api-key header is never sent to Nexus.
const FLUXPOINT_API_KEY: string =
  import.meta.env['AGENT_TOKEN'] || import.meta.env['VITE_FLUXPOINT_API_KEY'] || '';
const FLUXPOINT_BASE: string =
  import.meta.env['VITE_FLUXPOINT_BASE_URL'] || 'https://api-v3.fluxpointstudios.com';

const FLUXPOINT_PERSONA =
  'You are Gero Copilot, a concise, friendly Cardano wallet assistant. ' +
  'Keep replies short and clear. You provide information only and never give financial advice.';

const fluxpointAxiosInstance: AxiosInstance = axios.create({
  baseURL: FLUXPOINT_BASE,
  timeout: 60_000,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'api-key': FLUXPOINT_API_KEY,
  },
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
  usedTools: unknown;
}

export const agentApi = {
  async chat(input: AgentChatInput): Promise<AgentChatResult> {
    // DEV ONLY: direct-to-Fluxpoint path. Skipped entirely when the key is not set.
    if (FLUXPOINT_API_KEY) {
      const { data } = await fluxpointAxiosInstance.post('/chat', {
        message: input.message,
        // Kimi returns an empty reply below ~800 tokens, so floor at 800.
        max_tokens: input.maxTokens ?? 800,
        system: FLUXPOINT_PERSONA,
      });
      const res = data as { reply?: string; model?: string; used_tools?: unknown };
      if (!res.reply) throw new Error('Agent response missing reply field');
      return { reply: res.reply, model: res.model, usedTools: res.used_tools ?? null };
    }

    const { data } = await agentAxiosInstance.post('/api/agent/chat', {
      message: input.message,
      context: input.context,
      history: input.history,
      max_tokens: input.maxTokens ?? 800,
    });
    const res = data as { reply?: string; model?: string; used_tools?: unknown };
    if (!res.reply) throw new Error('Agent response missing reply field');
    return { reply: res.reply, model: res.model, usedTools: res.used_tools ?? null };
  },
};
