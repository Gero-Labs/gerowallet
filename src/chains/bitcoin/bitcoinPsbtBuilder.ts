/**
 * Bitcoin PSBT (Partially Signed Bitcoin Transaction) Builder
 *
 * Builds unsigned PSBTs for Bitcoin transactions that can be signed by:
 * - Software wallets (private key signing)
 * - Hardware wallets (Ledger, Trezor, Keystone)
 * - Multi-signature wallets (future support)
 */

import * as bitcoin from 'bitcoinjs-lib';
import { HDKey } from '@scure/bip32';
import type { IUnifiedUtxo, IOutput, IBuildTxParams, IUnsignedTx } from '@/chains/common/interfaces';
import { selectCoins, CoinSelectionStrategy, calculateTxSize } from './bitcoinCoinSelection';

/**
 * PSBT build options
 */
export interface PsbtBuildOptions {
  /** Fee rate in satoshis per vbyte */
  feeRate: number;

  /** Change address (required if change output will be created) */
  changeAddress: string;

  /** Coin selection strategy */
  strategy?: CoinSelectionStrategy;

  /** Sequence number for inputs (default: 0xfffffffd for RBF) */
  sequence?: number;

  /** Locktime (default: 0) */
  locktime?: number;

  /** Enable Replace-By-Fee (RBF) */
  rbfEnabled?: boolean;

  /** The account whose keys spend the inputs, for their derivation metadata (improves signing accuracy) */
  account?: PsbtAccount;
}

/**
 * The account an input's key belongs to, as PSBT derivation metadata names it (BIP174).
 * Hardware signers recognise an input as theirs by the master fingerprint and full path.
 */
export interface PsbtAccount {
  /** Account xpub, m/purpose'/coinType'/account' */
  xpub: string;
  /** That account's full path, e.g. m/84'/1'/0' */
  path: string;
  /** The wallet's master key fingerprint (8 hex characters), when Gero knows it */
  masterFingerprint?: string;
}

/**
 * BIP174 has no "unknown" master fingerprint: zero is the usual placeholder, which no
 * device claims as its own.
 */
const UNKNOWN_MASTER_FINGERPRINT = Buffer.alloc(4);

/**
 * Get Bitcoin network object
 */
export function getBitcoinNetwork(network: string): bitcoin.Network {
  switch (network.toLowerCase()) {
    case 'mainnet':
      return bitcoin.networks.bitcoin;
    case 'testnet':
    case 'preprod':
    case 'preview':
      return bitcoin.networks.testnet;
    default:
      throw new Error(`Unknown Bitcoin network: ${network}`);
  }
}

/** A PSBT input as `Psbt.addInput` takes it */
type PsbtInputData = Parameters<bitcoin.Psbt['addInput']>[0];

/**
 * Whether `script` pays a Taproot (P2TR) output: OP_1 followed by a 32-byte key
 */
export function isTaprootScript(script: Uint8Array): boolean {
  return script.length === 34 && script[0] === bitcoin.opcodes['OP_1'] && script[1] === 0x20;
}

/**
 * Convert IUnifiedUtxo to PSBT input format
 * Includes witness UTXO data required for SegWit signing
 * Optionally adds derivation metadata for correct key derivation during signing:
 * bip32Derivation, or for a Taproot input its internal key and tapBip32Derivation
 * (BIP371), since bitcoinjs-lib refuses bip32Derivation on a Taproot input
 */
function utxoToPsbtInput(
  utxo: IUnifiedUtxo,
  network: bitcoin.Network,
  sequence: number,
  account?: PsbtAccount
): PsbtInputData {
  // Convert hex string to Buffer
  const txidBuffer = Buffer.from(utxo.txHash, 'hex').reverse(); // Reverse for little-endian

  // Create witness UTXO (required for SegWit P2WPKH)
  const witnessUtxo = {
    script: bitcoin.address.toOutputScript(utxo.address, network),
    value: Number(utxo.value), // PSBT expects number, not bigint
  };

  const input: PsbtInputData = {
    hash: txidBuffer,
    index: utxo.index,
    witnessUtxo,
    sequence,
  };

  // Add the derivation metadata if we have derivation info and the account: the wallet's
  // master fingerprint and the key's full path from the master key
  if (account && utxo.derivationChain !== undefined && utxo.derivationIndex !== undefined) {
    try {
      const accountNode = HDKey.fromExtendedKey(account.xpub);
      const masterFingerprint = /^[0-9a-f]{8}$/i.test(account.masterFingerprint ?? '')
        ? Buffer.from(account.masterFingerprint!, 'hex')
        : UNKNOWN_MASTER_FINGERPRINT;
      const path = `${account.path}/${utxo.derivationChain}/${utxo.derivationIndex}`;
      const childNode = accountNode.derive(`m/${utxo.derivationChain}/${utxo.derivationIndex}`);
      if (childNode.publicKey && isTaprootScript(witnessUtxo.script)) {
        // BIP86 key-path output: the x-only child key is its internal key
        const internalKey = Buffer.from(childNode.publicKey.subarray(1, 33));
        input.tapInternalKey = internalKey;
        input.tapBip32Derivation = [{ masterFingerprint, pubkey: internalKey, path, leafHashes: [] }];
      } else if (childNode.publicKey) {
        input.bip32Derivation = [{ masterFingerprint, pubkey: Buffer.from(childNode.publicKey), path }];
      }
    } catch (e) {
      console.warn('Failed to add bip32Derivation to PSBT input:', e);
    }
  }

  return input;
}

