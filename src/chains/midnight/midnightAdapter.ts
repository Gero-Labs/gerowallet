/**
 * Midnight Chain Adapter
 *
 * Implements `IChainAdapter` for Midnight Network, mirroring the structure of
 * `bitcoinAdapter.ts` so the wallet's chain-dispatching code paths stay symmetric.
 *
 * **Current scope: skeleton.** The methods that need the official `@midnight-ntwrk/*`
 * SDK (key derivation, address derivation, address validation) throw
 * `NotImplementedError` for now — the SDK packages will be wired in a follow-up
 * slice once we've decided on bundle size + MV3 service-worker compatibility for
 * the WASM-heavy `ledger-v8` package.
 *
 * **Why some methods are intentionally lightweight**: Midnight's wallet flow is
 * subscription-driven (the SDK's `WalletFacade` manages its own state via indexer
 * GraphQL WS). The IChainAdapter UTxO/coin-selection methods, designed for the
 * pull-based Bitcoin/Cardano model, don't fit Midnight cleanly. We expose what
 * IS chain-agnostic (encryption, the chain identity) and route everything else
 * through Midnight-specific services that don't pretend to be Bitcoin-shaped.
 *
 * See `docs/superpowers/specs/2026-05-03-midnight-integration-gap-analysis.md`
 * for the full architectural rationale.
 */

import type {
  IChainAdapter,
  IUnifiedUtxo,
  IOutput,
  ICoinSelection,
  IBalance,
} from '@/chains/common/interfaces';
import { Blockchain } from '@/models/types';
import { encryptWithPassword, decryptWithPassword } from '@/shared/utils/crypto';

/**
 * Marker class for methods that require the `@midnight-ntwrk/*` SDK to be
 * integrated. Throwing this rather than silently no-oping makes it obvious
 * during development if a code path tries to use Midnight before the SDK is wired.
 */
export class MidnightSdkNotIntegratedError extends Error {
  constructor(method: string) {
    super(
      `Midnight SDK is not yet integrated; ${method} cannot run. ` +
      `Wire @midnight-ntwrk/wallet-sdk-* packages and replace the placeholder.`
    );
    this.name = 'MidnightSdkNotIntegratedError';
  }
}

/**
 * Skeleton adapter for Midnight. Real key derivation + address handling lands
 * once the SDK is integrated.
 */
export class MidnightAdapter implements IChainAdapter {
  readonly chainId: string = Blockchain.MIDNIGHT;
  readonly coinType: number = 2400; // BIP44 coin type for Midnight (m/44'/2400'/...)

  // Stored for future SDK integration (network-aware key derivation, address validation).
  // Currently unused while methods throw MidnightSdkNotIntegratedError.
  private readonly network: string;

  constructor(network: string) {
    this.network = network;
    void this.network; // suppress "declared but never read" until SDK methods consume it
  }

  // --- Key derivation ---------------------------------------------------

  deriveKeysFromMnemonic(_mnemonic: string, _network: string, _addressType?: string): unknown {
    // Real impl: HDWallet.fromSeed(seed) from @midnight-ntwrk/wallet-sdk-hd.
    // Returns three role-specific keys (Zswap, NightExternal, Dust) per
    // m/44'/2400'/account'/role/index. Each gets EMIP-3 encrypted separately.
    throw new MidnightSdkNotIntegratedError('deriveKeysFromMnemonic');
  }

  derivePublicKey(_mnemonic: string, _accountIndex: number): string {
    throw new MidnightSdkNotIntegratedError('derivePublicKey');
  }

  deriveAddress(_publicKey: string, _network: string, _addressType: string, _index: number): string {
    // Midnight has THREE address types per account, not one:
    // shielded / unshielded / dust. The IChainAdapter signature can return any
    // one; in practice the wallet calls Midnight-specific helpers that return
    // all three. This method returns the unshielded address for compatibility.
    throw new MidnightSdkNotIntegratedError('deriveAddress');
  }

  getReceiveAddress(_publicKey: string, _network: string, _addressType: string): string {
    throw new MidnightSdkNotIntegratedError('getReceiveAddress');
  }

  // --- UTxO management --------------------------------------------------

  parseUtxos(_rawUtxos: unknown[]): IUnifiedUtxo[] {
    // Midnight's unshielded UTxO shape diverges from Bitcoin/Cardano (token-type
    // hex, intent hash, registered-for-dust flag). The wallet uses
    // `MidnightUnshieldedUtxo` directly rather than coercing into IUnifiedUtxo.
    // This method intentionally returns empty so any code that calls it for
    // Midnight gets a clean no-op rather than corrupted data.
    return [];
  }

  selectCoins(_utxos: IUnifiedUtxo[], _outputs: IOutput[], _feeRate?: number): ICoinSelection {
    // Coin selection happens inside the SDK's `WalletFacade.transferTransaction`,
    // not at this layer. The IChainAdapter coin-selection contract is for chains
    // where the wallet does it locally (Bitcoin, Cardano).
    return { selectedUtxos: [], changeAmount: 0n, fee: 0n };
  }

  // --- Balance ---------------------------------------------------------

  getBalance(_utxos: IUnifiedUtxo[]): IBalance {
    // Midnight balance computation is more complex (shielded vs unshielded vs
    // dust); the wallet uses `midnightStore` aggregating SDK state directly.
    return { available: 0n, total: 0n, locked: 0n };
  }

  // --- Address validation ----------------------------------------------

  validateAddress(_address: string, _network: string): boolean {
    // Real impl: `MidnightBech32m.parse(address)` from
    // @midnight-ntwrk/wallet-sdk-address-format with HRP check (mn_addr_*,
    // mn_shield-addr_*, mn_dust-addr_*) per network.
    throw new MidnightSdkNotIntegratedError('validateAddress');
  }

  // --- Encryption (chain-agnostic, SDK-independent) --------------------

  encryptPrivateKey(keyBytes: Uint8Array, password: string): string {
    // crypto.ts signature is (password, bytes), not (bytes, password)
    return encryptWithPassword(password, keyBytes);
  }

  decryptPrivateKey(encrypted: string, password: string): Uint8Array {
    // crypto.ts signature is (password, encrypted), returns Buffer (which IS a Uint8Array)
    return decryptWithPassword(password, encrypted);
  }
}

/**
 * Factory matching the pattern used by `createBitcoinAdapter`.
 */
export function createMidnightAdapter(network: string): MidnightAdapter {
  return new MidnightAdapter(network);
}
