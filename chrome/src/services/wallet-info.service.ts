import { db } from '../database/GeroWalletDatabase';
import { WalletAddressesService } from '../shared/wallet-addresses.service';
import { ConceptualWalletService } from '../api/conceptual-wallet.service';
import { AsyncLoader } from '../shared/AsyncLoader';
import { ChainDerivations, STAKING_KEY_INDEX } from '../shared/types';
import { autoInjectable, singleton } from 'tsyringe';
import { config } from '../config';

export interface WalletInfo {
    name: string;
    address: string;
    rewardAddress: string;
}

@singleton()
@autoInjectable()
export class WalletInfoService {
    constructor(
        private conceptualWalletService?: ConceptualWalletService,
        private walletAddressesService?: WalletAddressesService,
    ) {}
    public async getData(conceptualWalletId: number): Promise<WalletInfo> {
        conceptualWalletId = await this.conceptualWalletService.checkId(conceptualWalletId);

        const conceptualWallets = await db.conceptualWallet.toArray();
        const walletName = conceptualWallets.find((w) => w.conceptualWalletId === conceptualWalletId)?.name;
        const walletAddress = await this.walletAddressesService.getMainAddress(conceptualWalletId);
        const rewardAddressBech32 = await this.getRewardAddress(conceptualWalletId);

        this.conceptualWalletService.setAddress(conceptualWalletId, walletAddress);
        this.conceptualWalletService.setRewardAddress(conceptualWalletId, rewardAddressBech32);

        return {
            name: walletName,
            address: walletAddress,
            rewardAddress: rewardAddressBech32,
        };
    }

    private async getRewardAddress(id: number) {
        const keys = await db.key.toArray();

        const publicKeyBech32 = keys.find((key) => !key.isEncrypted && key.conceptualWalletId === id);
        const publicKey = AsyncLoader.Serialization.Bip32PublicKey.from_bech32(publicKeyBech32.hash);

        const stakingKey = publicKey.derive(ChainDerivations.CHIMERIC_ACCOUNT).derive(STAKING_KEY_INDEX);

        const rewardAddress = AsyncLoader.Serialization.RewardAddress.new(
            config.network.id,
            AsyncLoader.Serialization.StakeCredential.from_keyhash(stakingKey.to_raw_key().hash()),
        );
        return rewardAddress.to_address().to_bech32();
    }
}
