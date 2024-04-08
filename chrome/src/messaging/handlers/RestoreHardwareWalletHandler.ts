import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { WalletService } from '../../services/WalletService';
import { RestoreHardwareWalletRequest } from '../../shared/types';
import {autoInjectable, singleton} from 'tsyringe';

interface RestoreHardwareWalletMessageRequestInterface extends MessageRequestInterface {
    params: {
        request: RestoreHardwareWalletRequest;
    };
}
@singleton()
@autoInjectable()
export class RestoreHardWareWalletHandler extends AbstractMessageHandler {
    constructor(private walletService?: WalletService) {
        super();
    }

    public async handle(request: RestoreHardwareWalletMessageRequestInterface){
        const restoreWalletId = await this.walletService
            .restoreHardwareWallet({
                walletColor: request.params.request.walletColor,
                walletName: request.params.request.walletName,
                publicKey: request.params.request.publicKey,
                walletPassword: request.params.request.walletPassword,
                recoveryPhrase: null,
                walletType: request.params.request.walletType,
                partner: request.params.request.partner
            });
        request.cb(restoreWalletId);
    }
}
