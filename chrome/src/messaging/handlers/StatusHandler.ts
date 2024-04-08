import {AbstractMessageHandler} from "../core/AbstractMessageHandler";
import {MessageRequestInterface} from "../core/MessageRequestInterface";
import { IServerStatus, ServerStatusService } from "../../api/status.service";

export class StatusHandler extends AbstractMessageHandler {
    public async handle(request: MessageRequestInterface) {
      const serverStatus = new ServerStatusService();
      try {
        const status = await serverStatus.getServerStatus();
        request.cb(status);
      } catch(err) {
        request.cb({status: false});
      }
    }
}
