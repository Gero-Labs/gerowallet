import { db } from '../GeroWalletDatabase';
import { Bip32PublicKey } from "@emurgo/cardano-serialization-lib-browser";
import { CryptoService } from "../../../../angular/src/app/shared/crypto/crypto.service";
import { IKey } from "../models/Key";
import {WalletType, WalletColor, Partner} from '../models/ConceptualWallet';
import { INetwork } from "../models/Network";
import { BIP44_SCAN_SIZE, ChainDerivations, CoinTypes, STAKING_KEY_INDEX } from '../../shared/types';
import { Scan } from '../../services/Scan';
import { LogService } from '../../services/log.service';
import { autoInjectable, singleton } from 'tsyringe';
import { PasswordCipher } from '../../services/PasswordCipher';
import {ConceptualWalletService} from '../../api/conceptual-wallet.service';
import { EncodingService } from '../../services/encoding.service';

export interface SaveToKeyTableRequest {
    privateKey: string;
    publicKey: Bip32PublicKey;
    password: string;
}

@singleton()
@autoInjectable()
export class CreateWalletService {
    constructor(
        private conceptualWalletService: ConceptualWalletService,
        private scan?: Scan,
        private passwordCipher?: PasswordCipher,
        private logService?: LogService,
        private encodingService?: EncodingService
    ) {
    }

    public async saveToKeyTable(request: SaveToKeyTableRequest, conceptualWalletId: number): Promise<IKey[] | void> {

        return db.transaction('rw', db.key, async () => {
            this.encodingService.encode(request.privateKey, request.password).subscribe( async (encryptedPrivateKey) =>{
                await db.key.add({hash: encryptedPrivateKey, isEncrypted: true, type: 0,
                    passwordLastUpdate: new Date(), conceptualWalletId});
            });
            await db.key.add({
                hash: request.publicKey.to_bech32(),
                isEncrypted: false,
                type: 0,
                passwordLastUpdate: new Date(),
                conceptualWalletId
            });
        }).then(() => {
            return db.key.toArray();
        }).catch(e => this.logService.log('saveToKeyTable error: ' + JSON.stringify(e)));
    }

    public async saveToConceptualWallet(walletName: string, walletColor: WalletColor, walletType: WalletType, partner: Partner): Promise<number | void> {
        const listOrder = await this.conceptualWalletService.getLatestListOrder();
        return db.conceptualWallet.add(
            {
                name: walletName,
                color: walletColor,
                walletType: walletType,
                listOrder: listOrder+1,
                partner: partner
            })
        .then(async walletId => {
            await this.saveToConnection(walletId);

            return walletId;
        }).catch(e => this.logService.log('saveToConceptualWallet error: ' + JSON.stringify(e)));
    }

    public async saveToConnection(walletId: number) {
        return db.connection.add({ conceptualWalletId: walletId, websites: [] });
    }

    public async saveToKeyTableHW(publicKey: Bip32PublicKey, password: string, conceptualWalletId: number): Promise<void> {

        //we store as privateKey, user's password in order to allow him to login with a password
        const fakeEncrypted = await this.passwordCipher.encryptWithPassword(
            password,
            Buffer.from(publicKey.to_bech32(), 'hex'),
        );

        this.encodingService.encode(fakeEncrypted, password).subscribe( async (encryptedPrivateKey) =>{
            await db.key.add({hash: encryptedPrivateKey, isEncrypted: true, type: 0,
                passwordLastUpdate: new Date(), conceptualWalletId});
        });

        db.transaction('rw', db.key, async () => {
            await db.key.add({
                hash: publicKey.to_bech32(),
                isEncrypted: false,
                type: 0,
                passwordLastUpdate: new Date(),
                conceptualWalletId
            });
        }).catch(e => this.logService.log('Hardware saveToKeyTable error: ' + JSON.stringify(e)));
    }

    public async createNetwork(): Promise<INetwork | void> {
        return db.network.add({
            networkId: 1,
            name: 'mainnet',
            coinType: CoinTypes.CARDANO,
            fork: 0,
            backend: {backendService: '', tokenInfoService: '', websocket: ''},
            baseConfig: [{
                keyDeposit: '2000000',
                poolDeposit: '500000000',
                linearFee: {coefficient: '44', constant: '155381'},
                perEpochPercentageReward: 69344,
                slotsPerEpoch: 432000,
                minimumUtxoValue: '1000000',
                slotDuration: 1,
                startAt: 208
            }]
        }).then(async () => {
            return db.network.get({networkId: 1});
        }).catch(e => this.logService.log('createNetwork error: ' + JSON.stringify(e)));

    }

    public async saveAccountDefaultDerivations(
        chainNetworkId: number,
        accountPublicKey: Bip32PublicKey,
        conceptualWalletId: number
    ): Promise<void> {
        const addressesIndex = [...Array(BIP44_SCAN_SIZE).keys()];

        const stakingKey = accountPublicKey
            .derive(ChainDerivations.CHIMERIC_ACCOUNT)
            .derive(STAKING_KEY_INDEX)
            .to_raw_key();
        const externalAddrs = addressesIndex.map(i => {
            const key = accountPublicKey
                .derive(ChainDerivations.EXTERNAL)
                .derive(i)
                .to_raw_key();
            return key.hash();
        });
        const internalAddrs = addressesIndex.map(i => {
            const key = accountPublicKey
                .derive(ChainDerivations.INTERNAL)
                .derive(i)
                .to_raw_key();
            return key.hash();
        });
        /**
         * Even if the user has no internet connection and scanning fails,
         * we need to initialize our wallets with the bip44 gap size directly
         *
         * Otherwise the generated addresses won't be added to the wallet.js at all.
         * This would violate our bip44 obligation to maintain a unused address gap
         *
         * Example:
         * If we throw, no new addresses will be added
         * so the user's balance would be stuck at 0 until they reinstall Yoroi.
         */
        addressesIndex.map(i => {
            const externalAddresses = this.scan.addShelleyUtxoAddress(
                stakingKey,
                externalAddrs[i],
                chainNetworkId,
                conceptualWalletId
            );
            db.address.bulkAdd(externalAddresses);

        });
        addressesIndex.map(i => {
            let internalAddresses = this.scan.addShelleyUtxoAddress(
                stakingKey,
                internalAddrs[i],
                chainNetworkId,
                conceptualWalletId
            );
            db.address.bulkAdd(internalAddresses);

        });
        [0].map(() => {
            let stakingKeyAddress = this.scan.addShelleyChimericAccountAddress(
                stakingKey,
                chainNetworkId,
                conceptualWalletId
            );
            db.address.bulkAdd(stakingKeyAddress).catch(e => console.log(e));
        });
    }

    public async clearTables(): Promise<void> {
        localStorage.removeItem('wallet.js-imported');
        db.tables.forEach(function (table) {
            if (table.name !== 'network' && table.name !== 'lastSyncInfo') {
                table.clear();
            }
        });
    }

    public async createUserSettings(conceptualWalletId: number): Promise<void> {
        db.userSettings.add({
            conceptualWalletId: conceptualWalletId,
            language: localStorage.getItem('gero-wallet.js-language') ?? 'en',
            currency: localStorage.getItem('gero-wallet.js-currency') ?? 'usd' // this the default value
        });
    }
}
