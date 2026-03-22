/**
 * Babylon Staking Transaction Builder
 *
 * Builds staking PSBTs using the official @babylonlabs-io/btc-staking-ts library.
 * Maps Gero's BabylonParamVersion and IUnifiedUtxo types to the SDK's formats.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import type { BabylonParamVersion } from '@/api/babylon-api';
import type { IUnifiedUtxo } from '@/chains/common/interfaces';

// Initialize ECC library
bitcoin.initEccLib(ecc);

export interface BabylonStakingBuildParams {
  /** Staker x-only pubkey (64 hex chars, no 02/03 prefix) */
  stakerPkHex: string;
  /** Staker receive address (segwit bc1q... or taproot bc1p...) */
  stakerAddress: string;
  /** Finality provider x-only pubkey (64 hex chars) */
  finalityProviderPkHex: string;
  /** Staking timelock in blocks */
  stakingTimelock: number;
  /** Amount to stake in satoshis */
  stakingAmountSat: number;
  /** Fee rate in sat/vbyte */
  feeRate: number;
  /** Available UTXOs */
  utxos: IUnifiedUtxo[];
  /** Babylon staking params for current version */
  params: BabylonParamVersion;
  /** Bitcoin network ('Mainnet' | 'Testnet') */
  network: string;
}

export interface BabylonStakingPsbtResult {
  /** PSBT hex string ready for signing */
  psbtHex: string;
  /** Estimated fee in satoshis */
  fee: number;
  /** Input UTXOs used */
  inputUtxos: IUnifiedUtxo[];
}

/**
 * Convert Gero's IUnifiedUtxo to the Babylon SDK's UTXO format
 */
function toSdkUtxo(utxo: IUnifiedUtxo, network: bitcoin.Network): { txid: string; vout: number; value: number; scriptPubKey: string } {
  let scriptPubKey = utxo.scriptPubKey || '';

  // Derive scriptPubKey from address if not already set
  if (!scriptPubKey && utxo.address) {
    try {
      scriptPubKey = bitcoin.address.toOutputScript(utxo.address, network).toString('hex');
    } catch (e) {
      console.warn('Failed to derive scriptPubKey from address:', utxo.address, e);
    }
  }

  return {
    txid: utxo.txHash,
    vout: utxo.index,
    value: Number(utxo.value),
    scriptPubKey,
  };
}

/**
 * Convert Gero's BabylonParamVersion to the SDK's StakingParams format
 */
function toSdkStakingParams(params: BabylonParamVersion) {
  return {
    covenantNoCoordPks: params.covenant_pks,
    covenantQuorum: params.covenant_quorum,
    unbondingTime: params.unbonding_time,
    unbondingFeeSat: params.unbonding_fee,
    maxStakingAmountSat: params.max_staking_amount,
    minStakingAmountSat: params.min_staking_amount,
    maxStakingTimeBlocks: params.max_staking_time,
    minStakingTimeBlocks: params.min_staking_time,
  };
}

/**
 * Build an unsigned Babylon staking PSBT.
 *
 * Returns a PSBT hex that can be signed by `walletBg.signBitcoinTransaction()`.
 *
 * @throws {Error} if parameters are invalid or UTXOs are insufficient
 */
export async function buildBabylonStakingPsbt(
  buildParams: BabylonStakingBuildParams
): Promise<BabylonStakingPsbtResult> {
  const {
    stakerPkHex,
    stakerAddress,
    finalityProviderPkHex,
    stakingTimelock,
    stakingAmountSat,
    feeRate,
    utxos,
    params,
    network,
  } = buildParams;

  const { Staking, initBTCCurve } = await import('@babylonlabs-io/btc-staking-ts');

  // Initialize the secp256k1 curve required by the Babylon SDK
  initBTCCurve();

  const bitcoinNetwork = network === 'Mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;

  const stakerInfo = {
    address: stakerAddress,
    publicKeyNoCoordHex: stakerPkHex,
  };

  const sdkParams = toSdkStakingParams(params);

  const staking = new Staking(
    bitcoinNetwork,
    stakerInfo,
    sdkParams,
    [finalityProviderPkHex],
    stakingTimelock
  );

  const sdkUtxos = utxos.map(u => toSdkUtxo(u, bitcoinNetwork));

  // Build unsigned staking transaction
  const { transaction, fee } = staking.createStakingTransaction(
    stakingAmountSat,
    sdkUtxos,
    feeRate
  );

  // Convert to PSBT for signing
  const psbt = staking.toStakingPsbt(transaction, sdkUtxos);

  return {
    psbtHex: psbt.toHex(),
    fee,
    inputUtxos: utxos,
  };
}