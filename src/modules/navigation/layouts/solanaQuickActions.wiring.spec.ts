// The Solana home (SolanaDashboard) never renders the empty-state FundingCard, and a Solana balance is
// not in account.controlled_amount, so the header must not treat every Solana wallet as empty.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(resolve(__dirname, 'ContentLayout.vue'), 'utf8').replace(/\r\n/g, '\n');

describe('Solana header quick actions', () => {
  it('never hides the quick-action buttons for a Solana wallet', () => {
    const body = layout.match(/const emptyStateShowing = computed\(\(\) => \{([\s\S]*?)\n\}\);/)?.[1] ?? '';
    // The first early return of the computed must cover Solana, however the condition is written.
    const earlyReturn = body.match(/if \(([^{]*)\) \{\s*return false;/)?.[1] ?? '';
    expect(earlyReturn).toMatch(/isSolana\.value|Blockchain\.SOLANA/);
  });
});
