import { MessageRequestInterface } from './MessageRequestInterface';

export interface MessageHandlerInterface {
    handle(request: MessageRequestInterface): void;
}
