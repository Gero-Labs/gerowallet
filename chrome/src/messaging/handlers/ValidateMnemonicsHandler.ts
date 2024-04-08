import {AbstractMessageHandler} from "../core/AbstractMessageHandler";
import {MessageRequestInterface} from "../core/MessageRequestInterface";
import {Bip39Wrapper} from "../../services/Bip39Wrapper";
import { autoInjectable, singleton } from 'tsyringe';

export interface ValidateMnemonicsMessageRequest extends MessageRequestInterface {
    params: {
        mnemonics: string;
    }
}

@singleton()
@autoInjectable()
export class ValidateMnemonicsHandler extends AbstractMessageHandler {
    constructor(private bip39Wrapper?: Bip39Wrapper) {
        super();
    }

    handle(request: ValidateMnemonicsMessageRequest) {
        request.cb(this.bip39Wrapper.validateMnemonics(request.params.mnemonics))
    }
}
