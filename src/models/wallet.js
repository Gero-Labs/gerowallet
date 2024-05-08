import * as bip39 from "bip39";
import cryptoRandomString from 'crypto-random-string';
import * as serialization from '@emurgo/cardano-serialization-lib-browser';
import {
    BaseAddress,
    Bip32PublicKey,
    RewardAddress,
    StakeCredential
} from '@emurgo/cardano-serialization-lib-browser';
import {ChainDerivations, STAKING_KEY_INDEX} from '@/models/types';
import {Buffer} from "buffer";
import * as CryptoTS from "crypto-ts";
import networks from "@/shared/utils/networks";

export class Wallet {

    constructor(id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network) {
        this.id = id
        this.name = name
        this.icon = icon
        this.type = type
        this.theme = theme
        this.order = order
        this.encryptedPrivateKey = encryptedPrivateKey
        this.publicKey = publicKey
        this.passwordLastUpdate = new Date()
        this.chain = chain
        this.network = network
    }

    static class(wallet) {
        return new Wallet(wallet.id, wallet.name, wallet.icon, wallet.type, wallet.theme, wallet.order,
            wallet.encryptedPrivateKey, wallet.publicKey, wallet.passwordLastUpdate, wallet.chain, wallet.network);
    }

    static resolvePrivateKey(mnemonic) {
        const bip39entropy = bip39.mnemonicToEntropy(mnemonic)
        return serialization.Bip32PrivateKey.from_bip39_entropy(Buffer.from(bip39entropy, 'hex'), Buffer.from(''));
    }

    static encryptPrivateKey(rootKey, password) {
        const privateKey = this.encryptWithPassword(password, rootKey.as_bytes());
        return CryptoTS.AES.encrypt(JSON.stringify(privateKey), password).toString()
    }

    static encryptWithPassword(password, rootKeyBytes) {
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
    networkId() {
        return networks.resolveNetworkId(this.chain, this.network)
    }
    pubKey(index) {
        return Bip32PublicKey.from_bech32(this.publicKey)
            .derive(ChainDerivations.EXTERNAL)
            .derive(index)
            .to_raw_key()
    }
    stakeKey() {
        return Bip32PublicKey.from_bech32(this.publicKey)
            .derive(ChainDerivations.CHIMERIC_ACCOUNT)
            .derive(STAKING_KEY_INDEX)
            .to_raw_key()
    }
    baseAddress() {
        return BaseAddress.new(
            this.networkId(),
            StakeCredential.from_keyhash(this.pubKey(0).hash()),
            StakeCredential.from_keyhash(this.stakeKey().hash())
        );
    }
    stakeAddress() {
        return RewardAddress.new(
            this.networkId(),
            StakeCredential.from_keyhash(this.stakeKey().hash())
        )
    }
}