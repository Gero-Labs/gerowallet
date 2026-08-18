import { beforeEach, describe, expect, it, vi } from 'vitest';

// nodeFetch talks to the background over Chrome messaging; capture what it sends.
interface SentMessage { method: string; data: { url: string; timeout?: number; authToken?: string } }
const sent: SentMessage[] = [];
vi.mock('@/chrome/messaging', () => ({
  Messaging: {
    sendToBackgroundFromOptions: (msg: SentMessage) => {
      sent.push(msg);
      return Promise.resolve({ data: { success: true, body: { ok: true } } });
    },
  },
}));
vi.mock('@/models/MessageTypes', () => ({ MessageTypes: { SPO_NODE_FETCH: 'SPO_NODE_FETCH' } }));

import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { nodeFetch } from '@/modules/pool-operator/utils/nodeFetch';

const BP = {
  id: '1', name: 'BP', type: 'bp' as const,
  url: 'https://bp.example.com',
  authToken: 'bp-secret',
  connected: false, lastSeen: null, data: null,
};
const RELAY = {
  id: '2', name: 'Relay', type: 'relay' as const,
  url: 'https://relay.example.com',
  authToken: 'relay-secret',
  connected: false, lastSeen: null, data: null,
};
const LOCAL = {
  id: '3', name: 'Local', type: 'bp' as const,
  url: 'http://localhost:12799',
  connected: false, lastSeen: null, data: null,
};

const lastSent = () => sent[sent.length - 1].data;

describe('nodeFetch auth token resolution', () => {
  beforeEach(() => {
    sent.length = 0;
    poolOperatorStore.nodes = [BP, RELAY, LOCAL];
  });

  it("sends the matching node's token", async () => {
    await nodeFetch('https://bp.example.com/status');
    expect(lastSent().authToken).toBe('bp-secret');
  });

  it('picks the right token per node, not the first one', async () => {
    await nodeFetch('https://relay.example.com/peers');
    expect(lastSent().authToken).toBe('relay-secret');
  });

  it('matches regardless of path, query or trailing slash', async () => {
    await nodeFetch('https://bp.example.com/leader-schedule?epoch=current');
    expect(lastSent().authToken).toBe('bp-secret');
    await nodeFetch('https://bp.example.com/');
    expect(lastSent().authToken).toBe('bp-secret');
  });

  // The reason this resolves on origin instead of startsWith.
  it('does not leak a token to a host that merely shares a string prefix', async () => {
    await nodeFetch('https://bp.example.com.attacker.test/status');
    expect(lastSent().authToken).toBeUndefined();
  });

  it('does not leak a token to a different scheme or port on the same host', async () => {
    await nodeFetch('http://bp.example.com/status');
    expect(lastSent().authToken).toBeUndefined();
    await nodeFetch('https://bp.example.com:8443/status');
    expect(lastSent().authToken).toBeUndefined();
  });

  it('sends nothing for an unknown origin', async () => {
    await nodeFetch('https://unknown.example/status');
    expect(lastSent().authToken).toBeUndefined();
  });

  it('sends nothing for a node with no token configured', async () => {
    await nodeFetch('http://localhost:12799/status');
    expect(lastSent().authToken).toBeUndefined();
  });

  it('survives an unparseable url and a node with a junk url', async () => {
    poolOperatorStore.nodes = [{ ...BP, url: 'not a url' }];
    await expect(nodeFetch('https://bp.example.com/status')).resolves.toBeTruthy();
    expect(lastSent().authToken).toBeUndefined();

    poolOperatorStore.nodes = [BP];
    await expect(nodeFetch('also not a url')).resolves.toBeTruthy();
    expect(lastSent().authToken).toBeUndefined();
  });
});
