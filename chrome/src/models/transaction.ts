import { Observable } from "rxjs";

export interface TransactionAssetsAmount {
    name: string;
    amount: number;
    assetId: string;
    decimals$: Observable<number>;
}
