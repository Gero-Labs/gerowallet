import Dexie, { Transaction } from 'dexie';
import { IPriceData, PriceData } from './models/PriceData';
import { INetwork, Network } from './models/Network';
import { ConceptualWallet, IConceptualWallet } from './models/ConceptualWallet';
import { ILastSyncInfo, LastSyncInfo } from './models/LastSyncInfo';
import { IKey } from './models/Key';
import { Address, IAddress } from './models/Address';
import { IUserSettings, UserSettings } from './models/UserSettings';
import { Connection, IConnection } from './models/Connection';
import { Collateral, ICollateral } from './models/Collateral';
import { IPendingTransaction, PendingTransaction } from './models/PendingTransaction';
export type DbResultType = 'OK' | 'ERROR';

/* eslint-disable-next-line @typescript-eslint/no-empty-interface */
export interface IDataPayload {}

export interface IDbResponse {
    result: DbResultType;
    payload: IDataPayload | undefined;
}

class GeroWalletDatabase extends Dexie {
    address: Dexie.Table<IAddress, number>;
    conceptualWallet: Dexie.Table<IConceptualWallet, number>;
    key: Dexie.Table<IKey, number>;
    lastSyncInfo: Dexie.Table<ILastSyncInfo, number>;
    network: Dexie.Table<INetwork, number>;
    priceData: Dexie.Table<IPriceData, number>;
    userSettings: Dexie.Table<IUserSettings, number>;
    connection: Dexie.Table<IConnection, number>;
    collateral: Dexie.Table<ICollateral, number>;
    pendingTransaction: Dexie.Table<IPendingTransaction, number>;

    constructor() {
        // Database name
        super('GeroWalletDatabase');
        /* eslint-disable-next-line @typescript-eslint/no-this-alias */
        const db = this;
        //TODO: Why did we do the above? We are in the constructor of the Database Class?
        // What are the changes of 'this' to not refer in the Database?

        // Define tables and indexes
        // Version has to be dynamically configured TODO
        // & means unique
        db.version(9.2)
            .stores({
                conceptualWallet: '++conceptualWalletId, name, balance, color, walletType, listOrder, partner',
                key: '++id, hash, isEncrypted, passwordLastUpdate, type, conceptualWalletId',
                address: '++addressId, digest, hash, type, conceptualWalletId',
                userSettings: '++id, currency, language, conceptualWalletId',
                lastSyncInfo: '++lastSyncInfoId, blockHash, height, slotNum, time, epoch',
                network: 'networkId, backend, baseConfig, coinType, fork, networkName',
                priceData: '++id, from, to, price, time, percentage',
                connection: '++id, websites, conceptualWalletId',
                collateral:
                    '++collateral, txHash, txId, paymentAddress, conceptualWalletId',
                pendingTransaction:
                    '++pendingTransactionId, stakeKey, type, from, to, date, amountADA, feeADA, totalADA, ' +
                    'hash, status, direction, poolId, assetName,assetAmount, assetId, assetDecimals, ttl',
            })
            .upgrade(async (tx) => {
                if (db.verno > 3) {
                    await this.shouldMigrateToVersion4(tx);
                }
                if (db.verno > 4) {
                    await this.shouldMigrateToVersion5(tx);
                }
                if (db.verno === 7.1) {
                    await this.shouldMigrateToVersion71(tx);
                }
                if (db.verno === 8.2) {
                    await this.shouldMigrateToVersion82(tx);
                }
                if (db.verno === 9.1) {
                    await this.shouldMigrateToVersion91(tx);
                }
            });
        // Map Class to table
        db.address.mapToClass(Address);
        db.conceptualWallet.mapToClass(ConceptualWallet);
        db.lastSyncInfo.mapToClass(LastSyncInfo);
        db.network.mapToClass(Network);
        db.priceData.mapToClass(PriceData);
        db.userSettings.mapToClass(UserSettings);
        db.connection.mapToClass(Connection);
        db.collateral.mapToClass(Collateral);
        db.pendingTransaction.mapToClass(PendingTransaction);
    }

    private async shouldMigrateToVersion4(tx: Transaction) {
        const wallets = await db.conceptualWallet.toArray();
        const keys = await db.key.toArray();
        const keysAreAssociated = keys.some((key) => key.conceptualWalletId ?? false);
        if (wallets.length === 1 && !keysAreAssociated) {
            const conceptualWalletId = wallets[0].conceptualWalletId;

            tx.table('conceptualWallet')
                .toCollection()
                .modify((wallet) => {
                    wallet.color = 'green';
                });
            tx.table('key')
                .toCollection()
                .modify((key) => {
                    key.conceptualWalletId = conceptualWalletId;
                });
            tx.table('address')
                .toCollection()
                .modify((address) => {
                    address.conceptualWalletId = conceptualWalletId;
                });
            tx.table('userSettings').add({
                conceptualWalletId: wallets[0].conceptualWalletId,
                language: localStorage.getItem('gero-wallet.js-language') ?? 'en',
                currency: localStorage.getItem('gero-wallet.js-currency') ?? 'usd',
            });
            localStorage.setItem('conceptualWalletId', conceptualWalletId.toString());
        }
    }

    private async shouldMigrateToVersion5(tx: Transaction) {
        const wallets = await db.conceptualWallet.toArray();

        wallets.forEach((x) =>
            tx.table('connection').add({
                conceptualWalletId: x.conceptualWalletId,
                websites: [],
            }),
        );
    }
    /**
     * This method will add the walletType row to the conceptualWallet table
     */
    private async shouldMigrateToVersion71(tx: Transaction) {
        tx.table('conceptualWallet')
            .toCollection()
            .modify((wallet) => {
                wallet.walletType = 'Normal';
            });
    }

    /**
     * This method will add the number row to the conceptualWallet table
     */
    private async shouldMigrateToVersion82(tx: Transaction) {
        let listOrder = 0;
        tx.table('conceptualWallet')
            .toCollection()
            .each((wallet) => {
                tx.table('conceptualWallet').update(wallet.conceptualWalletId, { listOrder: ++listOrder });
            });
    }

    /**
     * This method will add partner to the conceptualWallet table
     */
    private async shouldMigrateToVersion91(tx: Transaction) {
        tx.table('conceptualWallet')
            .toCollection()
            .each((wallet) => {
                tx.table('conceptualWallet').update(wallet.conceptualWalletId, { partner: '' });
            });
    }
}

export const db = new GeroWalletDatabase();
