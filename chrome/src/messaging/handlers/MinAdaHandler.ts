import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { autoInjectable, singleton } from "tsyringe";
import { TransactionBuildRequest } from "../../shared/types";
import { SendNewTransactionService } from "../../services/send-new-transaction.service";
import BigNumber from "bignumber.js";

export interface MinAdaHandler extends MessageRequestInterface {
  params: {
      outputs: TransactionBuildRequest[];
  }
}

@singleton()
@autoInjectable()
export class MinAdaHandler extends AbstractMessageHandler {

  constructor(private sendNewTransactionService?: SendNewTransactionService) {
    super();
  }

  public async handle(request: MinAdaHandler) {
    const outputs = request.params.outputs;
    let minAdaForOutputs = new BigNumber(0);
    await outputs.forEach(async output => {
      const { minAda } = await this.sendNewTransactionService.calculateOutputsMinAda(
        output
      );
      minAdaForOutputs = minAdaForOutputs.plus(new BigNumber(minAda));
    })
    request.cb(minAdaForOutputs.toString());
  }

}
