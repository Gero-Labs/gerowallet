import { describe, expect, it } from 'vitest';
import { NOTIFY_ALERT_TYPES, alertTypesFor } from './notifyCatalogue';
import { KNOWN_EVENT_TYPES } from './notifyRender';

describe('notifyCatalogue', () => {
  it('lists every renderable event type except `test`, exactly once', () => {
    const ids = NOTIFY_ALERT_TYPES.map((a) => a.id);
    expect([...ids].sort()).toEqual(KNOWN_EVENT_TYPES.filter((t) => t !== 'test').sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('files every alert under a known category', () => {
    const cats = ['funds', 'staking', 'swap', 'adam', 'governance', 'remoteSigning'];
    for (const a of NOTIFY_ALERT_TYPES) expect(cats).toContain(a.category);
  });

  it('marks both remoteSigning alerts as security, and nothing else', () => {
    expect(alertTypesFor('remoteSigning').map((a) => a.id).sort()).toEqual(['new_device', 'signwake']);
    for (const a of NOTIFY_ALERT_TYPES) expect(a.security).toBe(a.category === 'remoteSigning');
  });
});
