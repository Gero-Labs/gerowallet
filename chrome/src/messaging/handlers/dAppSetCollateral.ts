/* eslint-disable prettier/prettier */
import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { autoInjectable, singleton } from 'tsyringe';
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import { Buffer } from 'buffer';
import { WalletAddressesService } from "../../shared/wallet-addresses.service";
import { SendNewTransactionService } from "../../services/send-new-transaction.service";
import { COLLATERAL_AMOUNT, DEFAULT_TTL } from "../../constants";
import { Collateral } from '../../database/models/Collateral';
import { db } from '../../database/GeroWalletDatabase';
import { CollateralMessageError } from '../../../../angular/src/app/shared/error-handlers';
import { TransactionsService } from "../../api/transactions.service";
import { PendingTransactionsService } from "../../services/pending-transactions.service";
import { PendingTransaction, TransactionStatus } from "../../database/models/PendingTransaction";
import { TransactionDirection } from '../../shared/types';
import { HardwareWalletService } from '../../services/hardware-wallet.service';
import { WalletType } from '../../database/models/ConceptualWallet';

interface DAppSetCollateralHandlerRequestParams extends MessageRequestInterface {
    params: {
        password: string
    }
}

@singleton()
@autoInjectable()
export class DAppSetCollateralHandler extends AbstractMessageHandler {
    constructor(
      private conceptualWalletService?: ConceptualWalletService,
      private walletAddressesService?: WalletAddressesService,
      private sendNewTransaction?: SendNewTransactionService,
      private transactionsService?: TransactionsService,
      private pendingTransactionService?: PendingTransactionsService,
      private hardwareWalletService?: HardwareWalletService
    ) {
        super();
    }

    async handle(request: DAppSetCollateralHandlerRequestParams) {
      const collateralAmount = COLLATERAL_AMOUNT;
      const conceptualWalletId = this.conceptualWalletService.getCurrentActiveWalletId();
      const wallet = await this.conceptualWalletService.find(conceptualWalletId);
      const addressResponse = await this.walletAddressesService.getAccountAddresses('external', 20, 0, conceptualWalletId);
      const walletAddresses = addressResponse.addresses;

      const collateralAddress = walletAddresses[0];

      let collateralTransaction;
      try {
        collateralTransaction = await this.sendNewTransaction.buildTransaction([{ address: collateralAddress, value: collateralAmount }]);
      } catch (e) {
        const errorMessage = e.message === 'error while build Error: not enough ADA' ?
          CollateralMessageError.notEnoughAda :
          CollateralMessageError.genericApiError;

        request.cb({ error: errorMessage });
        return;
      }

      let signedTransaction;
      try {
          switch (wallet.walletType) {
              case WalletType.Normal:
                  signedTransaction = await this.sendNewTransaction.txSign(collateralTransaction.data, request.params.password);
                  break;
              case WalletType.Trezor:
                  signedTransaction = await this.hardwareWalletService.txToTrezor(
                      collateralTransaction.data.txBody,
                      0,
                      collateralTransaction.data.outputs[0]?.address,
                      collateralTransaction.data.usedUtxos);
                  break;
              case WalletType.Ledger:
                  signedTransaction = await this.hardwareWalletService.txToLedger(
                      collateralTransaction.data.txBody,
                      collateralTransaction.data.outputs[0]?.address,
                      0,
                      collateralTransaction.data.txBody.metadata,
                      false,
                      collateralTransaction.data.usedUtxos
                      );
                  break;
              default:
                  break;
          }

      } catch (e) {
          request.cb({ error: CollateralMessageError.passwordError });
          return;
      }

      try{
        const response = await this.transactionsService.sendTx({ encodedTx: signedTransaction });
        if (response?.error) {
          request.cb({ error: CollateralMessageError.genericApiError });       
          return;
        }
          const collateral: Collateral  = {
              paymentAddress: collateralAddress,
              conceptualWalletId: conceptualWalletId,
              txHash: Buffer.from(collateralTransaction.data.txHash.to_bytes()).toString('hex')
          }
          const existingCollaterals = await db.collateral.toArray();
          const deleteCollateralPromise = existingCollaterals
            .filter(collateral => collateral.conceptualWalletId === conceptualWalletId)
            .map(collateral => db.collateral.delete(collateral.collateral));
          if (deleteCollateralPromise && deleteCollateralPromise.length > 0) {
            await Promise.all(deleteCollateralPromise);
          }
          await db.collateral.add(collateral);

          await this.setCollateralAsPending(conceptualWalletId, collateralAmount, collateralAddress, collateral.txHash, collateralTransaction);

          request.cb(null);
      } catch (e){
          request.cb({ error: CollateralMessageError.genericApiError });
      }
    }

    /**
     * This method will set the new collateral transaction as Pending in order to track the status
     */
    private async setCollateralAsPending(conceptualWalletId: number, collateralAmount: string, collateralAddress: string,
                                         txHash: string, collateralTransaction): Promise<void> {
        const wallet = await this.conceptualWalletService.find(conceptualWalletId);
        const pendingTX: PendingTransaction = {
            stakeKey: wallet.rewardAddress,
            type: 'Collateral',
            from: collateralAddress,
            to: collateralAddress,
            date: new Date(),
            amountADA: +collateralAmount,
            feeADA: +collateralTransaction.data.fee,
            totalADA: (+collateralAmount) + (+collateralTransaction.data.fee),
            status: 'Pending' as TransactionStatus,
            direction: TransactionDirection.Collateral,
            ttl: DEFAULT_TTL,
            hash: txHash,
            assets: [{
              amount: +collateralAmount,
              decimals: 6,
              assetId: '',
              name: 'Cardano',
              policyId: '',
              ticker: '',
            }],
        };

        await this.pendingTransactionService.setPendingTransaction(pendingTX);
    }


}
