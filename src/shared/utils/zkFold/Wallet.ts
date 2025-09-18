import * as CSL from '@emurgo/cardano-serialization-lib-browser';
import { Backend } from './Backend';
import { UTxO, Output, BigIntWrap } from './Types';
import { Prover } from './Prover';
import { hexToBytes, harden, getMatchingGoogleKey } from './Utils';

/**
 * We support Bech32 addresses and Gmail-locked smart contracts.
 */
export enum AddressType {
    Bech32 = 0,
    Email = 1
}

/**
 * Data required to initialise a wallet.
 * 
 *  data is Google JSON Web Token as a string
 *  rootKey is the private key to sign transactions (can be generated randomly)
 */
export interface WalletInitialiser {
    jwt: string;
    tokenSKey?: string;
}

/**
 * Describes the recipient of ADA
 * @property {AddressType} recipientType  - Type of wallet the recipient holds
 * @property {string} address             - Cardano address if recipientType is Bech32, email otherwise
 * @property {Asset} assets               - A dictionary of assets to send. For ADA, use 'lovelace' as the key. For other assets, use the format '<PolicyID>.<AssetName>'
 */
export class SmartTxRecipient {
    recipientType: AddressType;
    address: string;
    assets: Asset;

    constructor(recipientType: AddressType, address: string, assets: Asset) {
        this.recipientType = recipientType;
        this.address = address;
        this.assets = assets;
    }
}

/**
 * Describes assets and their amounts
 */
export interface Asset {
    [key: string]: BigIntWrap;
}

/**
 * The Wallet which can be initialised with an email address.
 */
export class Wallet {
    private tokenSKey!: CSL.Bip32PrivateKey;
    private jwt!: string;
    private userId!: string;
    private freshKey: boolean = false;

    private backend: Backend;
    private prover: Prover;

    /**
     *  @param {Prover} prover                 - A Prover object for interaction with the prover
     *  @param {Backend} backend               - A Backend object for interaction with the backend
     *  @param {WalletInitialiser} initialiser - Data to initialise the wallet
     */
    constructor(backend: Backend, prover: Prover, initialiser: WalletInitialiser) {
        this.backend = backend;
        this.prover = prover;

        // At this point, we assume that userId is a valid email accessible by the user (i.e. the user was able to complete Google authentication).
        this.jwt = initialiser.jwt;

        const parts = this.jwt.split(".");
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        this.userId = payload.email;

        if (!initialiser.tokenSKey) {
            const prvKey = CSL.Bip32PrivateKey
                .generate_ed25519_bip32()
                .derive(harden(1852)) // purpose
                .derive(harden(1815)) // coin type
                .derive(harden(0)) // account #0
                .derive(0)
                .derive(0);
            this.tokenSKey = prvKey;
            this.freshKey = true;
        } else {
            this.tokenSKey = CSL.Bip32PrivateKey.from_hex(initialiser.tokenSKey);
        }
    }

    /**
     * @async
     * Get the Cardano address for a gmail address
     */
    async addressForGmail(gmail: string): Promise<CSL.Address> {
        return await this.backend.walletAddress(gmail);
    }

    /**
     * @async
     * Get the Wallet's address
     */
    async getAddress(): Promise<CSL.Address> {
        return await this.addressForGmail(this.userId);
    }

    /**
     * @async
     * Get wallet's balance as an object with asset names as property names and amounts as their values.
     */
    async getBalance(): Promise<Asset> {
        const utxos = await this.getUtxos();
        const assets: Asset = {};
        for (let i = 0; i < utxos.length; i++) {
            for (const key in utxos[i].value) {
                if (!(key in assets)) {
                    assets[key] = new BigIntWrap(0);
                }
                assets[key].increase(utxos[i].value[key]);
            }
        };
        return assets;
    }

    /**
     * Get extensions turned on in the wallet
     */
    getExtensions(): string[] {
        return [];
    }

