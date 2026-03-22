/**
 * Bitcoin Coin Selection Algorithm
 *
 * Implements various UTXO selection strategies for Bitcoin transactions.
 * Handles transaction size calculation, fee estimation, and change output creation.
 */

import type { IUnifiedUtxo, ICoinSelection, IOutput } from '@/chains/common/interfaces';

/**
 * Bitcoin transaction size constants (for SegWit P2WPKH)
 */
export const TX_SIZE_CONSTANTS = {
  // Base transaction overhead (version, locktime, marker, flag)
  BASE_TX_SIZE: 10.5,  // vbytes

  // Input sizes (P2WPKH SegWit)
  INPUT_BASE_SIZE: 41,         // txid (32) + vout (4) + scriptSig (1) + sequence (4)
  INPUT_WITNESS_SIZE: 107,     // witness stack size (1) + signature (73) + pubkey (33)

  // Output sizes
  OUTPUT_P2WPKH_SIZE: 31,      // value (8) + scriptPubKey length (1) + scriptPubKey (22)
  OUTPUT_P2PKH_SIZE: 34,       // value (8) + scriptPubKey length (1) + scriptPubKey (25)
  OUTPUT_P2TR_SIZE: 43,        // value (8) + scriptPubKey length (1) + scriptPubKey (34)

  // Dust limits (minimum output values to prevent spam)
  DUST_LIMIT_P2WPKH: 546,      // satoshis (294 vbytes * 3 sat/vb, rounded up)
  DUST_LIMIT_P2PKH: 546,       // satoshis
  DUST_LIMIT_P2TR: 546,        // satoshis

  // Change output threshold (create change if remainder > dust + fee to spend it)
  CHANGE_THRESHOLD_MULTIPLIER: 1.5,
};

/**
 * Coin selection strategy types
 */
export enum CoinSelectionStrategy {
  LARGEST_FIRST = 'largest-first',      // Select largest UTXOs first (minimize inputs)
  SMALLEST_FIRST = 'smallest-first',    // Select smallest UTXOs first (consolidate)
  ACCUMULATIVE = 'accumulative',        // Simple accumulation (default)
  BRANCH_AND_BOUND = 'branch-and-bound' // Optimal selection (Bitcoin Core algorithm)
}

/**
 * Calculate transaction virtual size (vbytes) for SegWit P2WPKH
 *
 * Formula: (base_size * 4 + witness_size) / 4
 *
 * @param inputCount Number of inputs
 * @param outputCount Number of outputs
 * @returns Transaction size in virtual bytes
 */
export function calculateTxSize(inputCount: number, outputCount: number): number {
  const baseSize = TX_SIZE_CONSTANTS.BASE_TX_SIZE +
                   (inputCount * TX_SIZE_CONSTANTS.INPUT_BASE_SIZE) +
                   (outputCount * TX_SIZE_CONSTANTS.OUTPUT_P2WPKH_SIZE);

  const witnessSize = inputCount * TX_SIZE_CONSTANTS.INPUT_WITNESS_SIZE;

  // SegWit virtual size formula
  const vsize = Math.ceil((baseSize * 4 + witnessSize) / 4);

  return vsize;
}

/**
 * Calculate transaction fee
 *
 * @param inputCount Number of inputs
 * @param outputCount Number of outputs
 * @param feeRate Fee rate in satoshis per vbyte
 * @returns Total fee in satoshis
 */
export function calculateTxFee(
  inputCount: number,
  outputCount: number,
  feeRate: number
): bigint {
  const vsize = calculateTxSize(inputCount, outputCount);
  return BigInt(Math.ceil(vsize * feeRate));
}

/**
 * Check if an amount is dust (too small to be economical)
 *
 * @param amount Amount in satoshis
 * @param feeRate Fee rate in sat/vB (used to determine cost to spend)
 * @returns True if amount is dust
 */
