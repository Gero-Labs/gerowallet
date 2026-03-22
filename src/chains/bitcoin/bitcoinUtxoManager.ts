/**
 * Bitcoin UTXO Manager
 *
 * Handles Bitcoin UTXO parsing, balance calculation, and management.
 * Converts Bitcoin API responses to unified UTXO format.
 */

import type { IUnifiedUtxo, IBalance } from '@/chains/common/interfaces';
import type { BitcoinUtxo } from '@/api/bitcoin-api';

/**
 * Parse Bitcoin UTXOs to unified format
 *
 * @param rawUtxos Array of Bitcoin UTXOs from API
 * @param address Bitcoin address (for verification)
 * @returns Array of unified UTXOs
 */
export function parseBitcoinUtxos(rawUtxos: BitcoinUtxo[], address: string): IUnifiedUtxo[] {
  return rawUtxos.map((utxo) => {
    const unifiedUtxo: IUnifiedUtxo = {
      txHash: utxo.txid,
      index: utxo.vout,
      address: address,  // Bitcoin UTXOs don't include address in response
      value: BigInt(utxo.value),  // Convert satoshis to bigint
      confirmed: utxo.status.confirmed,
      // Store raw Bitcoin UTXO data for transaction building
      raw: utxo,
    };

    return unifiedUtxo;
  });
}

/**
 * Calculate balance from Bitcoin UTXOs
 *
 * @param utxos Array of unified UTXOs
 * @returns Balance breakdown (available, total, locked)
 */
export function calculateBitcoinBalance(utxos: IUnifiedUtxo[]): IBalance {
  let confirmedBalance = BigInt(0);
  let unconfirmedBalance = BigInt(0);

  for (const utxo of utxos) {
    if (utxo.confirmed) {
      confirmedBalance += utxo.value;
    } else {
      unconfirmedBalance += utxo.value;
    }
  }

  const totalBalance = confirmedBalance + unconfirmedBalance;

  return {
    available: confirmedBalance,  // Only confirmed balance is available for spending
    total: totalBalance,
    locked: BigInt(0),  // Bitcoin doesn't have locked balance (no staking)
  };
}

/**
 * Get confirmed UTXOs only (ready for spending)
 *
 * @param utxos Array of unified UTXOs
 * @returns Array of confirmed UTXOs
 */
export function getConfirmedUtxos(utxos: IUnifiedUtxo[]): IUnifiedUtxo[] {
  return utxos.filter((utxo) => utxo.confirmed);
}

/**
 * Get unconfirmed UTXOs only
 *
 * @param utxos Array of unified UTXOs
 * @returns Array of unconfirmed UTXOs
 */
export function getUnconfirmedUtxos(utxos: IUnifiedUtxo[]): IUnifiedUtxo[] {
  return utxos.filter((utxo) => !utxo.confirmed);
}

/**
 * Sort UTXOs by value (ascending or descending)
 *
 * @param utxos Array of unified UTXOs
 * @param descending Sort in descending order (largest first)
 * @returns Sorted array of UTXOs
 */
export function sortUtxosByValue(utxos: IUnifiedUtxo[], descending: boolean = false): IUnifiedUtxo[] {
  return [...utxos].sort((a, b) => {
    if (descending) {
      return b.value > a.value ? 1 : b.value < a.value ? -1 : 0;
    }
    return a.value > b.value ? 1 : a.value < b.value ? -1 : 0;
  });
}

/**
 * Filter UTXOs by minimum value
 *
 * @param utxos Array of unified UTXOs
 * @param minValue Minimum value in satoshis
 * @returns Filtered array of UTXOs
 */
export function filterUtxosByMinValue(utxos: IUnifiedUtxo[], minValue: bigint): IUnifiedUtxo[] {
  return utxos.filter((utxo) => utxo.value >= minValue);
}

/**
 * Get total value of UTXOs
 *
 * @param utxos Array of unified UTXOs
 * @returns Total value in satoshis
 */
export function getTotalUtxoValue(utxos: IUnifiedUtxo[]): bigint {
  return utxos.reduce((sum, utxo) => sum + utxo.value, BigInt(0));
}

/**
 * Find UTXO by transaction hash and index
 *
 * @param utxos Array of unified UTXOs
 * @param txHash Transaction hash
 * @param index Output index
 * @returns UTXO or undefined if not found
 */
export function findUtxo(utxos: IUnifiedUtxo[], txHash: string, index: number): IUnifiedUtxo | undefined {
  return utxos.find((utxo) => utxo.txHash === txHash && utxo.index === index);
}

/**
 * Remove spent UTXOs from the set
 *
 * @param utxos Current UTXO set
 * @param spentUtxos UTXOs to remove (spent in transaction)
 * @returns Updated UTXO set
 */
export function removeSpentUtxos(utxos: IUnifiedUtxo[], spentUtxos: IUnifiedUtxo[]): IUnifiedUtxo[] {
  const spentSet = new Set(
    spentUtxos.map((utxo) => `${utxo.txHash}:${utxo.index}`)
  );

  return utxos.filter((utxo) => !spentSet.has(`${utxo.txHash}:${utxo.index}`));
}

/**
 * Merge new UTXOs with existing set (add new, keep existing)
 *
 * @param existingUtxos Current UTXO set
 * @param newUtxos New UTXOs from API
 * @returns Merged UTXO set
 */
export function mergeUtxoSets(existingUtxos: IUnifiedUtxo[], newUtxos: IUnifiedUtxo[]): IUnifiedUtxo[] {
  const existingMap = new Map(
    existingUtxos.map((utxo) => [`${utxo.txHash}:${utxo.index}`, utxo])
  );

  // Add or update UTXOs
  for (const newUtxo of newUtxos) {
    const key = `${newUtxo.txHash}:${newUtxo.index}`;
    existingMap.set(key, newUtxo);
  }

  return Array.from(existingMap.values());
}

/**
 * Format satoshis to BTC string (8 decimal places)
 *
 * @param satoshis Amount in satoshis
 * @returns BTC string (e.g., "0.00123456")
 */
export function formatBtc(satoshis: bigint | number): string {
  const value = typeof satoshis === 'bigint' ? Number(satoshis) : satoshis;
  return (value / 100000000).toFixed(8);
}

/**
 * Parse BTC string to satoshis
 *
 * @param btc BTC amount as string (e.g., "0.00123456")
 * @returns Satoshis as bigint
 */
export function parseBtc(btc: string): bigint {
  const value = parseFloat(btc);
  if (isNaN(value)) {
    throw new Error(`Invalid BTC amount: ${btc}`);
  }
  return BigInt(Math.round(value * 100000000));
}