/**
 * Build unsigned PSBT from selected UTXOs and outputs
 *
 * @param params Transaction build parameters
 * @param network Bitcoin network (Mainnet/Testnet)
 * @param options PSBT build options
 * @returns Unsigned transaction with PSBT
 */
export function buildPsbt(
  params: IBuildTxParams,
  network: string,
  options: PsbtBuildOptions
): IUnsignedTx {
  const bitcoinNetwork = getBitcoinNetwork(network);

  // Validate inputs
  if (!params.utxos || params.utxos.length === 0) {
    throw new Error('No UTXOs provided for transaction building');
  }

  if (!params.outputs || params.outputs.length === 0) {
    throw new Error('No outputs provided for transaction building');
  }

  if (options.feeRate <= 0) {
    throw new Error('Fee rate must be positive');
  }

  // Perform coin selection
  const selection = selectCoins(
    params.utxos,
    params.outputs,
    options.feeRate,
    options.changeAddress,
    options.strategy || CoinSelectionStrategy.ACCUMULATIVE
  );

  // Determine sequence number for inputs
  // 0xfffffffd (4294967293) = RBF enabled (BIP 125)
  // 0xfffffffe (4294967294) = RBF disabled, locktime enabled
  // 0xffffffff (4294967295) = RBF disabled, locktime disabled
  const sequence = options.sequence !== undefined
    ? options.sequence
    : (options.rbfEnabled !== false ? 0xfffffffd : 0xfffffffe);

  const locktime = options.locktime || 0;

  // Create PSBT
  const psbt = new bitcoin.Psbt({ network: bitcoinNetwork });

  // Set transaction version (2 = supports BIP68 relative timelocks)
  psbt.setVersion(2);

  // Set locktime if specified
  if (locktime > 0) {
    psbt.setLocktime(locktime);
  }

  // Add inputs from selected UTXOs
  for (const utxo of selection.selectedUtxos) {
    const input = utxoToPsbtInput(utxo, bitcoinNetwork, sequence, options.account);
    psbt.addInput(input);
  }

  // Add recipient outputs
  for (const output of params.outputs) {
    psbt.addOutput({
      address: output.address,
      value: Number(output.value), // PSBT expects number
    });
  }

  // Add change output if needed
  if (selection.changeAmount > BigInt(0)) {
    psbt.addOutput({
      address: options.changeAddress,
      value: Number(selection.changeAmount),
    });
  }

  // Validate transaction balance
  const inputTotal = selection.selectedUtxos.reduce(
    (sum, utxo) => sum + utxo.value,
    BigInt(0)
  );
  const outputTotal = params.outputs.reduce(
    (sum, output) => sum + output.value,
    BigInt(0)
  );
  const changeTotal = selection.changeAmount;
  const calculatedTotal = outputTotal + changeTotal + selection.fee;

  if (inputTotal !== calculatedTotal) {
    throw new Error(
      `Transaction balance mismatch: inputs=${inputTotal}, outputs+change+fee=${calculatedTotal}`
    );
  }

  // Get PSBT hex for storage/transmission
  const psbtHex = psbt.toHex();
  const psbtBase64 = psbt.toBase64();

  // Create unsigned transaction result
  const unsignedTx: IUnsignedTx = {
    raw: {
      psbt,           // bitcoinjs-lib PSBT object
      hex: psbtHex,   // Hex encoding (for storage)
      base64: psbtBase64, // Base64 encoding (for QR codes, hardware wallets)
    },
    fee: selection.fee,
    inputs: selection.selectedUtxos,
    outputs: [
      ...params.outputs,
      // Add change output to outputs list if created
      ...(selection.changeAmount > BigInt(0)
        ? [{ address: options.changeAddress, value: selection.changeAmount }]
        : []),
    ],
  };

  return unsignedTx;
}

