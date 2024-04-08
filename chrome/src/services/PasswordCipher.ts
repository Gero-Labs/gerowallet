import cryptoRandomString from 'crypto-random-string';
import { autoInjectable, singleton } from 'tsyringe';
import { AsyncLoader } from '../shared/AsyncLoader';

@singleton()
@autoInjectable()
export class PasswordCipher {
    async encryptWithPassword(password, rootKeyBytes) {
        await AsyncLoader.load();
        const rootKeyHex = Buffer.from(rootKeyBytes, 'hex').toString('hex');
        const passwordHex = Buffer.from(password).toString('hex');
        const salt = cryptoRandomString({ length: 2 * 32 });
        const nonce = cryptoRandomString({ length: 2 * 12 });
        return AsyncLoader.Serialization.encrypt_with_password(passwordHex, salt, nonce, rootKeyHex);
    }

    async decryptWithPassword(password, encryptedKeyHex) {
        await AsyncLoader.load();
        const passwordHex = Buffer.from(password).toString('hex');
        let decryptedHex;
        try {
            decryptedHex = AsyncLoader.Serialization.decrypt_with_password(passwordHex, encryptedKeyHex);
        } catch (err) {
            throw new Error('Wrong Passphrase');
        }
        return Buffer.from(decryptedHex, 'hex');
    }
}
