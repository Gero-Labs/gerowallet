

export interface IAddress {
    addressId?: number
    digest: number
    type: number
    hash: string
    conceptualWalletId: number
}

export class Address implements IAddress {
    addressId?: number;
    digest: number;
    hash: string;
    type: number;
    conceptualWalletId: number;

    constructor(digest: number, hash: string, type: number, conceptualWalletId: number, id?: number) {
        if(id) this.addressId = id;
        this.digest = digest;
        this.hash = hash;
        this.type = type;
        this.conceptualWalletId = conceptualWalletId ;
    }
}
