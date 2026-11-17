// The network popup for a Solana wallet: networkStore.tip is Cardano-shaped, so Solana reads its
// own sync state (walletStore.solana) for Last Sync and the slot, and gets no epoch or progress.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(resolve(__dirname, 'ContentLayout.vue'), 'utf8').replace(/\r\n/g, '\n');

describe('Solana network status', () => {
  it('shows the slot Gero Sync last reported instead of an epoch and its progress', () => {
    expect(layout).toContain('const solanaTipSlot = computed(() => walletStore.solana?.tipSlot ?? null);');
    expect(layout).toMatch(/<template v-else-if="isSolana">[\s\S]*?t\('poolOperator\.slot'\)[\s\S]*?formatInt\(solanaTipSlot\)[\s\S]*?<\/template>/);
  });

  it('takes Last Sync from the last Solana update', () => {
    expect(layout).toContain(': isSolana.value ? walletStore.solana?.lastSyncAt');
  });

  it('draws no epoch progress bar', () => {
    expect(layout).toContain('v-if="!compactNav && !isMidnight && !isBitcoin && !isSolana"');
    expect(layout).toContain('if (isMidnight.value || isSolana.value) return 0;');
  });
});
