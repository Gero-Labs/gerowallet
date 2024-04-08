import { IsDate, IsNumber, IsString, MinLength } from 'class-validator';
import {IDataPayload} from '../GeroWalletDatabase';

export interface IPriceData extends IDataPayload{
    from: string
    to: string
    time: Date
    price: number
    percentage: number
}

export class PriceData implements IPriceData {
    @IsString()
    @MinLength(3)
    from: string;

    @IsNumber()
    price: number;

    @IsDate()
    time: Date;

    @IsString()
    @MinLength(3)
    to: string;

    @IsNumber()
    percentage: number;

    constructor(from: string, to: string, price: number, time: Date, percentage: number) {
        this.from = from;
        this.price = price;
        this.time = time;
        this.to = to;
        this.percentage = percentage;
    }

}
