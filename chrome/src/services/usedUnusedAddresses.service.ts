import { WalletAddressesService } from '../shared/wallet-addresses.service';
import { CacheHandler, CacheType } from '../messaging/handlers';
import { WalletInfoService } from './wallet-info.service';
import { BlockFrostService } from '../api/blockfrost.service';
import { delay, inject, injectable, singleton } from 'tsyringe';
import { AddressService } from './address.service';

export interface UsedUnusedAddresses {
  usedAddresses: string[];
  unusedAddresses: string[];
}

@singleton()
@injectable()
export class UsedUnusedAddressesService {
  constructor(
    @inject(WalletInfoService) private walletInfoService?: WalletInfoService,
    @inject(BlockFrostService) private blockFrostService?: BlockFrostService,
    @inject(WalletAddressesService) private walletAddressesService?: WalletAddressesService,
    @inject(AddressService) private addressService?: AddressService,
    @inject(delay( () => CacheHandler)) private cache?: Readonly<CacheHandler>
  ) {}

  public async getUsedUnusedAddresses(walletId: number): Promise<UsedUnusedAddresses> {
    const walletInfo = await this.walletInfoService.getData(walletId);
    const accountAddresses = await this.walletAddressesService.getAccountAddresses('external', 20, 0, walletId);
    const externalAddresses = accountAddresses.addresses.filter(address => {
      const hash = this.addressService.getPaymentKeyHash(address);
      return !!hash;
    });
    let usedAddresses = this.cache.get(walletInfo.address, CacheType.usedAddresses, true);
    let unusedAddresses = this.cache.get(walletInfo.address, CacheType.unusedAddresses, true);

    if (usedAddresses !== null && unusedAddresses !== null) {
      return {
        usedAddresses,
        unusedAddresses
      }
    } else {
      usedAddresses = [];
      const usedAddressesResponse = await this.getUsedAddresses(walletInfo.rewardAddress)
      usedAddresses = usedAddressesResponse
        .map(address => address.address)
        .filter(address => {
          const hash = this.addressService.getPaymentKeyHash(address);
          return !!hash;
        });;
      unusedAddresses = externalAddresses.filter(address => !usedAddresses.includes(address));
      if (usedAddresses.length === 0) {
        usedAddresses = [ unusedAddresses[0] ];
      }
      this.cache.set(walletInfo.address, CacheType.usedAddresses, usedAddresses);
      this.cache.set(walletInfo.address, CacheType.unusedAddresses, unusedAddresses);
    }

    return {
      usedAddresses,
      unusedAddresses,
    }
  }

  private async getUsedAddresses(address: string) {
    const response = await this.blockFrostService.getAccountAddresses(address);
    return response;
  } 
}
