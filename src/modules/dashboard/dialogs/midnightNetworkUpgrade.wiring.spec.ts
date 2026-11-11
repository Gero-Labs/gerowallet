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
  it('send dialog: Continue held (aria-disabled) with the reason linked, step 2 never opens, and backs out if it turns on', () => {
    const dialog = read('modules/dashboard/dialogs/MidnightSendDialog.vue');
    expect(dialog).toContain('const writeBlock = useMidnightWriteBlock(() => loggedWallet.value?.network);');
    expect(dialog).toContain('const writesPaused = computed(() => writeBlock.value !== null);');
    expect(dialog).toContain("? t('midnight.errors.updateRequired')");
    expect(dialog).toContain(':aria-disabled="writesPaused ? \'true\' : undefined"');
    expect(dialog).toContain(':aria-describedby="writesPaused ? \'midnight-send-paused\' : undefined"');
    expect(dialog).toContain('<GNote v-if="writesPaused" id="midnight-send-paused"');
    expect(dialog).toContain("t('midnight.upgrade.sendPaused', { network: midnightNetworkDisplayName(loggedWallet.value?.network) })");
    expect(dialog).toContain('{{ writesHeldText }}');
    expect(dialog).toContain('if (writesPaused.value) return;\n  if (currentStep.value === 1) {');
    expect(dialog).toContain('if (paused && currentStep.value === 2 && !sending.value) prevStep();');
    expect(dialog).toContain("if (writesPaused.value) return false;");
  });

  it('side panel sheet: the reason from step 1, Confirm held with it linked, no DUST fee note, the password step never opens', () => {
    const sheet = read('sidepanel/components/flows/MidnightSendSheet.vue');
    expect(sheet).toContain('<GNote v-if="writesPaused" icon="mdi-pause-circle-outline" role="status" class="mb-3" data-test="midnight-send-paused-start">');
    expect(sheet).toContain(':aria-disabled="writesPaused ? \'true\' : undefined"');
    expect(sheet).toContain(':aria-describedby="writesPaused ? \'midnight-sheet-send-paused\' : undefined"');
    expect(sheet).toMatch(/<template v-if="!writesPaused">\s*<GNote v-if="!isDustLow"/);
    expect(sheet).toContain('if (target === 4 && writesPaused.value) return;');
    expect(sheet).toContain('const writeBlock = useMidnightWriteBlock(() => loggedWallet.value?.network);');
    expect(sheet).toContain('const writesPaused = computed(() => writeBlock.value !== null);');
    expect(sheet).toContain("? t('midnight.errors.updateRequired')");
    expect(sheet).toContain("t('midnight.upgrade.sendPaused', { network: midnightNetworkDisplayName(loggedWallet.value?.network) })");
    expect(sheet.match(/\{\{ writesHeldText \}\}/g)?.length).toBe(2);
    expect(sheet).toMatch(/if \(paused && step\.value === 4 && !submitting\.value\) \{\s*approval\.invalidate\(\);\s*step\.value = 3;/);
  });

  it('DUST registration: Register held with the reason linked; the Cardano-held NIGHT sources stay open', () => {
    const dialog = read('modules/dashboard/dialogs/DustRegistrationDialog.vue');
    expect(dialog).toContain(':aria-disabled="writesPaused ? \'true\' : undefined"');
    expect(dialog).toContain(':aria-describedby="writesPaused ? \'dust-register-paused\' : undefined"');
    expect(dialog).toContain('id="dust-register-paused"');
    expect(dialog).toContain('const writeBlock = useMidnightWriteBlock(() => loggedWallet.value?.network);');
    expect(dialog).toContain('const writesPaused = computed(() => writeBlock.value !== null);');
    expect(dialog).toContain("? t('midnight.update.registrationHeld')");
    expect(dialog).toContain("t('midnight.upgrade.registrationPaused', { network: midnightNetworkDisplayName(loggedWallet.value?.network) })");
    expect(dialog).toContain('{{ writesHeldText }}');
    expect(dialog).toContain('if (!dustAddress.value || writesPaused.value) return;');
    expect(dialog).toContain('<v-btn block variant="outlined" class="mt-3" @click="sourcesOpen = true">');
  });

  it('DApp approvals (makeTransfer, balance, makeIntent): the reason replaces Approve, and the dapp gets InternalError with it on Close and Escape', () => {
    const overlay = read('sidepanel/components/DAppOverlay.vue');
    expect(overlay.match(/<template v-if="midnightWritesPaused">/g)?.length).toBe(3);
    expect(overlay).toContain('reject(midnightError(MidnightErrorCode.InternalError, midnightWritesPausedReason.value));');
    expect(overlay.match(/if \(midnightWritesPaused\.value\) return;/g)?.length).toBe(6);
    expect(overlay).toMatch(/function onEscapeReject\(\) \{\s*approval\.invalidate\(\);\s*if \(midnightWritesPaused\.value && MIDNIGHT_PAUSABLE_METHODS\.has\(currentRequest\.value\?\.method \?\? ''\)\) \{\s*\/\/[^\n]*\n\s*declineMidnightWhilePaused\(\);/);
    expect(overlay).toContain("'midnight_makeTransfer', 'midnight_balanceUnsealedTransaction', 'midnight_makeIntent',");
    // No DUST fee line while nothing can be sent.
    expect(overlay.match(/<p v-if="!midnightWritesPaused" class="grey--text text-caption mt-2 mb-0">\{\{ \$t\('midnight\.connector\.transferFeesNote'\) \}\}<\/p>/g)?.length).toBe(2);
    expect(overlay).toContain('<p v-if="!(midnightWritesPaused && intentPaysFees)"');
  });

  it('DApp submitTransaction is answered at once on a paused network, or one closed to this build', () => {
    const background = read('chrome/background.ts');
    const start = background.indexOf('app.add(MIDNIGHT_METHOD.submitTransaction,');
    const handler = background.slice(start, background.indexOf('\napp.add', start + 10));
    const gate = handler.indexOf('const writeBlock = await midnightWriteBlock(wallet.network);\n  if (writeBlock) {');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(handler.indexOf('getMidnightApi'));
    expect(handler).toContain('midnightApiError(MidnightErrorCode.InternalError, readableMidnightError(writeBlock, {}, wallet.network))');
    // The side panel's site tracker shows the refusal.
    const refusal = handler.slice(gate, handler.indexOf('return;', gate));
    expect(refusal).toContain("recordSiteActivity(request.origin as string, { type: 'submit-failed', reason: 'paused' })");
  });

  it('the status is read when a Midnight wallet opens and every few minutes', () => {
    const sync = read('services/midnight-sync.service.ts');
    expect(sync).toContain('void refreshMidnightWriteStatus(network, { force: true });');
    expect(sync).toContain('setInterval(() => { void refreshMidnightWriteStatus(network, { force: true }); }, MIDNIGHT_STATUS_POLL_MS);');
    expect(sync).toContain('if (this.writeStatusTimer) clearInterval(this.writeStatusTimer);\n    this.writeStatusTimer = null;');
  });

  it('the dashboard shows the banner on the Midnight page, with no wrapper left behind when it is hidden', () => {
    const page = read('modules/portfolio/PortfolioPage.vue');
    // Through the notice slot (MidnightNoticeSlot.vue), which shows the banner first among its notices.
    expect(page).toContain('<MidnightNoticeSlot class="portfolio-upgrade-banner" />');
    expect(page).not.toMatch(/<div class="pa-2 pb-0">\s*<MidnightNoticeSlot/);
    expect(read('modules/dashboard/components/MidnightNoticeSlot.vue')).toContain('upgrade: MidnightNetworkUpgradeBanner,');
  });

  it('the side panel home shows the banner above the balance and holds Midnight Send with the reason under it', () => {
    const home = read('sidepanel/pages/HomePage.vue');
    const banner = home.indexOf('<MidnightNoticeSlot v-if="isMidnight" layout="panel" class="home-upgrade-banner" />');
    expect(banner).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(home.indexOf('<BalanceSection'));
    expect(home).toContain(':disabled-ids="midnightSendPaused ? [\'send\'] : []"');
    expect(home).toContain('id="home-send-paused" class="home-send-paused t-caption"');
    expect(home).toContain('if (midnightSendPaused.value) return;\n        showMidnightSend.value = true;');
  });
});
