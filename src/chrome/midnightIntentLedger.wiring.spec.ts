import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source tripwires for makeIntent's ledger routing in the worker. The builders
// are unit-tested in midnightIntentBuilder.spec.ts (ledger 8) and
// midnightIntentBuilder9.spec.ts (ledger 9), the request check and the sync
// rule in midnightConnectorIntent.spec.ts.
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

/** The source of `name`'s body, up to the next method of the class. */
function method(source: string, name: string): string {
  const start = source.indexOf(`  async ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n  async ', start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

describe('makeIntent follows the chain\'s ledger', () => {
  it('worker: a ledger 9 chain is refused before the wallet is unlocked unless the wallet has synced (review S1)', () => {
    const body = method(read('chrome/walletBg.ts'), 'buildMidnightConnectorIntent');
    const syncCheck = body.indexOf('if (await resolveMidnightLedger(network) === 9 && !connectorIntentSyncReady(midnightStore)) {');
    expect(syncCheck).toBeGreaterThan(-1);
    expect(body.indexOf('throw new Error(MIDNIGHT_WALLET_NOT_SYNCED);')).toBeGreaterThan(syncCheck);
    for (const unlock of ['decryptMnemonicWithPrfOutput', 'openMnemonicWithPassword', 'deriveMidnightAccountKeys']) {
      expect(body.indexOf(unlock)).toBeGreaterThan(syncCheck);
    }
  });

  it('worker: the chain\'s ledger picks the builder; ledger 9 builds from the synced UTxOs and their sync', () => {
    const body = method(read('chrome/walletBg.ts'), 'buildMidnightConnectorIntent');
    const route = body.indexOf('if (await resolveMidnightLedger(endpoints.sdkNetworkId) === 9) {');
    expect(route).toBeGreaterThan(-1);
    const ledger9 = body.indexOf('await buildConnectorIntent9({', route);
    expect(ledger9).toBeGreaterThan(route);
    expect(body.slice(ledger9)).toMatch(/utxos: midnightStore\.utxos,\s+sync: midnightStore,/);
    expect(body.indexOf('await buildConnectorIntent({')).toBeGreaterThan(ledger9);
  });

  it('dapp request: a ledger 9 intent before the wallet has synced is answered without opening the prompt', () => {
    const source = read('chrome/background.ts');
    const handler = source.slice(source.indexOf('app.add(MIDNIGHT_METHOD.makeIntent,'));
    const check = handler.indexOf('if (knownMidnightLedger(currentWallet.network) === 9 && !connectorIntentSyncReady(midnightStoreSync)) {');
    expect(check).toBeGreaterThan(-1);
    expect(handler.indexOf('CONNECTOR_NOT_SYNCED_REASON', check)).toBeGreaterThan(check);
    expect(handler.indexOf('parkMidnightRequest(MIDNIGHT_METHOD.makeIntent')).toBeGreaterThan(check);
  });

  it('the approval says the TTL the builders use (55 minutes, under the ledger\'s one-hour cap)', () => {
    const handler = read('chrome/background.ts');
    expect(handler).toContain('ttlMinutes: Math.round(CONNECTOR_INTENT_TTL_MS / 60_000),');
    expect(read('sidepanel/components/DAppOverlay.vue')).toContain('const intentTtlMinutes = computed(() => intentPayload.value.ttlMinutes ?? 55);');
  });
});
