import { Buffer } from 'buffer';
import { autoInjectable, singleton } from 'tsyringe';
import { BlockFrostService } from '../../api/blockfrost.service';
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import { COLLATERAL_AMOUNT } from '../../constants';
import { CollateralRepository } from '../../repositories';
import { AsyncLoader } from '../../shared/AsyncLoader';
import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';

@singleton()
@autoInjectable()
export class DAppGetCollateralHandler extends AbstractMessageHandler {
    constructor(
        private conceptualWalletService?: ConceptualWalletService,
        private collateralRepository?: CollateralRepository,
        private blockFrostService?: BlockFrostService,
    ) {
        super();
    }

    async handle(request: MessageRequestInterface) {
        const conceptualWalletId = localStorage.getItem('conceptualWalletId');
        if (!conceptualWalletId || !(await this.conceptualWalletService.exists(+conceptualWalletId))) {
            throw new Error('No conceptualWalletId in localStorage during delegation certs');
        }

        const storedCollateral = await this.collateralRepository.get(+conceptualWalletId);

        const utxos = storedCollateral ? await this.blockFrostService.getUtxos(storedCollateral.paymentAddress) : [];

        const colateral = utxos.find(
            (x) => x.tx_hash === storedCollateral.txHash && x.amount[0].quantity === COLLATERAL_AMOUNT,
        );

        if (colateral === undefined) {
            request.cb({ result: [] });
        } else {
            const collateralUtxo = AsyncLoader.Serialization.TransactionUnspentOutput.new(
                AsyncLoader.Serialization.TransactionInput.new(
                    AsyncLoader.Serialization.TransactionHash.from_bytes(Buffer.from(storedCollateral.txHash, 'hex')),
                    0,
                ),
                AsyncLoader.Serialization.TransactionOutput.new(
                    AsyncLoader.Serialization.Address.from_bech32(storedCollateral.paymentAddress),
                    AsyncLoader.Serialization.Value.new(AsyncLoader.Serialization.BigNum.from_str(COLLATERAL_AMOUNT)),
                ),
            );
            request.cb({ result: [Buffer.from(collateralUtxo.to_bytes()).toString('hex')] });
        }
    }
}
