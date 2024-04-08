import * as crypto from 'crypto';

export interface InitialSeed {
    AddressSeed: number;
    TransactionSeed: number;
    BlockSeed: number;
    TokenSeed: number;
}

export function getInitialSeeds(): InitialSeed {
    return {
        AddressSeed: crypto.randomBytes(4).readUInt32BE(0),
        TransactionSeed: crypto.randomBytes(4).readUInt32BE(0),
        BlockSeed: crypto.randomBytes(4).readUInt32BE(0),
        TokenSeed: crypto.randomBytes(4).readUInt32BE(0),
    };
}
