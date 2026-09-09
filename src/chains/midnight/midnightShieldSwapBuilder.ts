import type { MidnightNetworkEndpoints } from './midnightConfig';
import type { BuildAndSignShieldedTransferResult } from './midnightShieldedBuilder';
import { assertNativeNightConversionSupported } from './midnightTokenCapabilities';

export type BuildAndSignShieldResult = BuildAndSignShieldedTransferResult;

/** Retained request shape for callers; native conversion always fails before use. */
export interface BuildAndSignShieldArgs {
  readonly sdkNetworkId: string;
  readonly endpoints: MidnightNetworkEndpoints;
  readonly amount: bigint;
  readonly ownUnshieldedAddress: string;
  readonly publicKeyHex: string;
  readonly addressHex: string;
  readonly ownShieldedAddress: string;
  readonly unshieldedSecretKey: Uint8Array;
  readonly zswapSecretKeySeed: Uint8Array;
  readonly dustSecretSeed: Uint8Array;
  readonly ttl: Date;
  readonly dustRegisteredAt?: Date;
  readonly onDustSyncProgress?: (percent: number, detail: string) => void;
  readonly proving?: { readonly url: string; readonly headers?: Record<string, string> };
}

/** NIGHT is always public; a separate application contract would be required. */
export async function buildAndSignShield(
  _args: BuildAndSignShieldArgs,
): Promise<BuildAndSignShieldResult> {
  return assertNativeNightConversionSupported();
}