/**
 * Build PSBT for a simple send transaction
 *
 * @param utxos Available UTXOs
 * @param recipientAddress Recipient Bitcoin address
 * @param amount Amount to send in satoshis
 * @param changeAddress Change address
 * @param feeRate Fee rate in sat/vB
 * @param network Bitcoin network
 * @param account The account spending the UTXOs, for the inputs' derivation metadata
 * @returns Unsigned transaction with PSBT
 */
export function buildSimpleSendPsbt(
  utxos: IUnifiedUtxo[],
  recipientAddress: string,
  amount: bigint,
  changeAddress: string,
  feeRate: number,
  network: string,
  account?: PsbtAccount
): IUnsignedTx {
  const outputs: IOutput[] = [
    {
      address: recipientAddress,
      value: amount,
    },
  ];

  const params: IBuildTxParams = {
    outputs,
    utxos,
    changeAddress,
    feeRate,
  };

  const options: PsbtBuildOptions = {
    feeRate,
    changeAddress,
    rbfEnabled: true, // Enable RBF by default
    account,
  };

  return buildPsbt(params, network, options);
}

/**
 * Build PSBT for "send all" transaction (sweep wallet)
 *
 * @param utxos Available UTXOs
 * @param recipientAddress Recipient Bitcoin address
 * @param feeRate Fee rate in sat/vB
 * @param network Bitcoin network
 * @returns Unsigned transaction with PSBT
 */
export function buildSendAllPsbt(
  utxos: IUnifiedUtxo[],
  recipientAddress: string,
  feeRate: number,
  network: string
): IUnsignedTx {
  const bitcoinNetwork = getBitcoinNetwork(network);

  // Use all confirmed UTXOs
  const confirmedUtxos = utxos.filter((utxo) => utxo.confirmed);

  if (confirmedUtxos.length === 0) {
    throw new Error('No confirmed UTXOs available');
  }

  // Calculate total input value
  const inputTotal = confirmedUtxos.reduce((sum, utxo) => sum + utxo.value, BigInt(0));

  // Estimate fee (all inputs, 1 output, no change)
  const psbtTemp = new bitcoin.Psbt({ network: bitcoinNetwork });

  // Add all inputs to estimate size
  for (const utxo of confirmedUtxos) {
    const input = utxoToPsbtInput(utxo, bitcoinNetwork, 0xfffffffd);
    psbtTemp.addInput(input);
  }

  // Add dummy output for size calculation
  psbtTemp.addOutput({
    address: recipientAddress,
    value: 1000, // Dummy value
  });

  // Extract transaction to get size
  // Note: This won't work without signatures, so we'll estimate manually
  const estimatedVsize = calculateTxSize(confirmedUtxos.length, 1);
  const fee = BigInt(Math.ceil(estimatedVsize * feeRate));

  // Calculate amount to send (all inputs minus fee)
  const sendAmount = inputTotal - fee;

  if (sendAmount <= BigInt(0)) {
    throw new Error('Insufficient funds to cover fee');
  }

  // Build PSBT with exact amount
  const psbt = new bitcoin.Psbt({ network: bitcoinNetwork });
  psbt.setVersion(2);

  // Add all inputs
  for (const utxo of confirmedUtxos) {
    const input = utxoToPsbtInput(utxo, bitcoinNetwork, 0xfffffffd);
    psbt.addInput(input);
  }

  // Add single output with all funds minus fee
  psbt.addOutput({
    address: recipientAddress,
    value: Number(sendAmount),
  });

  const psbtHex = psbt.toHex();
  const psbtBase64 = psbt.toBase64();

  const unsignedTx: IUnsignedTx = {
    raw: {
      psbt,
      hex: psbtHex,
      base64: psbtBase64,
    },
    fee,
    inputs: confirmedUtxos,
    outputs: [{ address: recipientAddress, value: sendAmount }],
  };

  return unsignedTx;
}

/**
 * Parse PSBT from hex string
 *
 * @param psbtHex PSBT in hexadecimal format
 * @param network Bitcoin network
 * @returns Parsed PSBT object
 */