export function isDust(amount: bigint, feeRate: number = 3): boolean {
  // Cost to spend this output in the future
  const costToSpend = calculateTxFee(1, 0, feeRate);

  // If the output value is less than 3x the cost to spend it, it's dust
  return amount < BigInt(TX_SIZE_CONSTANTS.DUST_LIMIT_P2WPKH) ||
         amount < costToSpend * BigInt(3);
}

/**
 * Calculate total value of outputs
 *
 * @param outputs Array of outputs
 * @returns Total value in satoshis
 */
export function calculateOutputTotal(outputs: IOutput[]): bigint {
  return outputs.reduce((sum, output) => sum + output.value, BigInt(0));
}

/**
 * Largest-first selection strategy
 * Selects largest UTXOs first to minimize number of inputs
 *
 * @param utxos Available UTXOs
 * @param targetAmount Target amount to select (including fee estimate)
 * @returns Selected UTXOs or null if insufficient funds
 */
function selectLargestFirst(
  utxos: IUnifiedUtxo[],
  targetAmount: bigint
): IUnifiedUtxo[] | null {
  // Sort UTXOs by value (descending) — use bigint comparison to avoid precision loss
  const sorted = [...utxos].sort((a, b) => b.value > a.value ? 1 : b.value < a.value ? -1 : 0);

  const selected: IUnifiedUtxo[] = [];
  let total = BigInt(0);

  for (const utxo of sorted) {
    selected.push(utxo);
    total += utxo.value;

    if (total >= targetAmount) {
      return selected;
    }
  }

  return null; // Insufficient funds
}

/**
 * Smallest-first selection strategy
 * Selects smallest UTXOs first to consolidate small UTXOs
 *
 * @param utxos Available UTXOs
 * @param targetAmount Target amount to select
 * @returns Selected UTXOs or null if insufficient funds
 */
function selectSmallestFirst(
  utxos: IUnifiedUtxo[],
  targetAmount: bigint
): IUnifiedUtxo[] | null {
  // Sort UTXOs by value (ascending) — use bigint comparison to avoid precision loss
  const sorted = [...utxos].sort((a, b) => a.value > b.value ? 1 : a.value < b.value ? -1 : 0);

  const selected: IUnifiedUtxo[] = [];
  let total = BigInt(0);

  for (const utxo of sorted) {
    selected.push(utxo);
    total += utxo.value;

    if (total >= targetAmount) {
      return selected;
    }
  }

  return null; // Insufficient funds
}

/**
 * Accumulative selection strategy (simple, efficient)
 * Selects UTXOs in order until target is met
 *
 * @param utxos Available UTXOs
 * @param targetAmount Target amount to select
 * @returns Selected UTXOs or null if insufficient funds
 */
function selectAccumulative(
  utxos: IUnifiedUtxo[],
  targetAmount: bigint
): IUnifiedUtxo[] | null {
  const selected: IUnifiedUtxo[] = [];
  let total = BigInt(0);

  for (const utxo of utxos) {
    selected.push(utxo);
    total += utxo.value;

    if (total >= targetAmount) {
      return selected;
    }
  }

  return null; // Insufficient funds
}

/**
 * Branch and Bound selection strategy (optimal)
 * Attempts to find exact match or minimize change
 * Falls back to largest-first if no good solution found
 *
 * @param utxos Available UTXOs
 * @param targetAmount Target amount to select
 * @param feeRate Fee rate for calculating cost
 * @returns Selected UTXOs or null if insufficient funds
 */
