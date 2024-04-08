import { Ed25519KeyHash, PublicKey } from '@emurgo/cardano-serialization-lib-browser';
import { CoreAddressTypes } from '../shared/types';
import { getInitialSeeds } from '../database/InitialSeed';
import { Address } from '../database/models/Address';
import { AsyncLoader } from '../shared/AsyncLoader';
import { autoInjectable, singleton } from 'tsyringe';

@singleton()
@autoInjectable()
export class Scan {
    addShelleyUtxoAddress(
        stakingKey: PublicKey,
        keyHash: Ed25519KeyHash,
        networkId: number,
        conceptualWalletId: number,
    ): Address[] {
        const wasmEnterpriseAddr = AsyncLoader.Serialization.EnterpriseAddress.new(
            networkId,
            AsyncLoader.Serialization.StakeCredential.from_keyhash(keyHash),
        );
        if (wasmEnterpriseAddr == null) {
            throw new Error(`address is not an enterprise address`);
        }
        const baseAddr = AsyncLoader.Serialization.BaseAddress.new(
            networkId,
            wasmEnterpriseAddr.payment_cred(),
            AsyncLoader.Serialization.StakeCredential.from_keyhash(stakingKey.hash()),
        );
        const initialSeeds = getInitialSeeds();
        const addresses: Address[] = [];
        addresses.push({
            type: CoreAddressTypes.CARDANO_ENTERPRISE,
            digest: this.digestForHash(
                Buffer.from(wasmEnterpriseAddr.to_address().to_bytes()).toString('hex'),
                initialSeeds.AddressSeed,
            ),
            hash: Buffer.from(wasmEnterpriseAddr.to_address().to_bytes()).toString('hex'),
            conceptualWalletId,
        });

        addresses.push({
            type: CoreAddressTypes.CARDANO_BASE,
            digest: this.digestForHash(
                Buffer.from(baseAddr.to_address().to_bytes()).toString('hex'),
                initialSeeds.AddressSeed,
            ),
            hash: Buffer.from(baseAddr.to_address().to_bytes()).toString('hex'),
            conceptualWalletId,
        });

        return addresses;
    }

    addShelleyChimericAccountAddress(
        stakingKey: PublicKey,
        chainNetworkId: number,
        conceptualWalletId: number,
    ): Address[] {
        const accountAddr = AsyncLoader.Serialization.RewardAddress.new(
            chainNetworkId,
            AsyncLoader.Serialization.StakeCredential.from_keyhash(stakingKey.hash()),
        );

        const initialSeeds = getInitialSeeds();

        const addresses: Address[] = [];

        addresses.push({
            type: CoreAddressTypes.CARDANO_REWARD,
            digest: this.digestForHash(
                Buffer.from(accountAddr.to_address().to_bytes()).toString('hex'),
                initialSeeds.AddressSeed,
            ),
            hash: Buffer.from(accountAddr.to_address().to_bytes()).toString('hex'),
            conceptualWalletId,
        });
        return addresses;
    }

    digestForHash(str: string, seed: number): number {
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);

        // Since Javascript can't compute bitwise on 64bits ints
        // we instead extend the 32-bit hash algorithm to 64 bits
        // using Hash = H[H[x] || x]
        // rationale: any other way would mean collision in `h1` implies collision in h2
        const h1 = this.hashFnv32a(str, seed);
        const h2 = this.hashFnv32a(h1.toString(16) + str, seed);

        // we need to clear the 20th bit because IEEE 754 (Javascript numbers)
        // use the 20th bit as a flag for special values like infinity, NaN, etc.
        // by setting the 20th bit to 0, we always get a regular number
        const nonNan = this.clearBit(h1, 20);
        view.setInt32(0, nonNan);
        view.setInt32(4, h2);
        return view.getFloat64(0);
    }

    public hashFnv32a(str: string, seed: number): number {
        let hval = seed === undefined ? 0x811c9dc5 : seed;

        for (let i = 0, l = str.length; i < l; i++) {
            hval ^= str.charCodeAt(i);
            hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
        }
        return hval >>> 0;
    }

    public clearBit(num: number, bit: number): number {
        return num & ~(1 << bit);
    }
}
