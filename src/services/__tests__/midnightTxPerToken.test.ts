/**
 * Reproduces the "Received +0.00 NIGHT" bug: a USDM movement on Midnight was
 * rendered as a NIGHT row with amount 0, because `midnight-sync.service.ts`
 * hardcoded `token: 'NIGHT'` and summed only native-NIGHT outputs.
 *
 * Drives the REAL pipeline rather than re-implementing the summing logic:
 * `midnightSyncService.start()` is the service's actual public entry point,
 * and it hands its `onSync` callback to `webSocketService.connect()` — the
 * exact callback gero-sync's live WS messages invoke. Only the WS transport
 * (`websocket.service`) and the Nexus tip bootstrap (`midnight-api`) are
 * mocked; `handleSync` -> `parseTx` -> `midnightActions.applyTransaction` all
 * run for real, and assertions read the result back out of `midnightStore`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock('@/services/websocket.service', () => ({
  default: {
    connect: h.connect,
    close: vi.fn(),
  },
}));

// bootstrapTipFromNexus is fire-and-forget from start() — stub it out so the
// test never makes a real Nexus/axios call.
vi.mock('@/api/midnight-api', () => ({
  getMidnightApi: () => ({
    getLatestBlock: async () => ({ height: 0 }),
  }),
}));

import midnightSyncService from '@/services/midnight-sync.service';
import type { WsSyncMessage } from '@/services/websocket.service';
import { midnightStore } from '@/stores/midnightStore';
import { Network } from '@/models/types';
import type { MidnightAddresses } from '@/chains/midnight/midnightTypes';

const USDM = '8c2c22bc0c37fa999d0611cb5c570f587938ac5ffc8b0925143dad4c0764e94b';
const NIGHT_ZERO = '0'.repeat(64);

const MY_ADDR = 'mn_addr1qtest_owner';
const OTHER_NIGHT_RECIPIENT = 'mn_addr1qtest_night_recipient';
const OTHER_USDM_RECIPIENT = 'mn_addr1qtest_usdm_recipient';

const ADDRESSES: MidnightAddresses = {
  dust: 'mn_dust-addr1qtest',
  shielded: 'mn_shield-addr1qtest',
  unshielded: MY_ADDR,
};

interface CapturedHandlers {
  onSync?: (data: WsSyncMessage) => Promise<void>;
}

/**
 * Drives the real sync pipeline: calls the service's public `start()`, grabs
 * the `onSync` handler it registered with (mocked) `webSocketService.connect`,
 * and feeds it a gero-sync-shaped payload — exactly what a live WS message
 * would do.
 */
async function sync(payload: WsSyncMessage): Promise<void> {
  midnightSyncService.start(Network.PREVIEW, ADDRESSES);
  const lastCall = h.connect.mock.calls[h.connect.mock.calls.length - 1];
  const handlers = lastCall[4] as CapturedHandlers;
  await handlers.onSync?.(payload);
}

function rowsForHash(hash: string) {
  return midnightStore.transactions.filter((t) => t.hash === hash);
}

