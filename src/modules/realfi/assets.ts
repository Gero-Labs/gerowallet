/**
 * RealFi's own assets, by network.
 *
 * Verified 2026-09-25 against RealFi's partner config (the stablecoin id) and the
 * Cardano token registries (both ids, names and decimals): USDr and sUSDr share one
 * policy per network and are branded **USDrf** / **sUSDrf**, 6 decimals. Mainnet ids
 * are in tokens.cardano.org; preprod ids in the testnet registry.
 *
 * Kept as a fixed list rather than read at runtime so the portfolio can recognise
 * these tokens without a RealFi round trip — see `isRealFiAsset`.
 */
export const REALFI_ASSETS = {
  mainnet: {
    usdr: '7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae55534472',
    susdr: '7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae7355534472',
  },
  preprod: {
    usdr: '0684f582b8abeb4236b20688744eca788a61cd9881422a7113637f6b55534472',
    susdr: '0684f582b8abeb4236b20688744eca788a61cd9881422a7113637f6b7355534472',
  },
} as const;

const ALL_IDS: ReadonlySet<string> = new Set(
  Object.values(REALFI_ASSETS).flatMap((net) => [net.usdr, net.susdr]),
);

/**
 * True for USDrf and sUSDrf on any network.
 *
 * The portfolio's "verified only" filter (on by default for Cardano mainnet) trusts a
 * token only when the market API or DexHunter vouches for it. Newly launched tokens
 * have neither, so without this a user who staked through RealFi would open Gero and
 * find their stake missing from their holdings — at launch, the worst possible first
 * impression. These are RealFi's canonical assets, confirmed against its partner
 * config and the Cardano token registry, not a guess.
 */
export function isRealFiAsset(unit: string | null | undefined): boolean {
  return !!unit && ALL_IDS.has(unit);
}

/**
 * The canonical USDrf id for a wallet network, or null where RealFi has none.
 *
 * A fallback for when the protocol read fails: the page still knows what the user
 * holds, rather than telling someone with USDrf in their wallet to go and get some.
 */
export function usdrAssetIdFor(network: string | null | undefined): string | null {
  if (network === 'Mainnet') return REALFI_ASSETS.mainnet.usdr;
  if (network === 'Preprod') return REALFI_ASSETS.preprod.usdr;
  return null;
}

/** The canonical sUSDrf id for a wallet network, or null where RealFi has none. */
export function susdrAssetIdFor(network: string | null | undefined): string | null {
  if (network === 'Mainnet') return REALFI_ASSETS.mainnet.susdr;
  if (network === 'Preprod') return REALFI_ASSETS.preprod.susdr;
  return null;
}
