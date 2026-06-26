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
