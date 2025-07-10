export function getTransactionEpoch(txInfo: any) {
    const epochLengthInSlots = 432000;
    const epochLengthInBlocks = 21600;

    // Method 1: Direct epoch field (if available)
    if (txInfo.epoch) {
      return txInfo.epoch;
    }
    
    // Method 2: Calculate from slot
    if (txInfo.slot) {
      return Math.floor(txInfo.slot / epochLengthInSlots);
    }
    
    // Method 3: Calculate from block height
    if (txInfo.block_height) {
      return Math.floor(txInfo.block_height / epochLengthInBlocks);
    }
  }