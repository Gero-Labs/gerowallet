// Without a provided factory the spend screens use the wallet's own chain reader, one per network.
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import type { VaultChainReader } from '@/modules/gerovault/contracts';
import { VAULT_CHAIN_READER_KEY, useVaultChainReaderFactory, type VaultChainReaderFactory } from './chainReader';

function factoryIn(provide?: Record<symbol, unknown>): VaultChainReaderFactory {
  let factory: VaultChainReaderFactory | undefined;
  mount(defineComponent({ setup: () => { factory = useVaultChainReaderFactory(); return () => null; } }), { global: { provide } });
  return factory!;
}

describe('vault chain reader factory', () => {
  it('defaults to the wallet reader of each network, made once', () => {
    const factory = factoryIn();
    const preprod = factory('preprod');
    expect(preprod?.network).toBe('preprod');
    expect(typeof preprod?.txCbor).toBe('function');
    expect(factory('preprod')).toBe(preprod);
    expect(factory('preview')?.network).toBe('preview');
  });

  it('uses the factory a host provides', () => {
    const reader = { network: 'preprod' } as VaultChainReader;
    expect(factoryIn({ [VAULT_CHAIN_READER_KEY as symbol]: () => reader })('preprod')).toBe(reader);
  });
});
