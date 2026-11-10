import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source tripwires for the "Midnight network upgrade" gate on every write surface.
// The state itself (per network, sources, expiry, shared across contexts) is
// unit-tested in midnightWriteGate.spec.ts and midnightWriteStatus.spec.ts; the
// service-level refusals before keys, sync and proving in midnight-tx.ledger.spec.ts.
const src = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(src, path), 'utf8');

describe('Midnight network upgrade wiring', () => {
  it('send dialog: Continue disabled with the reason, step 2 never opens, and backs out if it turns on', () => {
    const dialog = read('modules/dashboard/dialogs/MidnightSendDialog.vue');
    expect(dialog).toContain('const writesPaused = useMidnightNetworkUpgrading(() => loggedWallet.value?.network);');
    expect(dialog).toContain(':disabled="sending || writesPaused"');
    expect(dialog).toContain("t('midnight.upgrade.sendPaused', { network: midnightNetworkDisplayName(loggedWallet?.network) })");
    expect(dialog).toContain('if (writesPaused.value) return;\n  if (currentStep.value === 1) {');
    expect(dialog).toContain('if (paused && currentStep.value === 2 && !sending.value) prevStep();');
    expect(dialog).toContain("if (writesPaused.value) return false;");
  });

  it('side panel sheet: Confirm send disabled with the reason, the password step never opens', () => {
    const sheet = read('sidepanel/components/flows/MidnightSendSheet.vue');
    expect(sheet).toContain(':disabled="writesPaused"');
    expect(sheet).toContain('if (target === 4 && writesPaused.value) return;');
    expect(sheet).toContain("$t('midnight.upgrade.sendPaused', { network: midnightNetworkDisplayName(loggedWallet?.network) })");
    expect(sheet).toMatch(/if \(paused && step\.value === 4 && !submitting\.value\) \{\s*approval\.invalidate\(\);\s*step\.value = 3;/);
  });

  it('DUST registration: Register disabled with the reason; the Cardano-held NIGHT sources stay open', () => {
    const dialog = read('modules/dashboard/dialogs/DustRegistrationDialog.vue');
    expect(dialog).toContain(':disabled="!dustAddress || writesPaused"');
    expect(dialog).toContain("t('midnight.upgrade.registrationPaused', { network: midnightNetworkDisplayName(loggedWallet?.network) })");
    expect(dialog).toContain('if (!dustAddress.value || writesPaused.value) return;');
    expect(dialog).toContain('<v-btn block variant="outlined" class="mt-3" @click="sourcesOpen = true">');
  });

  it('DApp approvals: the reason replaces Approve, and the dapp gets InternalError with it', () => {
    const overlay = read('sidepanel/components/DAppOverlay.vue');
    expect(overlay.match(/<template v-if="midnightWritesPaused">/g)?.length).toBe(2);
    expect(overlay).toContain('reject(midnightError(MidnightErrorCode.InternalError, midnightWritesPausedReason.value));');
    expect(overlay.match(/if \(midnightWritesPaused\.value\) return;/g)?.length).toBe(4);
  });

  it('DApp submitTransaction is answered at once on a paused network', () => {
    const background = read('chrome/background.ts');
    const start = background.indexOf('app.add(MIDNIGHT_METHOD.submitTransaction,');
    const handler = background.slice(start, background.indexOf('\napp.add', start + 10));
    const gate = handler.indexOf('if (await isMidnightNetworkUpgrading(wallet.network)) {');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(handler.indexOf('getMidnightApi'));
    expect(handler).toContain("midnightApiError(MidnightErrorCode.InternalError, readableMidnightError('networkUpgrading', {}, wallet.network))");
  });

  it('the status is read when a Midnight wallet opens and every few minutes', () => {
    const sync = read('services/midnight-sync.service.ts');
    expect(sync).toContain('void refreshMidnightWriteStatus(network, { force: true });');
    expect(sync).toContain('setInterval(() => { void refreshMidnightWriteStatus(network, { force: true }); }, MIDNIGHT_STATUS_POLL_MS);');
    expect(sync).toContain('if (this.writeStatusTimer) clearInterval(this.writeStatusTimer);\n    this.writeStatusTimer = null;');
  });

  it('the dashboard shows the banner on the Midnight page', () => {
    expect(read('modules/portfolio/PortfolioPage.vue')).toContain('<MidnightNetworkUpgradeBanner />');
  });
});
