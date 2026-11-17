// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// The ledger 8 decoder and the ledger helpers are loaded lazily. If a load
// fails, the bytes are unreadable to this build: refused with UNREADABLE,
// never the mismatch copy, and never signed.
vi.mock('@midnight-ntwrk/ledger-v8', () => { throw new Error('chunk failed to load'); });

import { MIDNIGHT_BUILT_TX_UNREADABLE, decodeUnprovenMidnightTransaction } from './midnightBuiltTxGuard';

describe('when the ledger 8 decoder cannot be loaded', () => {
  it('a ledger 8 network refuses as UNREADABLE', async () => {
    await expect(decodeUnprovenMidnightTransaction('preprod', 'aabb'))
      .rejects.toMatchObject({ name: 'MidnightBuiltTxUnreadableError', message: MIDNIGHT_BUILT_TX_UNREADABLE });
  });
});
