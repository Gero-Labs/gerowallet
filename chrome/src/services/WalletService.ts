import { Bip39Wrapper } from './Bip39Wrapper';
import { Bip32PrivateKey } from '@emurgo/cardano-serialization-lib-browser';
import { HARD_DERIVATION_START, RestoreHardwareWalletRequest, RestoreWalletRequest } from '../shared/types';
import { ShelleyWalletBuilder } from './ShelleyWalletBuilder';
import { CreateWalletService } from '../database/services/CreateWalletService';
import { AsyncLoader } from '../shared/AsyncLoader';
import { InitialDataTablesService } from './initial-data-tables.service';
import { db } from '../database/GeroWalletDatabase';
import { autoInjectable, singleton } from 'tsyringe';
import { WalletType } from '../database/models/ConceptualWallet';

@singleton()
@autoInjectable()
export class WalletService {
    constructor(
        private createWalletService?: CreateWalletService,
        private shelleyWalletBuilder?: ShelleyWalletBuilder,
        private initialDataTablesService?: InitialDataTablesService,
        private bip39Wrapper?: Bip39Wrapper,
    ) {}
    public async restoreWallet(request: RestoreWalletRequest): Promise<number> {
        const wallets = await db.conceptualWallet.toArray();
        //add the default values tables only once
        if (wallets.length === 0) {
            await this.initialDataTablesService.setDefaultDatabaseValues();
        }

        try {
            const conceptualWalletId = (await this.createWalletService.saveToConceptualWallet(
                request.walletName,
                request.walletColor,
                WalletType.Normal,
                request.partner
            )) as number;
            const rootPk = this.generateWalletRootKey(request.recoveryPhrase);
            const accountIndex = HARD_DERIVATION_START + 0;

            await this.shelleyWalletBuilder.createStandardCip1852Wallet(
                {
                    rootPk,
                    password: request.walletPassword,
                    accountIndex,
                    walletName: request.walletName,
                },
                conceptualWalletId,
            );

            return conceptualWalletId;
        } catch (e) {
            throw new Error('Wallet was not created');
        }
    }

    public generateWalletRootKey(mnemonic: string): Bip32PrivateKey {
        const bip39entropy = this.bip39Wrapper.mnemonicToEntropy(mnemonic);
        /**
         * there is no wallet.js entropy password in yoroi
         * the PASSWORD here is the password to add more _randomness_
         * when deriving the wallet.js root key from the entropy
         * it is NOT the spending PASSWORD
         */
        const EMPTY_PASSWORD = Buffer.from('');
        const rootKey = AsyncLoader.Serialization.Bip32PrivateKey.from_bip39_entropy(
            Buffer.from(bip39entropy, 'hex'),
            EMPTY_PASSWORD,
        );
        return rootKey;
    }

    public async removeWallet() {
        await this.createWalletService.clearTables();
    }

    public removeConceptualWalletEntries(conceptualWalletId: number) {
        const foreignTables = ['key', 'address', 'userSettings', 'conceptualWallet'];

        foreignTables.forEach((table) => {
            db[table].where('conceptualWalletId').equals(conceptualWalletId).delete();
        });
    }

    public async restoreHardwareWallet(request: RestoreHardwareWalletRequest): Promise<number> {

        const wallets = await db.conceptualWallet.toArray();
        //add the default values tables only once
        if (wallets.length === 0) {
            await this.initialDataTablesService.setDefaultDatabaseValues();
        }

        try {
            const conceptualWalletId = (await this.createWalletService.saveToConceptualWallet(
                request.walletName,
                request.walletColor,
                request.walletType,
                request.partner
            )) as number;

            const accountPublicKey = AsyncLoader.Serialization.Bip32PublicKey.from_bytes(
                Buffer.from(request.publicKey, 'hex')
            );

            await this.createWalletService.saveToKeyTableHW(
                accountPublicKey,
                request.walletPassword,
                conceptualWalletId,
            );

            await this.createWalletService.saveAccountDefaultDerivations(1, accountPublicKey, conceptualWalletId);

            await this.createWalletService.createUserSettings(conceptualWalletId);

            return conceptualWalletId;
        } catch (e) {
            throw new Error('Hardware Wallet was not created');
        }

    }
}
