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

  // A dApp transaction that spends the user's own Gero listing or creates one is signable once
  // approved, so both surfaces must give the summary the wallet's stored listings and the network's
  // listing scripts (their only protection is the preview), and never behind the UI feature flag:
  // the signing guard applies whatever the flag says, so the preview must too.
  for (const file of ['sidepanel/components/DAppOverlay.vue', 'popup/modules/views/SignTx.vue']) {
    it(`${file} gives the summary the wallet's own listings and the listing scripts, whatever the flag says`, () => {
      const src = read(file);
      const at = src.indexOf('approvalMarketContext(');
      expect(at).toBeGreaterThan(-1);
      const call = src.slice(at, at + 400);
      expect(call).toContain('listedListings');
      expect(call).toContain('networks.resolveNftMarketDeployments(');
      expect(call).not.toContain('isNftMarketEnabled');
      expect(src).toMatch(/market: approvalMarketContext\(/);
    });
  }

  // A listing a dApp creates that pays someone else (owner or seller not the wallet, terms unreadable,
  // royalties or share off), or a spent listing whose NFT does not come back, blocks Sign on both
  // surfaces until the user acknowledges it, and the acknowledgement starts over for each request.
  for (const [file, gate] of [
    ['sidepanel/components/DAppOverlay.vue', /approvalSummary\.value\?\.requiresMarketAck && !marketAck\.value/],
    ['popup/modules/views/SignTx.vue', /approvalSummary\.value\.requiresMarketAck && !marketAck\.value/],
  ] as const) {
    it(`${file} gates Sign on the market acknowledgement`, () => {
      const src = read(file);
      expect(src).toMatch(gate);
      expect(src).toContain('v-model:market-ack="marketAck"');
      expect(src).toContain('const marketAck = ref(false)');
    });
  }

  it('the side panel forgets the market acknowledgement with every other per-request one', () => {
    const src = read('sidepanel/components/DAppOverlay.vue');
    expect(src).toMatch(/foreignValueAck\.value = false;\s*marketAck\.value = false;/);
  });

  // The Sign button is disabled while any gate holds, but Enter in the password field and the PassKey,
  // Ledger, Trezor and Keystone entry points are not the button: each tx signer checks the same gate
  // itself, before it awaits anything.
  it('every side-panel tx signer checks signTxBlocked before anything is awaited', () => {
    const src = read('sidepanel/components/DAppOverlay.vue');
    for (const name of ['signNormal', 'signPrf', 'signLedger', 'signTrezor', 'signKeystone']) {
      const at = src.indexOf(`async function ${name}() {`);
      expect(at, name).toBeGreaterThan(-1);
      const head = src.slice(at, src.indexOf('await ', at));
      expect(head, name).toMatch(/if \(signTxBlocked\.value\) return;\s*return approval\.run/);
    }
  });

  it('the popup holds Sign for a transaction it sent but could not summarise, until acknowledged', () => {
    const src = read('popup/modules/views/SignTx.vue');
    expect(src).toMatch(/txDecodeFailed = computed\(\(\) => !!request\.value\?\.data\?\.tx && !approvalSummary\.value\)/);
    expect(src).toMatch(/txDecodeFailed\.value && !decodeFailedAck\.value/);
  });

  it('the approval context takes its market part as required (no empty default that fails open)', () => {
    const src = read('shared/utils/txApprovalSummary.ts');
    expect(src).toMatch(/extras: \{[^}]*market: ApprovalMarketContext \}\s*,?\s*\): ApprovalContext/);
    expect(src).not.toMatch(/market\?: ApprovalMarketContext/);
    expect(src).not.toMatch(/extras\.market\?\./);
  });

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
