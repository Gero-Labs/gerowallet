import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { Bip39Wrapper } from '../../services/Bip39Wrapper';
import { autoInjectable, singleton } from 'tsyringe';

@singleton()
@autoInjectable()
export class GenerateMnemonicsHandler extends AbstractMessageHandler {
    constructor(private bip39Wrapper?: Bip39Wrapper) {
        super();
    }
    handle(request: MessageRequestInterface) {
        request.cb(this.bip39Wrapper.generateMnemonics());
    }
}
