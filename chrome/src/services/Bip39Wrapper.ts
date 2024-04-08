import * as Bip39 from 'bip39';
import { autoInjectable, singleton } from 'tsyringe';

@singleton()
@autoInjectable()
export class Bip39Wrapper {
    public generateMnemonics(): string[] {
        return Bip39.generateMnemonic(160).split(' ');
    }

    public validateMnemonics(mnemonics: string): boolean {
        return Bip39.validateMnemonic(mnemonics);
    }

    public mnemonicToEntropy(mnemonic: string): string {
        return Bip39.mnemonicToEntropy(mnemonic);
    }
}
