import { db } from '../database/GeroWalletDatabase';
import { AsyncLoader } from './AsyncLoader';
import { autoInjectable, singleton, inject } from 'tsyringe';
import { config } from '../config';
import { AddressUtxoResponse } from './types';
import { AddressService } from '../services/address.service';

@singleton()
@autoInjectable()
export class WalletAddressesService {
    constructor(
        @inject(AddressService) private addressService?: AddressService,
    ) {}

    /**
     * This method will return the public addresses to bech32 format
     * @param type
     * @param page
     * @param shift
     * @param conceptualWalletId
     */
    public async getAccountAddresses(
        type = 'external',
        page = 20,
        shift = 0,
        conceptualWalletId: number | undefined = 1,
    ) {
        const keys = await db.key.toArray();
        const publicKeyBech32 = keys.find((key) => !key.isEncrypted && key.conceptualWalletId === conceptualWalletId);

        try {
            const publicKey = AsyncLoader.Serialization.Bip32PublicKey.from_bech32(publicKeyBech32.hash);
            let accountAdresses = {};

            const generateAddresses = (addressType) => {
                const tmpAddresses = {};
                for (let i = 0 + page * shift; i < page + page * shift; i += 1) {
                    const utxoPubKey = publicKey
                        .derive(addressType) // 0 external / 1 internal
                        .derive(i);

                    const stakeKey = publicKey
                        .derive(2) // chimeric
                        .derive(0);

                    const networkId = config.network.id;

                    const baseAddr = AsyncLoader.Serialization.BaseAddress.new(
                        networkId,
                        AsyncLoader.Serialization.StakeCredential.from_keyhash(utxoPubKey.to_raw_key().hash()),
                        AsyncLoader.Serialization.StakeCredential.from_keyhash(stakeKey.to_raw_key().hash()),
                    );

                    const baseAddrBech32 = baseAddr.to_address().to_bech32();
                    tmpAddresses[baseAddrBech32] = {
                        type: addressType,
                        path: i,
                    };
                }
                return tmpAddresses;
            };

            switch (type) {
                case 'external':
                    accountAdresses = {
                        ...generateAddresses(0),
                    };
                    break;
                case 'internal':
                    accountAdresses = {
                        ...generateAddresses(1),
                    };
                    break;
                case 'all':
                    accountAdresses = {
                        ...generateAddresses(0),
                        ...generateAddresses(1),
                    };
                    break;
                default:
                    break;
            }

            return {
                addresses: Object.keys(accountAdresses),
                paths: accountAdresses,
            };
        } catch (error) {
            throw new Error(`error -> ${error}`);
        }
    }

    public async getMainAddress(conceptualWalletId: number | undefined = 1) {
        const walletAddresses = await this.getAccountAddresses('all', 1, 0, conceptualWalletId);
        const externalAddresses = walletAddresses.addresses.filter(address => {
            const hash = this.addressService.getPaymentKeyHash(address);
            return !!hash;
        });

        return externalAddresses[0];
    }

    public async getAccountAddressesWithShift(
        type = 'external',
        utxos: AddressUtxoResponse[],
        conceptualWalletId: number
    ) {
        let walletPaths = {};
        let currentShift = 0;
        const maxShiftIndex = 10;

        while (true) {
            const accountAddresses = await this.getAccountAddresses(type, 40, currentShift, conceptualWalletId);
            const paths = accountAddresses.paths;
            const addresses = accountAddresses.addresses;

            let addressesWithUtxos = utxos.filter(utxo => addresses.includes(utxo.receiver));
            if (currentShift <= maxShiftIndex && utxos.length > 0) {
                if (addressesWithUtxos.length > 0 || addressesWithUtxos.length === 0 && currentShift === 0) {
                    currentShift++;
                    walletPaths = { ...walletPaths, ...paths};
                } else {
                    break;
                }
            } else {
                break;
            }
        }
        return {
            addresses: Object.keys(walletPaths),
            paths: walletPaths,
        };
    }
}
