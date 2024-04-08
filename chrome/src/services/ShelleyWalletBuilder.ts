import { Bip32PrivateKey } from '@emurgo/cardano-serialization-lib-browser';
import { PasswordCipher } from './PasswordCipher';
import { CoinTypes, HARD_DERIVATION_START, WalletTypePurpose } from '../shared/types';
import { CreateWalletService } from '../database/services/CreateWalletService';
import { autoInjectable, singleton } from 'tsyringe';
import { config } from '../config';

export interface Cip1852WalletRequest {
    rootPk: Bip32PrivateKey;
    password: string;
    accountIndex?: number;
    walletName: string;
}

@singleton()
@autoInjectable()
export class ShelleyWalletBuilder {
    constructor(private createWalletService?: CreateWalletService, private passwordCipher?: PasswordCipher) {}
    public async createStandardCip1852Wallet(request: Cip1852WalletRequest, conceptualWalletId: number): Promise<void> {
        if (request.accountIndex < HARD_DERIVATION_START) {
            throw new Error('wallet.js needs hardened index');
        }

        const encryptedRoot = await this.passwordCipher.encryptWithPassword(
            request.password,
            request.rootPk.as_bytes(),
        );

        const accountPublicKey = request.rootPk
            .derive(WalletTypePurpose.CIP1852)
            .derive(CoinTypes.CARDANO)
            .derive(request.accountIndex)
            .to_public();

        await this.createWalletService.saveToKeyTable(
            {
                privateKey: encryptedRoot,
                publicKey: accountPublicKey,
                password: request.password,
            },
            conceptualWalletId,
        );

        const chainNetworkId = config.network.id;

        await this.createWalletService.saveAccountDefaultDerivations(
            chainNetworkId,
            accountPublicKey,
            conceptualWalletId,
        );
        await this.createWalletService.createUserSettings(conceptualWalletId);
    }
}