export function parsePsbtFromHex(psbtHex: string, network: string): bitcoin.Psbt {
  const bitcoinNetwork = getBitcoinNetwork(network);
  return bitcoin.Psbt.fromHex(psbtHex, { network: bitcoinNetwork });
}

/** A PSBT given as hex or base64. */
export function parseBitcoinPsbt(value: string, network: string): bitcoin.Psbt {
  const opts = { network: getBitcoinNetwork(network) };
  return /^[\da-f]+$/i.test(value) ? bitcoin.Psbt.fromHex(value, opts) : bitcoin.Psbt.fromBase64(value, opts);
}

/**
 * The address input `i` spends from, read from the previous output its PSBT data carries
 */
export function spentAddress(psbt: bitcoin.Psbt, i: number, network: bitcoin.Network): string | undefined {
  const input = psbt.data.inputs[i];
  try {
    const script = input.witnessUtxo?.script
      ?? (input.nonWitnessUtxo && bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo).outs[psbt.txInputs[i].index]?.script);
    return script ? bitcoin.address.fromOutputScript(script, network) : undefined;
  } catch {
    return undefined; // no standard address script
  }
}

/**
 * Parse PSBT from base64 string
 *
 * @param psbtBase64 PSBT in base64 format
 * @param network Bitcoin network
 * @returns Parsed PSBT object
 */
export function parsePsbtFromBase64(psbtBase64: string, network: string): bitcoin.Psbt {
  const bitcoinNetwork = getBitcoinNetwork(network);
  return bitcoin.Psbt.fromBase64(psbtBase64, { network: bitcoinNetwork });
}

/**
 * Extract transaction details from PSBT
 *
 * @param psbt PSBT object
 * @returns Transaction details
 */
export function extractPsbtDetails(psbt: bitcoin.Psbt): {
  inputCount: number;
  outputCount: number;
  fee: bigint;
  totalInput: bigint;
  totalOutput: bigint;
} {
  const inputs = psbt.data.inputs;
  const outputs = psbt.txOutputs;

  // Calculate total input value
  let totalInput = BigInt(0);
  for (const input of inputs) {
    if (input.witnessUtxo) {
      totalInput += BigInt(input.witnessUtxo.value);
    }
  }

  // Calculate total output value
  let totalOutput = BigInt(0);
  for (const output of outputs) {
    totalOutput += BigInt(output.value);
  }

  const fee = totalInput - totalOutput;

  return {
    inputCount: inputs.length,
    outputCount: outputs.length,
    fee,
    totalInput,
    totalOutput,
  };
}

/**
 * Validate PSBT structure and balances
 *
 * @param psbt PSBT object
 * @throws Error if PSBT is invalid
 */
export function validatePsbt(psbt: bitcoin.Psbt): void {
  const details = extractPsbtDetails(psbt);

  if (details.inputCount === 0) {
    throw new Error('PSBT has no inputs');
  }

  if (details.outputCount === 0) {
    throw new Error('PSBT has no outputs');
  }

  if (details.fee < BigInt(0)) {
    throw new Error(`PSBT has negative fee: ${details.fee}`);
  }

  if (details.totalInput === BigInt(0)) {
    throw new Error('PSBT has zero input value');
  }

  if (details.totalOutput === BigInt(0)) {
    throw new Error('PSBT has zero output value');
  }

  if (details.totalInput < details.totalOutput) {
    throw new Error('PSBT inputs are less than outputs (negative fee)');
  }
}

/**
 * Combine multiple signed PSBTs (for multi-sig or partial signing)
 *
 * @param psbt Base PSBT
 * @param signedPsbts Array of signed PSBTs to combine
 * @returns Combined PSBT
 */
export function combinePsbts(psbt: bitcoin.Psbt, signedPsbts: bitcoin.Psbt[]): bitcoin.Psbt {
  const combined = psbt.clone();

  for (const signedPsbt of signedPsbts) {
    combined.combine(signedPsbt);
  }

  return combined;
}

/**
 * Finalize PSBT after all signatures are added
 * Extracts the final signed transaction
 *
 * @param psbt Signed PSBT
 * @returns Final transaction hex and txid
 */
export function finalizePsbt(psbt: bitcoin.Psbt): {
  txHex: string;
  txId: string;
} {
  // Finalize all inputs (add witness/scriptSig)
  psbt.finalizeAllInputs();

  // Extract final transaction
  const tx = psbt.extractTransaction();
  const txHex = tx.toHex();
  const txId = tx.getId();

  return { txHex, txId };
}
