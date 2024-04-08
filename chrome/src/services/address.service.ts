import { Address } from '@emurgo/cardano-serialization-lib-nodejs';
import { autoInjectable, singleton } from "tsyringe";
import { AsyncLoader } from "../shared/AsyncLoader";

@singleton()
@autoInjectable()
export class AddressService {
  public normalizeToAddress(addr: string): Address {
    // in Shelley, addresses can be base16, bech32 or base58
    // this function, we try parsing in all encodings possible

    // 1) Try converting from base58
    if (AsyncLoader.Serialization.ByronAddress.is_valid(addr)) {
        return AsyncLoader.Serialization.ByronAddress.from_base58(addr).to_address();
    }

    // 2) If already base16, simply return
    try {
        return AsyncLoader.Serialization.Address.from_bytes(Buffer.from(addr, 'hex'));
    } catch (_e) {} // eslint-disable-line no-empty

    // 3) Try converting from base32
    try {
        return AsyncLoader.Serialization.Address.from_bech32(addr);
    } catch (_e) {} // eslint-disable-line no-empty

    return undefined;
  }

  public getPaymentKeyHash(address: string) {
    const keyAddress = AsyncLoader.Serialization.Address.from_bech32(address);
    try {
        const baseKeyAddress = AsyncLoader.Serialization.BaseAddress.from_address(keyAddress)
            .payment_cred()
            .to_keyhash();
        return baseKeyAddress.to_bytes();
    }
    catch(e) {}
    try {
        const enterpriseKeyAddress = AsyncLoader.Serialization.EnterpriseAddress.from_address(keyAddress)
            .payment_cred()
            .to_keyhash();
        return enterpriseKeyAddress.to_bytes();
    }
    catch(e) {}
    try {
        const pointerKeyAddress = AsyncLoader.Serialization.PointerAddress.from_address(keyAddress)
            .payment_cred()
            .to_keyhash();
        return pointerKeyAddress.to_bytes();
    }
    catch(e) {}
    try {
        const rewardKeyAddress = AsyncLoader.Serialization.RewardAddress.from_address(keyAddress)
            .payment_cred()
            .to_keyhash();
        return rewardKeyAddress.to_bytes();
    }
    catch(e) {}
    return undefined;
  }

  public getStakeKeyHash(address: string) {
    const keyAddress = AsyncLoader.Serialization.Address.from_bech32(address);
    try {
        const baseKeyAddress = AsyncLoader.Serialization.BaseAddress.from_address(keyAddress)
            .stake_cred()
            .to_keyhash();
        return baseKeyAddress.to_bytes();
    }
    catch(e) {}
    return undefined;
  }
}
