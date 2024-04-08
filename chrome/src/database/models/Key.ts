


export interface IKey {
    id?: number
    type: number
    hash: string
    isEncrypted: boolean
    passwordLastUpdate: Date | null
    conceptualWalletId: number
}
export class Key implements IKey {
    hash: string;
    isEncrypted: boolean;
    id?: number;
    passwordLastUpdate: Date | null;
    type: number;
    conceptualWalletId: number;

    constructor(hash: string, isEncrypted: boolean, conceptualWalletId: number, passwordLastUpdate: Date | null, type: number, id?: number) {
        this.hash = hash;
        this.isEncrypted = isEncrypted;
        this.passwordLastUpdate = passwordLastUpdate;
        this.type = type;
        if(id) this.id = id;
        this.conceptualWalletId = conceptualWalletId ;
    }
}
