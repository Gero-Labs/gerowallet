import { describe, it, expect, vi } from 'vitest';
import { NexusAgentProvider } from './agentProvider';
import { agentApi } from '@/api/agent.client';

describe('NexusAgentProvider', () => {
  it('delegates chat() to agentApi.chat with the same input', async () => {
    const spy = vi.spyOn(agentApi, 'chat').mockResolvedValue({ reply: 'yo', usedTools: null });
    const provider = new NexusAgentProvider();

    const out = await provider.chat({ message: 'gm' });

    expect(spy).toHaveBeenCalledWith({ message: 'gm' });
    expect(out.reply).toBe('yo');
  });
});
