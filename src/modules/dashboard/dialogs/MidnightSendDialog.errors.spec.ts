import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source tripwire for the send dialog's error handling. The errors themselves
// (readable copy per server error code) are unit-tested in
// src/api/midnightApiError.spec.ts, and a retry issuing a new build request in
// src/services/midnight-tx.ledger.spec.ts.
const source = readFileSync(join(__dirname, 'MidnightSendDialog.vue'), 'utf8');

describe('Midnight send dialog errors', () => {
  it('shows the error\'s readable message for both public and private sends', () => {
    expect(source).toContain('errorMessage.value = e instanceof Error ? e.message : String(e);');
    expect(source.match(/showSendError\(e\);/g)?.length).toBe(2);
  });

  it('after LEDGER_MISMATCH the one CTA reads Try again, for password and PassKey wallets', () => {
    expect(source).toContain("ledgerMismatch.value = midnightApiErrorKind(e) === 'ledgerMismatch';");
    expect(source).toContain("const sendCtaText = computed(() => (ledgerMismatch.value ? t('common.tryAgain') : t('midnight.signAndSend')));");
    expect(source).toContain(':submit-text="sendCtaText"');
    expect(source).toContain(":passkey-text=\"ledgerMismatch ? t('common.tryAgain') : ''\"");
    expect(source).toMatch(/<GButton\s+v-else-if="currentStep === 2 && !isPrfWallet"\s+tier="primary"[\s\S]*?@click="submitWithPassword\(\)"\s*>\{\{ sendCtaText \}\}<\/GButton>/);
    expect(source).not.toContain('canRetryLedgerMismatch');
  });

  it('Continue and Sign and send are the design system\'s primary GButton', () => {
    expect(source).toMatch(/<GButton\s+v-if="currentStep === 1"\s+tier="primary"/);
    // The arrow inherits the button's colour; no inline override.
    expect(source).toContain('<v-icon size="small" class="ml-1">mdi-arrow-right</v-icon>');
  });

  it('a paused network or an unsupported ledger is an amber note, not an error, and disables the CTA', () => {
    // After the network upgrade gate's own note (midnightWriteGate.ts), when that is on.
    expect(source).toMatch(/<GNote v-(?:else-)?if="sendBlock" id="midnight-send-blocked" icon="mdi-pause-circle-outline" role="status"/);
    expect(source).not.toContain('midnight-dust-note');
    expect(source).toContain(':loading="sending || checkingLocalProver || !!sendBlock"');
    expect(source).toContain(':disabled="sending || checkingLocalProver || !!sendBlock"');
    expect(source).toMatch(/<p v-if="errorMessage" role="alert" class="error--text t-caption/);
  });
});
