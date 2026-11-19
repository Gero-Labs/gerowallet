// The Solana home (SolanaDashboard) has no empty-state FundingCard, so the header must keep
// Send and Receive for a Solana wallet whatever its balance (which is not in account.controlled_amount).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(resolve(__dirname, 'ContentLayout.vue'), 'utf8').replace(/\r\n/g, '\n');

describe('Solana header quick actions', () => {
  it('never hides the quick-action buttons for a Solana wallet', () => {
    const body = layout.match(/const emptyStateShowing = computed\(\(\) => \{([\s\S]*?)\n\}\);/)?.[1] ?? '';
    expect(body).toMatch(/if \(currentPage\.value\?\.path !== '\/' \|\| chain === Blockchain\.MIDNIGHT \|\| chain === Blockchain\.SOLANA\) \{\s*return false;/);
  });
});
