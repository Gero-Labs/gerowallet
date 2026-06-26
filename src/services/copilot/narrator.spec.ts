// src/services/copilot/narrator.spec.ts
import { describe, it, expect } from 'vitest';
import { narrate } from './narrator';
import type { FeedEvent } from './detectors';

const ev = (over: Partial<FeedEvent>): FeedEvent => ({
  key: 'priceUp:24h:u:day-1', kind: 'priceUp', unit: 'u', ticker: 'SNEK', held: true, window: '24h', pct: 22, ...over,
});

describe('narrate', () => {
  it('maps a held up-move to the held-up template with params', () => {
    expect(narrate(ev({ kind: 'priceUp', held: true }))).toEqual({
      key: 'priceUp:24h:u:day-1',
      textKey: 'copilot.feed.heldPriceUp',
      params: { ticker: 'SNEK', pct: 22, window: '24h' },
    });
  });

  it('maps a watched down-move to the watched-down template', () => {
    expect(narrate(ev({ kind: 'priceDown', held: false, pct: 30, window: '7d' }))).toMatchObject({
      textKey: 'copilot.feed.watchedPriceDown',
      params: { ticker: 'SNEK', pct: 30, window: '7d' },
    });
  });
});
