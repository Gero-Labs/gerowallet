import { agentApi } from '@/api/agent.client';
import type { AgentProvider, AgentChatInput, AgentChatResult } from './types';

/** Fluxpoint-backed provider (via the Nexus proxy). Swappable behind the AgentProvider interface. */
export class NexusAgentProvider implements AgentProvider {
  chat(input: AgentChatInput): Promise<AgentChatResult> {
    return agentApi.chat(input);
  }
}

export const defaultAgentProvider: AgentProvider = new NexusAgentProvider();
