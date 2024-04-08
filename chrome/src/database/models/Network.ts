
export interface INetwork {
    networkId: number
    name: string
    coinType: number
    backend: Backend
    baseConfig: BaseConfig[]
    fork: number
}

export interface Backend {
    backendService?: string
    tokenInfoService?: string
    websocket?: string
}
interface CardanoHaskellShelleyBaseConfig {
    startAt: number
    slotsPerEpoch: number
    slotDuration: number
    perEpochPercentageReward: number
    linearFee: {
        coefficient: string
        constant: string
    }
    minimumUtxoValue: string
    poolDeposit: string
    keyDeposit: string;
}

// More can be added in the future
export type BaseConfig = CardanoHaskellShelleyBaseConfig

export class Network implements INetwork {
    backend: Backend;
    baseConfig: BaseConfig[];
    coinType: number;
    fork: number;
    networkId: number;
    name: string;

    constructor(backend: Backend, baseConfig: BaseConfig[], coinType: number, fork: number, name: string, id?: number) {
        this.backend = backend;
        this.baseConfig = baseConfig;
        this.coinType = coinType;
        this.fork = fork;
        this.name = name;
        if(id) this.networkId = id;
    }


}
