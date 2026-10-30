import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tripwire: both dApp signTx approval surfaces (side panel and popup fallback)
 * render the shared approval summary, and both gate Sign on the network
 * acknowledgement. The popup used to show only the first recipient, net amount
 * and fee, hiding certificates, withdrawals, minting, collateral and votes.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('signTx approval surfaces share one summary', () => {
  for (const file of ['sidepanel/components/DAppOverlay.vue', 'popup/modules/views/SignTx.vue']) {
    it(`${file} builds the shared summary and renders every effect`, () => {
      const src = read(file);
      expect(src).toContain('buildTxApprovalSummary(');
      expect(src).toContain('<TxApprovalIntents');
      expect(src).toContain('<TransactionDetailsCard');
    });
  }

  it('the popup blocks Sign (button, PassKey and Enter) until a network mismatch is acknowledged', () => {
    const src = read('popup/modules/views/SignTx.vue');
    const start = src.indexOf('const sign = () => approval.run(async () => {');
    expect(start).toBeGreaterThan(-1);
    const sign = src.slice(start);
    const gate = sign.indexOf('if (signBlocked.value) return;');
    expect(gate).toBeGreaterThan(-1);
    expect(sign.indexOf('approval.run(')).toBeGreaterThan(-1);
    // The gate must still run before any awaited authorization/signing work,
    // even when single-flight protection wraps the handler.
    expect(gate).toBeLessThan(sign.indexOf('await '));
    expect((src.match(/signBlocked/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('the side panel gates Sign on the same summary-driven mismatch flag', () => {
    const src = read('sidepanel/components/DAppOverlay.vue');
    expect(src).toMatch(/s\.bodyNetworkMismatch \|\| s\.outputNetworkMismatch/);
  });

  // A deposit refunded to someone else, or the wallet's collateral returned to a
  // foreign address, blocks Sign on both surfaces until acknowledged, and both
  // give the summary the wallet's UTxOs so "You pay" counts the wallet's inputs.
  for (const [file, gate] of [
    ['sidepanel/components/DAppOverlay.vue', /approvalSummary\.value\?\.requiresForeignValueAck && !foreignValueAck\.value/],
    ['popup/modules/views/SignTx.vue', /approvalSummary\.value\.requiresForeignValueAck && !foreignValueAck\.value/],
  ] as const) {
    it(`${file} gates Sign on the foreign-value acknowledgement and passes its UTxOs`, () => {
      const src = read(file);
      expect(src).toMatch(gate);
      expect(src).toContain('v-model:foreign-value-ack="foreignValueAck"');
      expect(src).toMatch(/return \[\.\.\.utxos\.value, \.\.\.\(collateral \? \[collateral\] : \[\]\)\]/);
    });

    // The UTxO list comes from gero-sync: what the summary counts is checked against
    // the transactions that created those UTxOs, and a misstated input holds Sign.
    it(`${file} counts proven UTxOs and gates Sign on a misstated input`, () => {
      const src = read(file);
      expect(src).toContain('useProvenApprovalUtxos(');
      expect(src).toContain('ownUtxos: provenOwnUtxos.value');
      expect(src).toMatch(/inputsMisreported\.value && !inputsMisreportedAck\.value/);
      expect(src).toContain('v-model:inputs-misreported-ack="inputsMisreportedAck"');
      expect(src).toContain(':inputs-misreported="inputsMisreported"');
    });
  }
});