describe('midnight-sync.service: one transaction row per token color', () => {
  beforeEach(() => {
    h.connect.mockClear();
    midnightStore.transactions = [];
    midnightStore.utxos = [];
    midnightStore.lastMidnightTxId = null;
  });

  it('a USDM-only receive is NOT rendered as NIGHT/0 — it carries the USDM color and the real amount', async () => {
    const hash = '11'.repeat(32);
    await sync({
      type: 'SYNC',
      transactions: [{
        tx_hash: hash,
        tx_timestamp: 1_700_000_000_000,
        utxo: {
          unshielded_created_outputs: [
            { owner: MY_ADDR, value: '10000000', token_type: USDM, intent_hash: 'intent-usdm', output_index: 0 },
          ],
          unshielded_spent_outputs: [],
        },
      }],
    });

    const rows = rowsForHash(hash);
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe(USDM);
    expect(rows[0].amount).toBe(10000000n);
    expect(rows[0].type).toBe('receive');
  });

  it('a NIGHT-only tx is unchanged', async () => {
    const hash = '22'.repeat(32);
    await sync({
      type: 'SYNC',
      transactions: [{
        tx_hash: hash,
        tx_timestamp: 1_700_000_001_000,
        utxo: {
          unshielded_created_outputs: [
            { owner: MY_ADDR, value: '5000000', token_type: NIGHT_ZERO, intent_hash: 'intent-night', output_index: 0 },
          ],
          unshielded_spent_outputs: [],
        },
      }],
    });

    const rows = rowsForHash(hash);
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe('NIGHT');
    expect(rows[0].amount).toBe(5000000n);
    expect(rows[0].type).toBe('receive');
  });

  it('a tx moving both NIGHT and USDM for our address yields two rows, one per color, each with its own amount', async () => {
    const hash = '33'.repeat(32);
    await sync({
      type: 'SYNC',
      transactions: [{
        tx_hash: hash,
        tx_timestamp: 1_700_000_002_000,
        utxo: {
          unshielded_created_outputs: [
            { owner: MY_ADDR, value: '3000000', token_type: NIGHT_ZERO, intent_hash: 'intent-mix-night', output_index: 0 },
            { owner: MY_ADDR, value: '7500000', token_type: USDM, intent_hash: 'intent-mix-usdm', output_index: 1 },
          ],
          unshielded_spent_outputs: [],
        },
      }],
    });

    const rows = rowsForHash(hash);
    expect(rows).toHaveLength(2);
    const nightRow = rows.find((r) => r.token === 'NIGHT');
    const usdmRow = rows.find((r) => r.token === USDM);
    expect(nightRow?.amount).toBe(3000000n);
    expect(usdmRow?.amount).toBe(7500000n);
  });

  it('counterparty on a mixed-color send is chosen per color, not always from the NIGHT output', async () => {
    const hash = '44'.repeat(32);
    await sync({
      type: 'SYNC',
      transactions: [{
        tx_hash: hash,
        tx_timestamp: 1_700_000_003_000,
        utxo: {
          unshielded_created_outputs: [
            { owner: OTHER_NIGHT_RECIPIENT, value: '1000000', token_type: NIGHT_ZERO, intent_hash: 'intent-send-night', output_index: 0 },
            { owner: OTHER_USDM_RECIPIENT, value: '2000000', token_type: USDM, intent_hash: 'intent-send-usdm', output_index: 1 },
          ],
          unshielded_spent_outputs: [
            { owner: MY_ADDR, value: '1000000', token_type: NIGHT_ZERO, intent_hash: 'intent-spend-night', output_index: 0 },
            { owner: MY_ADDR, value: '2000000', token_type: USDM, intent_hash: 'intent-spend-usdm', output_index: 1 },
          ],
        },
      }],
    });

    const rows = rowsForHash(hash);
    expect(rows).toHaveLength(2);
    const nightRow = rows.find((r) => r.token === 'NIGHT');
    const usdmRow = rows.find((r) => r.token === USDM);
    expect(nightRow?.type).toBe('send');
    expect(usdmRow?.type).toBe('send');
    expect(nightRow?.counterparty).toBe(OTHER_NIGHT_RECIPIENT);
    expect(usdmRow?.counterparty).toBe(OTHER_USDM_RECIPIENT);
  });

  it('a tx that moves nothing for us produces no rows', async () => {
    const hash = '55'.repeat(32);
    await sync({
      type: 'SYNC',
      transactions: [{
        tx_hash: hash,
        tx_timestamp: 1_700_000_004_000,
        utxo: {
          unshielded_created_outputs: [
            { owner: OTHER_NIGHT_RECIPIENT, value: '1000000', token_type: NIGHT_ZERO, intent_hash: 'intent-other-1', output_index: 0 },
          ],
          unshielded_spent_outputs: [],
        },
      }],
    });

    expect(rowsForHash(hash)).toHaveLength(0);
  });
});
