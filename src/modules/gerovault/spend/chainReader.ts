/**
 * Which chain reader the spend screens use. A host (or a test) provides a factory with
 * `provide(VAULT_CHAIN_READER_KEY, factory)`; without one the screens use the default below.
 * The screens only ever see the `VaultChainReader` interface of `contracts.ts`.
 */
import { inject, type InjectionKey } from 'vue';
import type { VaultChainReader } from '@/modules/gerovault/contracts';
import type { VaultNetwork } from '@/shared/gerovault';

/** A reader for one vault network, or null when there is none for it. */
export type VaultChainReaderFactory = (network: VaultNetwork) => VaultChainReader | null;

export const VAULT_CHAIN_READER_KEY: InjectionKey<VaultChainReaderFactory> = Symbol('gerovaultChainReader');

/** No reader yet: the screens say that sending is not available rather than guess one. */
const noReader: VaultChainReaderFactory = () => null;

let defaultFactory: VaultChainReaderFactory = noReader;

/** Sets the factory used when no component provides one (the app's own reader, once wired). */
export function setDefaultVaultChainReader(factory: VaultChainReaderFactory): void {
  defaultFactory = factory;
}

/** The factory in effect for the calling component. Call it in `setup`. */
export function useVaultChainReaderFactory(): VaultChainReaderFactory {
  return inject(VAULT_CHAIN_READER_KEY, () => defaultFactory, true);
}
