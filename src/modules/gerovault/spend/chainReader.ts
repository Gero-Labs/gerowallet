/**
 * Which chain reader the spend screens use. A host (or a test) provides a factory with
 * `provide(VAULT_CHAIN_READER_KEY, factory)`; without one the screens use the wallet's own reader
 * (`createVaultChainReader`: Nexus address reads, `backendSource` for creating transactions, the
 * background's submit). The screens only ever see the `VaultChainReader` interface of `contracts.ts`.
 */
import { inject, type InjectionKey } from 'vue';
import { createVaultChainReader } from '@/modules/gerovault/chain/vaultChainReader';
import type { VaultChainReader } from '@/modules/gerovault/contracts';
import type { VaultNetwork } from '@/shared/gerovault';

/** A reader for one vault network, or null when there is none for it. */
export type VaultChainReaderFactory = (network: VaultNetwork) => VaultChainReader | null;

export const VAULT_CHAIN_READER_KEY: InjectionKey<VaultChainReaderFactory> = Symbol('gerovaultChainReader');

const readers = new Map<VaultNetwork, VaultChainReader>();

/** The wallet's reader for each network, made once per page. */
const walletReaders: VaultChainReaderFactory = network => {
  let reader = readers.get(network);
  if (!reader) {
    try {
      reader = createVaultChainReader(network);
    } catch {
      // A network the reader does not know: the screens say sending is not available.
      return null;
    }
    readers.set(network, reader);
  }
  return reader;
};

/** The factory in effect for the calling component. Call it in `setup`. */
export function useVaultChainReaderFactory(): VaultChainReaderFactory {
  return inject(VAULT_CHAIN_READER_KEY, () => walletReaders, true);
}
