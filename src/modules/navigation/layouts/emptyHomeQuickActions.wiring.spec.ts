// The header hides its quick actions on an empty home. Solana and Midnight balances are not in
// account.controlled_amount, so each is judged by its own store, before the Cardano account check;
// an empty Midnight home shows the FundingCard (its only Receive) in place of its transactions card.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8').replace(/\r\n/g, '\n');
const layout = read('ContentLayout.vue');
const portfolio = read('../../portfolio/PortfolioPage.vue');
const body = layout.match(/const emptyStateShowing = computed\(\(\) => \{([\s\S]*?)\n\}\);/)?.[1] ?? '';

describe('empty-home header quick actions', () => {
  it.each([
    ['Solana', 'if (isSolana.value) return isSolanaWalletEmpty(walletStore.solana);'],
    ['Midnight', 'if (isMidnight.value) return isMidnightWalletEmpty(midnightStore.balances, midnightStore.utxos);'],
  ])('judges a %s wallet by its own balance, before the Cardano account check', (_chain, line) => {
    const at = body.indexOf(line);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(body.indexOf('account.value'));
  });

  it('gives an empty Midnight home the FundingCard, so Receive stays on the page', () => {
    expect(portfolio).toContain('const isMidnightEmpty = computed(() => isMidnightWalletEmpty(midnightStore.balances, midnightStore.utxos));');
    expect(portfolio).toMatch(/<v-col v-if="isMidnightEmpty"[^>]*>\s*<FundingCard[^>]*@receive="openReceiveDialog\(\)"/);
    expect(portfolio).toMatch(/<v-col v-else [^>]*>\s*<MidnightTransactionsCard \/>/);
  });
});
