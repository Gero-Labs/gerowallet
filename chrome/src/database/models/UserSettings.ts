export interface IUserSettings {
    language: string;
    currency: string;
    conceptualWalletId: number;
    id?: number;
}

export class UserSettings implements  IUserSettings {
    currency: string;
    language: string;
    conceptualWalletId: number;
    id?: number;

    constructor(currency: string, language: string, conceptualWalletId: number, id?: number) {
        if(id) this.id = id;
        this.conceptualWalletId = conceptualWalletId;
        this.currency = currency;
        this.language = language;
    }

}
