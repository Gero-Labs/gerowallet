import type { AgentChatInput, AgentChatResult } from '@/api/agent.client';

export type { AgentChatInput, AgentChatResult };

export interface AgentProvider {
  chat(input: AgentChatInput): Promise<AgentChatResult>;
}
