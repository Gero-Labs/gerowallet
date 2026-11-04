// The dashboard bell's badge: every "Needs you" source lights it. The SPO key warning and the
// unread inbox rows (sticky security items) always did; the stuck-items row (NFT rescue) now does.
// ContentLayout itself cannot be mounted in a unit test (see agentDockPlacement.spec.ts), so the
// decision lives in a pure function.
import { describe, expect, it } from 'vitest';
import { bellBadge } from './bellBadge';

const ACCENT = 'var(--g-accent)';

describe('bellBadge', () => {
  it('is off when nothing needs the user', () => {
    expect(bellBadge({ kesVisible: false, unread: 0, legacyCount: 0 }).visible).toBe(false);
  });

  it('lights a dot in the accent colour for stuck items alone, not the error colour', () => {
    expect(bellBadge({ kesVisible: false, unread: 0, legacyCount: 4 })).toEqual({ visible: true, content: undefined, dot: true, color: ACCENT });
  });

  it('keeps the error dot for the SPO key warning alone', () => {
    expect(bellBadge({ kesVisible: true, unread: 0, legacyCount: 0 })).toEqual({ visible: true, content: undefined, dot: true, color: 'error' });
  });

  it('keeps the error dot for the key warning when stuck items are there too', () => {
    expect(bellBadge({ kesVisible: true, unread: 0, legacyCount: 4 }).color).toBe('error');
  });

  it('shows the unread count in the accent colour, as before', () => {
    expect(bellBadge({ kesVisible: false, unread: 3, legacyCount: 0 })).toEqual({ visible: true, content: '3', dot: false, color: ACCENT });
  });

  it('does not change the unread count or colour for the key warning or stuck items', () => {
    expect(bellBadge({ kesVisible: true, unread: 3, legacyCount: 0 })).toEqual({ visible: true, content: '3', dot: false, color: ACCENT });
    expect(bellBadge({ kesVisible: false, unread: 3, legacyCount: 5 })).toEqual({ visible: true, content: '3', dot: false, color: ACCENT });
  });
});
