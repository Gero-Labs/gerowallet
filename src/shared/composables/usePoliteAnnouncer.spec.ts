import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import { usePoliteAnnouncer } from './usePoliteAnnouncer';

describe('usePoliteAnnouncer', () => {
  it('sets the message on the next tick, and says the same text again when asked twice', async () => {
    const { message, announce } = usePoliteAnnouncer();
    announce('Proving with Gero Cloud');
    expect(message.value).toBe('');
    await nextTick();
    expect(message.value).toBe('Proving with Gero Cloud');
    announce('Proving with Gero Cloud');
    expect(message.value).toBe('');
    await nextTick();
    expect(message.value).toBe('Proving with Gero Cloud');
  });

  it('the last of two calls in one tick wins', async () => {
    const { message, announce } = usePoliteAnnouncer();
    announce('first');
    announce('second');
    await nextTick();
    expect(message.value).toBe('second');
  });
});
