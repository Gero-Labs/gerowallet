// A Nexus-built send must not spend a coin set aside for an open swap offer:
// Nexus picks the coins, so the wallet refuses before it signs.
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/nexus-ledger-signing.json';
import * as ledger9 from '@midnightntwrk/ledger-v9';
import {
  assertSpendsNoReservedCoins, MIDNIGHT_SEND_SPENDS_OFFERED_COINS, spentCoinRefs, type MidnightTxView,
} from './midnightBuiltTxGuard';
import { LEDGER8_PROTOCOL_VERSION, LEDGER9_PROTOCOL_VERSION_SAMPLE, useMidnightChains } from '@test/helpers/midnightChains';

const NIGHT = '0'.repeat(64);
const onLedger9 = () => useMidnightChains({
  mainnet: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION],
  preprod: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER8_PROTOCOL_VERSION],
  preview: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER9_PROTOCOL_VERSION_SAMPLE],
});

describe('spentCoinRefs', () => {
  it('names every unshielded coin of every intent, guaranteed and fallible, hash in lower case', () => {
    const view: MidnightTxView = {
      intents: new Map<number, unknown>([
        [1, { guaranteedUnshieldedOffer: { inputs: [{ intentHash: 'AA'.repeat(32), outputNo: 0 }] } }],
        [2, { fallibleUnshieldedOffer: { inputs: [{ intentHash: 'bb'.repeat(32), outputNo: 3 }] } }],
      ]),
    };
    expect(spentCoinRefs(view)).toEqual([`${'aa'.repeat(32)}#0`, `${'bb'.repeat(32)}#3`]);
    expect(spentCoinRefs({})).toEqual([]);
  });
});

describe('assertSpendsNoReservedCoins', () => {
  it('passes with nothing reserved without decoding anything', async () => {
    await expect(assertSpendsNoReservedCoins('preprod', 'not even hex', new Set())).resolves.toBeUndefined();
  });

  it('refuses a real Nexus-built ledger 9 send that spends a reserved coin, and passes one that does not', async () => {
    onLedger9();
    const vector = fixture.transfers.find(v => v.network === 'preprod' && v.token === NIGHT)!;
    const tx = ledger9.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', Buffer.from(vector.unprovenTxHex, 'hex'));
    const refs = spentCoinRefs(tx as unknown as MidnightTxView);
    expect(refs.length).toBeGreaterThan(0);

    await expect(assertSpendsNoReservedCoins('preprod', vector.unprovenTxHex, new Set([refs[0]])))
      .rejects.toThrow(MIDNIGHT_SEND_SPENDS_OFFERED_COINS);
    await expect(assertSpendsNoReservedCoins('preprod', vector.unprovenTxHex, new Set([`${'cd'.repeat(32)}#0`])))
      .resolves.toBeUndefined();
  });
});
