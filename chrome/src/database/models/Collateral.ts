export interface ICollateral {
    txHash: string;
    paymentAddress: string;
    conceptualWalletId: number;
    collateral?: number;
}

export class Collateral implements ICollateral {
    txHash: string;
    paymentAddress: string;
    conceptualWalletId: number;
    collateral?: number;

    constructor(txHash: string, txId: string, paymentAddress: string, conceptualWalletId: number, id?: number) {
        if(id) this.collateral = id;
        this.conceptualWalletId = conceptualWalletId ;
        this.txHash = txHash;
        this.paymentAddress = paymentAddress;
    }
}