function selectBranchAndBound(
  utxos: IUnifiedUtxo[],
  targetAmount: bigint,
  feeRate: number
): IUnifiedUtxo[] | null {
  // Sort UTXOs by value (descending) for better pruning — use bigint comparison to avoid precision loss
  const sorted = [...utxos].sort((a, b) => b.value > a.value ? 1 : b.value < a.value ? -1 : 0);

  // Calculate total available
  const totalAvailable = sorted.reduce((sum, utxo) => sum + utxo.value, BigInt(0));
  if (totalAvailable < targetAmount) {
    return null; // Insufficient funds
  }

  // Define cost of change (fee to create + fee to spend later)
  const changeCost = calculateTxFee(0, 1, feeRate) + calculateTxFee(1, 0, feeRate);

  let bestSelection: IUnifiedUtxo[] | null = null;
  let bestWaste = BigInt(2) ** BigInt(63) - BigInt(1); // Max bigint

  // Iteration counter to prevent UI freeze with large UTXO sets
  const MAX_ITERATIONS = 100_000;
  let iterations = 0;

  /**
   * Recursive branch and bound search
   * @param index Current UTXO index
   * @param selected Currently selected UTXOs
   * @param total Current total value
   */
  function search(index: number, selected: IUnifiedUtxo[], total: bigint): void {
    // Bail out if we've exceeded the iteration budget
    if (++iterations > MAX_ITERATIONS) {
      return;
    }

    // Base case: reached target
    if (total >= targetAmount) {
      const excess = total - targetAmount;

      // Calculate waste (excess if no change, or changeCost if creating change)
      let waste: bigint;
      if (excess === BigInt(0)) {
        waste = BigInt(0); // Perfect match!
      } else if (excess < changeCost) {
        waste = excess; // Too small for change, will be added to fee
      } else {
        waste = changeCost; // Will create change output
      }

      if (waste < bestWaste) {
        bestWaste = waste;
        bestSelection = [...selected];
      }
      return;
    }

    // Pruning: if no more UTXOs, stop
    if (index >= sorted.length) {
      return;
    }

    // Pruning: if remaining UTXOs can't reach target, stop
    const remainingValue = sorted.slice(index).reduce((sum, utxo) => sum + utxo.value, BigInt(0));
    if (total + remainingValue < targetAmount) {
      return;
    }

    // Branch 1: Include current UTXO
    search(index + 1, [...selected, sorted[index]], total + sorted[index].value);

    // Branch 2: Exclude current UTXO
    search(index + 1, selected, total);
  }

  // Run branch and bound search
  // Note: Could add timeout logic here for very large UTXO sets
  try {
    search(0, [], BigInt(0));
  } catch (e) {
    // Error occurred, fall back to largest-first
    console.warn('Branch and bound failed, falling back to largest-first');
    return selectLargestFirst(sorted, targetAmount);
  }

  // If found a good solution, return it
  if (bestSelection) {
    return bestSelection;
  }

  // Fallback to largest-first
  return selectLargestFirst(sorted, targetAmount);
}

/**
 * Select UTXOs for a transaction using the specified strategy
 *
 * @param utxos Available UTXOs (must be confirmed)
 * @param outputs Transaction outputs
 * @param feeRate Fee rate in satoshis per vbyte
 * @param changeAddress Address for change output
 * @param strategy Coin selection strategy (default: accumulative)
 * @returns Coin selection result with selected UTXOs, change, and fee
 * @throws Error if insufficient funds
 */
