import { Network } from '@/models/types';

// A module of its own so a reader that only needs the asset identity (global
// search) does not pull the registration flow and its messaging along.
// `useCnightDustRegistration` re-exports it for its existing importers.

/**
 * cNIGHT asset identity, keyed by network. Values verified 2026-07-14 from
 * the official DUST Generator portal's baked config (Next.js bundle) —
 * mainnet name is `NIGHT` (`4e49474854`); the testnet asset has an empty
 * asset name. Preview, preprod and stagenet share one policy (same token
 * deployment), which is also what Nexus pins as `stagenet-cnight-unit`.
 *
 * Keyed by network NAME, and read with either vocabulary: a Cardano wallet
 * looks up its own network, a Midnight wallet looks up its Midnight network
 * (see `useDustSources`). `Network.PREVIEW` therefore stays here for Cardano
 * preview even though Midnight preview is gone.
 */
export const CNIGHT_ASSETS: Record<string, { policyId: string; assetNameHex: string }> = {
  [Network.MAINNET]: {
    policyId: '0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa',
    assetNameHex: '4e49474854',
  },
  [Network.PREPROD]: {
    policyId: 'd2dbff622e509dda256fedbd31ef6e9fd98ed49ad91d5c0e07f68af1',
    assetNameHex: '',
  },
  [Network.PREVIEW]: {
    policyId: 'd2dbff622e509dda256fedbd31ef6e9fd98ed49ad91d5c0e07f68af1',
    assetNameHex: '',
  },
  [Network.STAGENET]: {
    policyId: 'd2dbff622e509dda256fedbd31ef6e9fd98ed49ad91d5c0e07f68af1',
    assetNameHex: '',
  },
};

/** The `policyId + assetNameHex` unit of `network`'s cNIGHT, or '' where it has none. */
export function cnightUnit(network: string | null | undefined): string {
  const asset = CNIGHT_ASSETS[network ?? ''];
  return asset ? asset.policyId + asset.assetNameHex : '';
}
