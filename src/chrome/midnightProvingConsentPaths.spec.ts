// PRIV-01: every dapp path that would hand proof inputs to a remote prover is
// gated on the user's chosen mode and recorded consent. The handlers live in
// the background module / side-panel SFC with no mount harness; these
// tripwires pin the gates.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('dapp proving consent gates', () => {
  it('submitTransaction relays an unsealed tx to Gero Cloud only in remote mode with cloud consent', () => {
    const bg = read('chrome/background.ts');
    const start = bg.indexOf('app.add(MIDNIGHT_METHOD.submitTransaction');
    const handler = bg.slice(start, bg.indexOf('\napp.add', start + 10));
    const gate = handler.indexOf('if (!sealed) {');
    const relay = handler.indexOf('api.submitMidnightTx(');
    expect(gate).toBeGreaterThan(-1);
    expect(relay).toBeGreaterThan(gate);
    const block = handler.slice(gate, relay);
    expect(block).toContain("midnightStore.proofServer.mode !== 'remote'");
    expect(block).toContain("hasMidnightProvingConsent(midnightStore.shieldedProvingConsent, 'cloud')");
    expect(block).toContain('throw new Error(');
  });

  it('the makeTransfer approval checks the chosen prover\'s consent before any credential is used', () => {
    const overlay = read('sidepanel/components/DAppOverlay.vue');
    for (const fn of ['async function signMidnightTransferNormal() {', 'async function signMidnightTransferPrf() {']) {
      const body = overlay.slice(overlay.indexOf(fn), overlay.indexOf('buildMidnightTransferTx(', overlay.indexOf(fn)));
      expect(body).toContain('if (transferNeedsProvingConsent()) return;');
    }
    expect(overlay).toContain("$t('midnight.connector.transferProvedBy', { prover: transferProverLabel })");
  });
});
