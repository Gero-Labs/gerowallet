import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { autoInjectable, singleton } from 'tsyringe';
import { HardwareWalletService } from '../../services/hardware-wallet.service';
import { MessageRequestInterface } from '../core/MessageRequestInterface';

@singleton()
@autoInjectable()
export class InitTrezorWalletHandler extends AbstractMessageHandler {
    constructor(private hardwareWalletService?: HardwareWalletService) {
        super();
    }

    public async handle(request: MessageRequestInterface) {
        const response = await this.hardwareWalletService.getTrezorPublicKey();
        if (response?.success) {
            const trezorInfo = {
                name: this.hardwareWalletService.getHardwareWalletName(),
                publicKey: response.payload?.publicKey,
            };
            request.cb({ info: trezorInfo });
        } else {
            request.cb();
        }
    }
}
