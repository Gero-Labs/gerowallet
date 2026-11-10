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

  it('offers Try again after LEDGER_MISMATCH, and Try again sends again from a new build', () => {
    expect(source).toContain("ledgerMismatch.value = midnightApiErrorKind(e) === 'ledgerMismatch';");
    expect(source).toMatch(/<GButton\s+v-if="canRetryLedgerMismatch"\s+tier="tertiary"[\s\S]*?@click="retryLedgerMismatch\(\)"[\s\S]*?common\.tryAgain/);
    const retry = source.slice(source.indexOf('async function retryLedgerMismatch()'));
    expect(retry.slice(0, retry.indexOf('\n}\n'))).toContain('await submitWithPassword();');
  });
});
