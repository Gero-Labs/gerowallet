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

    const result = await mod.agentApi.chat({ message: 'hi' });

    expect(spy).toHaveBeenCalledWith('/api/agent/chat', expect.objectContaining({ max_tokens: 800 }));
    expect(result.usedTools).toBeNull();
  });
});
