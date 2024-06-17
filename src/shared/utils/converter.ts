import { Address, BaseAddress, MultiAsset } from '@emurgo/cardano-serialization-lib-browser';
import { AssetWithQuantity } from '@/shared/models/asset-quantity';

export const toAddress = bech32 => Address.from_bech32(bech32);

export const toBaseAddress = bech32 => BaseAddress.from_address(toAddress(bech32));
