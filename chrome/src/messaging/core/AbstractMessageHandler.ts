import { MessageHandlerInterface } from './MessageHandlerInterface';
import { MessageRequestInterface } from './MessageRequestInterface';

export abstract class AbstractMessageHandler implements MessageHandlerInterface {
    abstract handle(request: MessageRequestInterface);
}
