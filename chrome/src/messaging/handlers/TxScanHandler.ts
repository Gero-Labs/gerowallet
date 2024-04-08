/* eslint-disable prettier/prettier */
import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { autoInjectable, singleton } from "tsyringe";
import { ScanTxService } from "../../services/scantx.service";

export interface TxScanMessageParams {
  cborHex: string;
  toAddress: string;
  fromAddress: string;
  url: string;
}

export interface TxScanMessageRequest extends MessageRequestInterface {
  params: TxScanMessageParams
}

@singleton()
@autoInjectable()
export class TxScanHandler extends AbstractMessageHandler {

  constructor(private scanTxService: ScanTxService) {
    super();
  }

  public async handle(request: TxScanMessageRequest) {
    const params: TxScanMessageParams = {
      cborHex: request.params.cborHex,
      toAddress: request.params.toAddress,
      fromAddress: request.params.fromAddress,
      url: request.params.url,
    };
    const scanInfo = await this.scanTxService.scanTx(params);
    request.cb(scanInfo);
  }

}