    /**
     * @async
     * Get UTxOs held by the wallet 
     */
    async getUtxos(): Promise<UTxO[]> {
        const address = await this.getAddress();
        let utxos: UTxO[] = [];
        try {
            utxos = await this.backend.addressUtxo(address);
        } catch (err) {
            console.log("getUtxos()");
            console.log(err);
            utxos = [];
        }
        return utxos;
    }

    /**
     * @async
     * Get wallet's used addresses (currently only wallet's main address) 
     */
    async getUsedAddresses(): Promise<CSL.Address[]> {
        const utxos = await this.getUtxos();
        const address = await this.getAddress();
        if (utxos.length == 0) {
            return [];
        } else {
            return [address];
        }
    }

    /**
     * @async
     * Get wallet's unused addresses 
     */
    async getUnusedAddresses(): Promise<CSL.Address[]> {
        const utxos = await this.getUtxos();
        const address = await this.getAddress();
        if (utxos.length == 0) {
            return [address];
        } else {
            return [];
        }
    }

    /**
     * @async
     * Get wallet's reward addresses (currently none) 
     */
    async getRewardAddresses(): Promise<CSL.Address[]> {
        return [];
    }

    /**
     * @async
     * Get wallet's change address (currently wallet's main address) 
     */
    async getChangeAddress(): Promise<CSL.Address> {
        return await this.getAddress();
    }

    /**
     * Send funds from this wallet to a recipient.
     *
     * @async
     * @param {SmartTxRecipient} rec - A recipient with a Cardano or a email address
     */
    async sendTo(rec: SmartTxRecipient): Promise<string> {
        console.log(rec.recipientType);
        console.log(rec.address);
        console.log(rec.assets);

        let recipientAddress;

        if (rec.recipientType == AddressType.Email) {
            recipientAddress = await this.addressForGmail(rec.address);
        } else {
            recipientAddress = CSL.Address.from_bech32(rec.address);
        }

        // Prepare email recipients list
        const emailRecipients: string[] = [];
        if (rec.recipientType == AddressType.Email) {
            emailRecipients.push(rec.address);
        }

        let txHex;
        const outs: Output[] = [{ address: recipientAddress.to_bech32(), value: rec.assets }];

        if (!this.freshKey) {
            const resp = await this.backend.sendFunds(this.userId, outs, this.tokenSKey.to_public().to_raw_key().hash().to_hex());
            txHex = resp.transaction;
        } else {
            const pubkeyHex = this.tokenSKey.to_public().to_raw_key().hash().to_hex();
            const parts = this.jwt.split(".");
            const header = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'));
            const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));

            const keyId = JSON.parse(header).kid;
            const matchingKey = await getMatchingGoogleKey(keyId);
            const signature = parts[2].replace(/-/g, '+').replace(/_/g, '/');
            const empi = {
                piPubE: b64ToBn(matchingKey.e.replace(/-/g, '+').replace(/_/g, '/')),
                piPubN: b64ToBn(matchingKey.n.replace(/-/g, '+').replace(/_/g, '/')),
                piSignature: b64ToBn(signature),
                piTokenName: new BigIntWrap("0x" + pubkeyHex)
            };

            const proofBytes = await this.prover.prove(empi);
            const resp = await this.backend.activateAndSendFunds(header + '.' + payload, pubkeyHex, proofBytes, outs);
            txHex = resp.transaction;
        }
        const transaction = CSL.FixedTransaction.from_bytes(hexToBytes(txHex));
        transaction.sign_and_add_vkey_signature(this.tokenSKey.to_raw_key());
        const signedTxHex = Array.from(new Uint8Array(transaction.to_bytes())).map(b => b.toString(16).padStart(2, '0')).join('');

        return await this.backend.submitTx(signedTxHex, emailRecipients);
    }

}


// https://coolaj86.com/articles/bigints-and-base64-in-javascript/
function b64ToBn(b64: string): BigIntWrap {
    const bin = atob(b64);
    const hex: string[] = [];

    bin.split('').forEach(function (ch) {
        let h = ch.charCodeAt(0).toString(16);
        if (h.length % 2) { h = '0' + h; }
        hex.push(h);
    });

    return new BigIntWrap(BigInt('0x' + hex.join('')));
}