import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { autoInjectable, singleton } from 'tsyringe';
import { PopupService } from '../../services/popup.service';
import { TxSignError } from '../../dAppConnector/api-error';
import { AsyncLoader } from '../../shared/AsyncLoader';
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import { db } from '../../database/GeroWalletDatabase';
import { SendNewTransactionService } from '../../services/send-new-transaction.service';
import { PasswordCipher } from '../../services/PasswordCipher';

interface DAppSignDataHandlerRequestParams extends MessageRequestInterface {
  params: {
    sigStructure: string;
    address: string;
  };
}

@singleton()
@autoInjectable()
export class DAppSignDataHandler extends AbstractMessageHandler {
  constructor(
    private conceptualWalletService?: ConceptualWalletService,
    private sendNewTransactionService?: SendNewTransactionService,
    private passwordCipher?: PasswordCipher
  ) {
    super();
  }

  async handle(request: DAppSignDataHandlerRequestParams) {
    try {
      const popupService = new PopupService();
      const signature = encodeURI(Buffer.from(request.params.sigStructure, 'hex').toString('utf8'));
      const connectedSite = request.sender.origin;
      const password = await popupService.showPopup(`index.html?#/sign-data?signature=${signature}&connectedSite=${connectedSite}`);
      if (password === undefined) {
        throw new Error(TxSignError.UserDeclined.info);
      }
      const conceptualWalletId = this.conceptualWalletService.getCurrentActiveWalletId();

      const isPaymentAddress = this.isPaymentAddress(request.params.address);
      const deriveIndex = isPaymentAddress ? 0 : 2;
      const keys = await db.key.where({ conceptualWalletId: +conceptualWalletId }).toArray();
      const publicKeyBech32 = keys.find((key) => !key.isEncrypted);
      const publicKey = AsyncLoader.Serialization.Bip32PublicKey.from_bech32(publicKeyBech32.hash)
        .derive(deriveIndex)
        .derive(0)
        .to_raw_key();
  
      const protectedHeaders = AsyncLoader.Signing.HeaderMap.new();
      protectedHeaders.set_algorithm_id(
        AsyncLoader.Signing.Label.from_algorithm_id(AsyncLoader.Signing.AlgorithmId.EdDSA)
      );
      protectedHeaders.set_key_id(publicKey.as_bytes());
      protectedHeaders.set_header(
        AsyncLoader.Signing.Label.new_text('address'),
        AsyncLoader.Signing.CBORValue.new_bytes(Buffer.from(request.params.address, 'hex'))
      );
  
      const protectedSerialized =
      AsyncLoader.Signing.ProtectedHeaderMap.new(protectedHeaders);
      const unprotectedHeaders = AsyncLoader.Signing.HeaderMap.new();
      const headers = AsyncLoader.Signing.Headers.new(
        protectedSerialized,
        unprotectedHeaders
      );
      const builder = AsyncLoader.Signing.COSESign1Builder.new(
        headers,
        Buffer.from(request.params.sigStructure, 'hex'),
        false
      );
      const toSign = builder.make_data_to_sign().to_bytes();
  
      const privateKey = await this.sendNewTransactionService.getPrivateKey(password);
      const decodedHash = await this.passwordCipher.decryptWithPassword(password, privateKey as string);
      const prvKey = AsyncLoader.Serialization.Bip32PrivateKey.from_bytes(decodedHash)
        .derive(this.harden(1852))
        .derive(this.harden(1815))
        .derive(this.harden(0))
        .derive(deriveIndex)
        .derive(0)
        .to_raw_key();
  
      const signedSigStruc = prvKey.sign(toSign).to_bytes();
      const coseSign1 = builder.build(signedSigStruc);
      const geroSign = Buffer.from(coseSign1.to_bytes()).toString('hex');
      const key = AsyncLoader.Signing.COSEKey.new(
        AsyncLoader.Signing.Label.from_key_type(AsyncLoader.Signing.KeyType.OKP)
      );
      key.set_algorithm_id(
        AsyncLoader.Signing.Label.from_algorithm_id(AsyncLoader.Signing.AlgorithmId.EdDSA)
      );
      key.set_header(
        AsyncLoader.Signing.Label.new_int(
          AsyncLoader.Signing.Int.new_negative(AsyncLoader.Signing.BigNum.from_str('1'))
        ),
        AsyncLoader.Signing.CBORValue.new_int(
          AsyncLoader.Signing.Int.new_i32(6) //Loader.Message.CurveType.Ed25519
        )
      ); // crv (-1) set to Ed25519 (6)
      key.set_header(
        AsyncLoader.Signing.Label.new_int(
          AsyncLoader.Signing.Int.new_negative(AsyncLoader.Signing.BigNum.from_str('2'))
        ),
        AsyncLoader.Signing.CBORValue.new_bytes(publicKey.as_bytes())
      ); // x (-2) set to public key

      request.cb({
        key: Buffer.from(key.to_bytes()).toString('hex'),
        signature: geroSign,
      });
    } catch (error) {
      request.cb({error});
      throw error;
    }

  }
  
  private isPaymentAddress(address: string) {
    const keyHash = this.extractAddress(address);
    return keyHash.startsWith('addr_vkh')
  }

  private extractAddress(address: string) {
    const baseAddr = AsyncLoader.Serialization.BaseAddress.from_address(
      AsyncLoader.Serialization.Address.from_bytes(Buffer.from(address, 'hex'))
    );
    if (baseAddr) {
      return baseAddr.payment_cred().to_keyhash().to_bech32('addr_vkh');
    }
    const enterpriseAdd = AsyncLoader.Serialization.EnterpriseAddress.from_address(
      AsyncLoader.Serialization.Address.from_bytes(Buffer.from(address, 'hex'))
    );
    if (enterpriseAdd) {
      return enterpriseAdd.payment_cred().to_keyhash().to_bech32('addr_vkh');
    }
    const pointerAddr = AsyncLoader.Serialization.PointerAddress.from_address(
      AsyncLoader.Serialization.Address.from_bytes(Buffer.from(address, 'hex'))
    );
    if (pointerAddr) {
      return pointerAddr.payment_cred().to_keyhash().to_bech32('addr_vkh');
    }
    const rewardAddr = AsyncLoader.Serialization.RewardAddress.from_address(
      AsyncLoader.Serialization.Address.from_bytes(Buffer.from(address, 'hex'))
    );
    return rewardAddr.payment_cred().to_keyhash().to_bech32('stake_vkh');
  }
  
  private harden(num: number): number {
    return 0x80000000 + num;
  }
}
