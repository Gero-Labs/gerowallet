import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { autoInjectable, singleton } from 'tsyringe';
import { LogService } from '../../services/log.service';

interface AngularErrorRequestParams extends MessageRequestInterface {
    params: {
        angularError: any
    }
}

@singleton()
@autoInjectable()
export class AngularErrorHandler extends AbstractMessageHandler {
    constructor(private logService: LogService) {
        super();
    }

    async handle(request: AngularErrorRequestParams) {
        this.logService.log(request.params.angularError);
        request.cb();
    }
}
