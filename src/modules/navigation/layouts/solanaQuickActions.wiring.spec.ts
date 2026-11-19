// The header hides its quick actions on an empty home. A Solana balance is not in
// account.controlled_amount, so a Solana wallet is judged by its own Gero Sync snapshot.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(resolve(__dirname, 'ContentLayout.vue'), 'utf8').replace(/\r\n/g, '\n');
const body = layout.match(/const emptyStateShowing = computed\(\(\) => \{([\s\S]*?)\n\}\);/)?.[1] ?? '';

describe('Solana header quick actions', () => {
  it('judges a Solana wallet by its Solana balance, before the Cardano account check', () => {
    const solana = body.indexOf('if (isSolana.value) return isSolanaWalletEmpty(walletStore.solana);');
    expect(solana).toBeGreaterThan(-1);
    expect(solana).toBeLessThan(body.indexOf('account.value'));
  });
});
