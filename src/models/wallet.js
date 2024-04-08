import * as bip39 from "bip39";
import cryptoRandomString from 'crypto-random-string';
import * as serialization from '@emurgo/cardano-serialization-lib-browser';
import * as CryptoTS from 'crypto-ts';
import {WalletTypePurpose, CoinTypes, HARD_DERIVATION_START} from '@/models/types';

export class Wallet {

    constructor(id, name, theme, order, mnemonic, password, chain, network) {
        this.id = id
        this.name = name
        this.theme = theme
        this.order = order
        const rootKey = this.resolveRootKey(mnemonic)
        const privateKey = this.encryptWithPassword(password, rootKey.as_bytes())
        this.encryptedPrivateKey = CryptoTS.AES.encrypt(JSON.stringify(privateKey), password).toString()
        this.publicKey = rootKey
            .derive(WalletTypePurpose.CIP1852)
            .derive(CoinTypes.CARDANO)
            .derive(HARD_DERIVATION_START)
            .to_public().to_bech32();
        this.passwordLastUpdate = new Date()
        this.chain = chain
        this.network = network
    }

    resolveRootKey(mnemonic) {
        const bip39entropy = bip39.mnemonicToEntropy(mnemonic)
        const emptyPassword = Buffer.from('');
        const entropy = Buffer.from(bip39entropy, 'hex')
        return serialization.Bip32PrivateKey.from_bip39_entropy(entropy, emptyPassword);
    }

    encryptWithPassword(password, rootKeyBytes) {
        const passwordHex = Buffer.from(password).toString('hex');
        const rootKeyHex = Buffer.from(rootKeyBytes, 'hex').toString('hex');
        const salt = cryptoRandomString({ length: 2 * 32 });
        const nonce = cryptoRandomString({ length: 2 * 12 });
        return serialization.encrypt_with_password(passwordHex, salt, nonce, rootKeyHex);
    }

    decryptWithPassword(password, encryptedKeyHex) {
        const passwordHex = Buffer.from(password).toString('hex');
        let decryptedHex;
        try {
            decryptedHex = serialization.decrypt_with_password(passwordHex, encryptedKeyHex);
        } catch (err) {
            throw new Error('Wrong Passphrase');
        }
        return Buffer.from(decryptedHex, 'hex');
    }
}