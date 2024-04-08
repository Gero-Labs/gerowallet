import { IsNumber, IsString, MinLength } from 'class-validator';
import { PoolInfo } from './pool-response';
const PoolLogoUrl = 'https://static.adapools.org/pool_logo/';
export class Pool {
    @IsString()
    @MinLength(1)
    poolId: string;

    @IsString()
    @MinLength(1)
    poolIdBech32: string;

    @IsString()
    @MinLength(1)
    name: string;

    @IsString()
    @MinLength(1)
    ticker: string;

    logo: string;

    @IsNumber()
    roa: number;

    url: string;
    taxRatio: number | undefined;
    taxFix: number | undefined;

    @IsNumber()
    poolSize: number;

    constructor(poolResponse: PoolInfo) {
        this.poolId = poolResponse.pool_id_hash;
        this.poolIdBech32 = poolResponse.pool_id;
        this.logo =`${PoolLogoUrl}${this.poolId}.png`;
        //we receive the name as: [ticker] name, so we need to split it
        const poolInfo = poolResponse.name.split('[').join(' ').split(']');
        this.name = poolInfo[1].trim();
        this.ticker = poolInfo[0].trim();
        this.roa = +poolResponse.roa_short / 100;
        this.url = poolResponse.url;
        this.taxRatio =
                +poolResponse.tax_ratio && poolResponse.tax_ratio.length > 0 ? +poolResponse.tax_ratio / 100: undefined;
        this.taxFix = poolResponse.tax_fix && poolResponse.tax_fix.length > 0 ? +poolResponse.tax_fix : undefined;
        this.poolSize = +poolResponse.stake;
    }
}
