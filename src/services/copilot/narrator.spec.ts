// src/services/copilot/narrator.spec.ts
import { describe, it, expect } from 'vitest';
import { narrate, NARRATION_TEXT_KEYS } from './narrator';
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

  it('default vibe (omitted) and explicit normal both use the unprefixed keys', () => {
    expect(narrate(ev({})).textKey).toBe('copilot.feed.heldPriceUp');
    expect(narrate(ev({}), 'normal').textKey).toBe('copilot.feed.heldPriceUp');
  });

  it('prefixes the key for chill/spicy vibes, params unchanged', () => {
    const spicy = narrate(ev({ held: true, kind: 'priceUp' }), 'spicy');
    expect(spicy.textKey).toBe('copilot.feed.spicy.heldPriceUp');
    expect(spicy.params).toEqual({ ticker: 'SNEK', pct: 22, window: '24h' });
    expect(narrate(ev({ held: false, kind: 'priceDown' }), 'chill').textKey).toBe(
      'copilot.feed.chill.watchedPriceDown',
    );
  });

  it('narrates a token-activity spike (vibe only, no scope/direction)', () => {
    const spike = {
      key: 'tokenActivitySpike:u:day-1',
      kind: 'tokenActivitySpike' as const,
      unit: 'u',
      ticker: 'SNEK',
      mult: 6,
    };
    expect(narrate(spike)).toEqual({
      key: 'tokenActivitySpike:u:day-1',
      textKey: 'copilot.feed.tokenActivitySpike',
      params: { ticker: 'SNEK', mult: 6 },
    });
    expect(narrate(spike, 'spicy').textKey).toBe('copilot.feed.spicy.tokenActivitySpike');
  });

  it('NARRATION_TEXT_KEYS contains exactly the derivable keys (price x vibe x scope x dir + spike x vibe)', () => {
    const expected: string[] = [];
    for (const vibe of ['normal', 'chill', 'spicy'] as const) {
      const prefix = vibe === 'normal' ? '' : `${vibe}.`;
      for (const scope of ['held', 'watched']) {
        for (const dir of ['Up', 'Down']) {
          expected.push(`copilot.feed.${prefix}${scope}Price${dir}`);
        }
      }
      expected.push(`copilot.feed.${prefix}tokenActivitySpike`);
    }
    expect([...NARRATION_TEXT_KEYS].sort()).toEqual(expected.sort());
  });
});
