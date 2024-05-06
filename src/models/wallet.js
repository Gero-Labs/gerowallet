import * as bip39 from "bip39";
import cryptoRandomString from 'crypto-random-string';
import * as serialization from '@emurgo/cardano-serialization-lib-browser';
import {
    WalletTypePurpose,
    CoinTypes,
    HARDENED,
    ChainDerivations,
    STAKING_KEY_INDEX,
    Blockchain,
    Network
} from '@/models/types';
import {
    Address,
    BaseAddress,
    Bip32PublicKey,
    RewardAddress,
    StakeCredential
} from "@emurgo/cardano-serialization-lib-browser";
import {Buffer} from "buffer";

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

    resolveRootKey(mnemonic) {
        console.log(mnemonic)
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
    networkId() {
        if (this.chain === Blockchain.CARDANO) {
            if (this.network === Network.MAINNET) {
                return 1;
            } else if (this.network === Network.PREPROD || this.network === Network.PREVIEW) {
                return 0;
            }
        }
    }
    pubKey() {
        return Bip32PublicKey.from_bech32(this.publicKey)
            .derive(ChainDerivations.EXTERNAL)
            .derive(0)
            .to_raw_key()
    }
    stakeKey() {
        return Bip32PublicKey.from_bech32(this.publicKey)
            .derive(ChainDerivations.CHIMERIC_ACCOUNT)
            .derive(STAKING_KEY_INDEX)
            .to_raw_key()
    }
    baseAddress() {
        return BaseAddress.new(this.networkId(), StakeCredential.from_keyhash(this.pubKey().hash()), StakeCredential.from_keyhash(this.stakeKey().hash())).to_address().to_bech32()
    }
    stakeAddress() {
        const hash = Buffer.from(RewardAddress.new(0, StakeCredential.from_keyhash(this.stakeKey().hash())).to_address().to_bytes()).toString('hex')
        const skh = RewardAddress.from_address(Address.from_bytes(Buffer.from(hash, 'hex'))).payment_cred().to_keyhash();

        return Buffer.from(skh.to_bytes()).toString('hex');
    }
}