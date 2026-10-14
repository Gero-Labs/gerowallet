import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';

const calls = vi.hoisted(() => ({ build: vi.fn(), send: vi.fn(), auth: vi.fn() }));
vi.mock('@/api/strike-v2.user', () => ({ strikeUserApi: { buildDepositTx: calls.build } }));
vi.mock('@/api/strike-v2.client', () => ({ hasStrikeApiKeys: calls.auth }));
vi.mock('@/stores/walletStore', () => ({ walletStore: {} }));
vi.mock('@/stores/priceStore', () => ({ priceStore: {} }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: calls.send } }));
vi.mock('@/chrome/cardanoJsSdkCbor', () => ({ serializeCardanoJsSdkTx: vi.fn() }));
vi.mock('@/modules/swap/composables/utxoToCip30Hex', () => ({ utxoToCip30Hex: vi.fn() }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));

import { useStrikeDeposit } from './useStrikeDeposit';

enableAutoUnmount(afterEach);
beforeEach(() => vi.clearAllMocks());
function render() {
  let deposit!: ReturnType<typeof useStrikeDeposit>;
  mount(defineComponent({ setup: () => { deposit = useStrikeDeposit(); deposit.reset(); return () => null; } }));
  return deposit;
}

describe('account deposits reject managed-vault requests', () => {
  it.each(['vault-a', ''])('rejects vault identifier %j before building or authorization', async vaultId => {
    const deposit = render();
    expect(await deposit.buildAndSign('unused-password', vaultId)).toBe(false);
    expect(deposit.error.value).toBe('vaults.transfersUnavailable');
    expect(deposit.status.value).toBe('error');
    expect(calls.auth).not.toHaveBeenCalled();
    expect(calls.build).not.toHaveBeenCalled();
    expect(calls.send).not.toHaveBeenCalled();
  });

  it('preserves the ordinary account path and its missing-quote guard', async () => {
    const deposit = render();
    expect(await deposit.buildAndSign('unused-password')).toBe(false);
    expect(deposit.error.value).toContain('No active deposit quote');
  });
});
