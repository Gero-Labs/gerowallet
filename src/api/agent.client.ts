import axios, { type AxiosInstance } from 'axios';

const NEXUS_BASE: string = import.meta.env['VITE_NEXUS_URL'] || '';

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
  usedTools: unknown;
}

export const agentApi = {
  async chat(input: AgentChatInput): Promise<AgentChatResult> {
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
