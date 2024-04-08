import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { autoInjectable, singleton } from 'tsyringe';
import { AddressService } from "../../services/address.service";

interface ValidateAddressMessageRequest extends MessageRequestInterface {
  params: {
    address: string
  }
}

@singleton()
@autoInjectable()
export class ValidateAddressHandler extends AbstractMessageHandler{
  constructor(private addressService?: AddressService) {
    super();
  }

  handle(request: ValidateAddressMessageRequest) {
    const isAddressValid = !!this.addressService.normalizeToAddress(request.params.address);
    request.cb(isAddressValid);
  }
}