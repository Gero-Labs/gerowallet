import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source tripwires for the busy prover on both send surfaces. The retry rules
// (countdown, at most two automatic resubmits of the same bytes, Try again,
// Cancel, expiry) are unit-tested in src/services/midnightBusyRetry.spec.ts and
// at service level in src/services/midnight-tx.ledger.spec.ts.
const src = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(src, path), 'utf8');

describe.each([
  ['dashboard dialog', 'modules/dashboard/dialogs/MidnightSendDialog.vue'],
  ['side panel sheet', 'sidepanel/components/flows/MidnightSendSheet.vue'],
])('busy prover in the %s', (_name, path) => {
  const source = read(path);

  it('passes the busy handlers to the send', () => {
    expect(source.match(/busyHandlers\(current\),/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it('shows the countdown on the submit node', () => {
    expect(source).toMatch(/submitDetail: computed\(\(\) => \(busySeconds\.value != null \? String\(t\('midnight\.busy\.retrying', \{ n: busySeconds\.value \}\)\)/);
  });

  it('offers Try again and Cancel after the automatic resubmits, as an amber status note, and focuses Try again', () => {
    expect(source).toMatch(/<template v-if="busyPrompt">\s*<GNote icon="mdi-clock-outline" role="status"[\s\S]*?midnight\.busy\.stillBusy/);
    expect(source).toContain(`@click="answerBusy('retry')"`);
    expect(source).toContain(`@click="answerBusy('cancel')"`);
    expect(source).toContain(`busyActionsEl.value?.querySelector<HTMLElement>('[data-test="midnight-send-busy-retry"]')?.focus()`);
  });

  it('Cancel ends the countdown at once (its timer too)', () => {
    expect(source).toContain("if (choice === 'cancel') busyAbort?.abort();");
    expect(source).toContain('signal: busyAbort.signal,');
  });

  it('zeroes the PassKey secrets as soon as the transaction is signed', () => {
    expect(source).toMatch(/if \(stage === 'submitting' \|\| stage === 'provingCloud'\) (\{\s*credentials\.prfSecret\?\.fill\(0\);\s*sponsor\?\.prfSecret\?\.fill\(0\);|wipePasskeySecrets\(credentials, sponsor\);)/);
  });

  it('records the pending row for the wallet that sent before checking the view', () => {
    const pending = source.indexOf('if (isSameWallet(wallet)) void addOptimisticPendingTx(');
    expect(pending).toBeGreaterThan(-1);
    expect(source.indexOf('if (!current()) return;', pending)).toBeGreaterThan(pending);
  });

  it('drops a pending prompt (and with it the signed bytes) when the send ends or the view goes', () => {
    expect(source).toContain("answerBusy('cancel');\n");
    expect(source).toContain("onBeforeUnmount(() => answerBusy('cancel'));");
  });

  it('treats Cancel as no error, and says nothing was sent', () => {
    expect(source).toMatch(/if \(isMidnightBusyCancelled\(e\)\) \{\s*busyCancelled\.value = true;\s*return;/);
    expect(source).toMatch(/role="status"[^>]*data-test="midnight-send-cancelled">\s*\{\{ \$?t\('midnight\.busy\.nothingSent'\) \}\}/);
  });
});
