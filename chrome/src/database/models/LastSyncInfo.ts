

export interface ILastSyncInfo {
    lastSyncInfoId?: number
    time: Date | null
    slotNum: number | null
    blockHash: string | null
    height: number
    epoch: number;
    genesis_slot: number;
}

export class LastSyncInfo implements ILastSyncInfo{
    blockHash: string | null;
    height: number;
    lastSyncInfoId?: number;
    slotNum: number | null;
    time: Date | null;
    epoch: number;
    genesis_slot: number;

    constructor(blockHash: string | null, height: number, slotNum: number | null, time: Date | null, epoch: number,
                genesisSlot: number, id?: number) {
        this.blockHash = blockHash;
        this.height = height;
        this.slotNum = slotNum;
        this.time = time;
        this.epoch = epoch;
        this.genesis_slot = genesisSlot;
        if(id) this.lastSyncInfoId = id;
    }
}
