import axios, { type AxiosInstance } from 'axios';

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
