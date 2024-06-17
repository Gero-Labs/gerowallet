export class AssetWithQuantity {
    public asset: {
        policyId?: string;
        id?: string;
        name: string;
    };

    public quantity: string;

    constructor(name: string, quantity: string, assetId?: string, policyId?: string) {
        this.asset = {
            name: name === 'cardano' ? name : this.getTickerFromName(name),
        };
        if (assetId) {
            this.asset.id = assetId;
        }
        if (policyId) {
            this.asset.policyId = policyId;
        }
        this.quantity = quantity;
    }

    private getTickerFromName(name: string): string {
        const utf8Encoded = Buffer.from(name || '', 'hex').toString('utf-8');
        const specialCharactersRegex = /�/g;
        if (utf8Encoded && !specialCharactersRegex.test(utf8Encoded)) {
            return utf8Encoded;
        }
        return name || '?';
    }

    public isCardano() {
        return this.asset.name === 'cardano';
    }
}
