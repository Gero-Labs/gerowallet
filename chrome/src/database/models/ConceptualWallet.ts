export type WalletColor = 'green' | 'deepPurple' | 'blue' | 'grey' | 'pink' | 'cyan' | 'orange' | 'chocolate' | 'newm';
export type Partner = 'newm' | '';

export enum WalletType {
    Trezor = 'Trezor',
    Ledger = 'Ledger',
    Normal = 'Normal'
}

export interface IConceptualWallet {
    conceptualWalletId?: number;
    name: string;
    balance?: number;
    address?: string;
    history?: any[];
    color: WalletColor;
    rewardAddress?: string;
    walletType?: WalletType;
    listOrder?: number;
    partner?: Partner;
}

export class ConceptualWallet implements IConceptualWallet {
    conceptualWalletId?: number;
    name: string;
    balance?: number;
    address?: string;
    history?: any[];
    color: WalletColor;
    rewardAddress?: string;
    walletType?: WalletType;
    listOrder?: number;
    partner?: Partner;

    constructor(name: string, id?: number, color?: WalletColor, listOrder?: number, partner?: Partner) {
        if (id) this.conceptualWalletId = id;
        this.name = name;
        this.color = color ?? 'green';
        this.walletType = WalletType.Normal;
        this.listOrder = listOrder;
        this.partner = partner ?? '';
    }
}
