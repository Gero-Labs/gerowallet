// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import * as ledger9 from '@midnightntwrk/ledger-v9';

// The ledger 9 decoder is loaded lazily. If that load fails, the bytes are
// unreadable to this build: refused with UNREADABLE, never the mismatch copy.
vi.mock('./midnightLedger9', () => { throw new Error('chunk failed to load'); });

import { MIDNIGHT_BUILT_TX_UNREADABLE, decodeUnprovenMidnightTransaction } from './midnightBuiltTxGuard';

const hexOf = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

describe('when the ledger 9 decoder cannot be loaded', () => {
  it('a ledger 8 network refuses undecodable bytes as UNREADABLE', async () => {
    await expect(decodeUnprovenMidnightTransaction('preprod', hexOf(ledger9.Transaction.fromParts('preprod').serialize())))
      .rejects.toMatchObject({ name: 'MidnightBuiltTxUnreadableError', newerLedger: false, message: MIDNIGHT_BUILT_TX_UNREADABLE });
  });

  it('the ledger 9 network refuses as UNREADABLE', async () => {
    await expect(decodeUnprovenMidnightTransaction('stagenet', 'deadbeef'))
      .rejects.toMatchObject({ name: 'MidnightBuiltTxUnreadableError', message: MIDNIGHT_BUILT_TX_UNREADABLE });
  });
});