export function selectCoins(
  utxos: IUnifiedUtxo[],
  outputs: IOutput[],
  feeRate: number,
  changeAddress: string,
  strategy: CoinSelectionStrategy = CoinSelectionStrategy.ACCUMULATIVE
): ICoinSelection {
  // Validate inputs
  if (utxos.length === 0) {
    throw new Error('No UTXOs available for coin selection');
  }

  if (outputs.length === 0) {
    throw new Error('No outputs specified for transaction');
  }

  if (feeRate <= 0) {
    throw new Error('Invalid fee rate: must be positive');
  }

  // Filter only confirmed UTXOs
  const confirmedUtxos = utxos.filter(utxo => utxo.confirmed);
  if (confirmedUtxos.length === 0) {
    throw new Error('No confirmed UTXOs available for spending');
  }

  // Calculate total output amount
  const outputTotal = calculateOutputTotal(outputs);

  // Initial fee estimate (without change output)
  let selectedUtxos: IUnifiedUtxo[] | null = null;
  let fee = BigInt(0);
  let changeAmount = BigInt(0);

  // Iterative selection: estimate fee, select UTXOs, recalculate
  let iteration = 0;
  const maxIterations = 5;

  while (iteration < maxIterations) {
    iteration++;

    // Estimate fee based on current selection or initial guess
    const estimatedInputCount = selectedUtxos?.length || Math.ceil(confirmedUtxos.length / 2);
    const estimatedOutputCount = outputs.length + (changeAmount > BigInt(0) ? 1 : 0);
    fee = calculateTxFee(estimatedInputCount, estimatedOutputCount, feeRate);

    const targetAmount = outputTotal + fee;

    // Select UTXOs based on strategy
    switch (strategy) {
      case CoinSelectionStrategy.LARGEST_FIRST:
        selectedUtxos = selectLargestFirst(confirmedUtxos, targetAmount);
        break;
      case CoinSelectionStrategy.SMALLEST_FIRST:
        selectedUtxos = selectSmallestFirst(confirmedUtxos, targetAmount);
        break;
      case CoinSelectionStrategy.BRANCH_AND_BOUND:
        selectedUtxos = selectBranchAndBound(confirmedUtxos, targetAmount, feeRate);
        break;
      case CoinSelectionStrategy.ACCUMULATIVE:
      default:
        selectedUtxos = selectAccumulative(confirmedUtxos, targetAmount);
        break;
    }

    if (!selectedUtxos) {
      throw new Error('Insufficient funds for transaction');
    }

    // Calculate actual total from selected UTXOs
    const selectedTotal = selectedUtxos.reduce((sum, utxo) => sum + utxo.value, BigInt(0));

    // Recalculate fee with actual input count
    const actualInputCount = selectedUtxos.length;
    let actualOutputCount = outputs.length;

    // Calculate preliminary change
    const preliminaryFee = calculateTxFee(actualInputCount, actualOutputCount, feeRate);
    const preliminaryChange = selectedTotal - outputTotal - preliminaryFee;

    // Determine if we should create a change output
    const changeThreshold = BigInt(Math.ceil(
      TX_SIZE_CONSTANTS.DUST_LIMIT_P2WPKH * TX_SIZE_CONSTANTS.CHANGE_THRESHOLD_MULTIPLIER
    ));

    if (preliminaryChange > changeThreshold) {
      // Create change output
      actualOutputCount = outputs.length + 1;
      fee = calculateTxFee(actualInputCount, actualOutputCount, feeRate);
      changeAmount = selectedTotal - outputTotal - fee;

      // Final dust check
      if (changeAmount < BigInt(TX_SIZE_CONSTANTS.DUST_LIMIT_P2WPKH)) {
        // Change is dust, add it to fee instead
        fee = selectedTotal - outputTotal;
        changeAmount = BigInt(0);
      }
    } else {
      // No change output, add remainder to fee
      fee = selectedTotal - outputTotal;
      changeAmount = BigInt(0);
    }

    // Check if selection is stable (no change in output count)
    const previousOutputCount = estimatedOutputCount;
    if (actualOutputCount === previousOutputCount) {
      break; // Converged
    }
  }

  if (!selectedUtxos) {
    throw new Error('Coin selection failed after maximum iterations');
  }

  return {
    selectedUtxos,
    changeAmount,
    fee,
  };
}

/**
 * Estimate maximum sendable amount (total UTXOs - fee)
 *
 * @param utxos Available UTXOs
 * @param feeRate Fee rate in sat/vB
 * @param outputCount Number of outputs (usually 1 for send-all)
 * @returns Maximum sendable amount in satoshis
 */
export function estimateMaxSendable(
  utxos: IUnifiedUtxo[],
  feeRate: number,
  outputCount: number = 1
): bigint {
  const confirmedUtxos = utxos.filter(utxo => utxo.confirmed);
  const total = confirmedUtxos.reduce((sum, utxo) => sum + utxo.value, BigInt(0));

  if (total === BigInt(0)) {
    return BigInt(0);
  }

  const inputCount = confirmedUtxos.length;
  const fee = calculateTxFee(inputCount, outputCount, feeRate);

  const maxSendable = total - fee;
  return maxSendable > BigInt(0) ? maxSendable : BigInt(0);
}
