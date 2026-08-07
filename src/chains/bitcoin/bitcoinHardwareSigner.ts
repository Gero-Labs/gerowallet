/**
 * Bitcoin Hardware Wallet Signer
 *
 * Unified interface for signing Bitcoin PSBTs with hardware wallets:
 * - Ledger (USB/Bluetooth)
 * - Trezor (Bridge)
 * - Keystone (QR codes, air-gapped)
 */

import * as bitcoin from 'bitcoinjs-lib';
import { WalletType } from '@/models/types';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { getBitcoinNetwork, finalizePsbt } from './bitcoinPsbtBuilder';

/**
 * Hardware wallet signing result
 */
export interface HardwareSigningResult {
  success: boolean;
  signedPsbt?: bitcoin.Psbt;
  txHex?: string;
  txId?: string;
  error?: string;
  // For Keystone QR code flow
  qrData?: string;
  requiresQrScan?: boolean;
}

/**
 * Sign PSBT with Ledger hardware wallet
 *
 * @param psbt PSBT to sign (hex or base64 string)
 * @param network Bitcoin network
 * @param addressType Address type
 * @param accountIndex Account index
 * @returns Signed PSBT
 */
export async function signPsbtWithLedger(
  psbt: string,
  network: string,
  addressType: string = 'segwit',
  accountIndex: number = 0
): Promise<HardwareSigningResult> {
  try {
    const ledger = await import('@/shared/utils/ledger');

    // Sign PSBT with Ledger
    const signedPsbtHex = await ledger.default.signBitcoinTransaction(
      psbt,
      addressType,
      accountIndex
    );

    // Parse signed PSBT
    const bitcoinNetwork = getBitcoinNetwork(network);
    const signedPsbt = bitcoin.Psbt.fromHex(signedPsbtHex, { network: bitcoinNetwork });

    // Finalize and extract transaction
    const { txHex, txId } = finalizePsbt(signedPsbt);

    return {
      success: true,
      signedPsbt,
      txHex,
      txId,
    };
  } catch (error) {
    console.error('Ledger signing failed:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Ledger signing failed: ${errorMessage}`,
    };
  }
}

/**
 * Sign PSBT with Trezor hardware wallet (called from a document/popup context)
 *
 * @param psbt PSBT to sign (hex or base64 string)
 * @param network Bitcoin network
 * @param addressType Address type
 * @returns Signed PSBT
 */
export async function signPsbtWithTrezor(
  psbt: string,
  network: string,
  addressType: string = 'segwit'
): Promise<HardwareSigningResult> {
  try {
    // This function is called from a document context (popup), not the background,
    // so it can use trezorWeb (connect-web WebUSB) when the flag is enabled.
    let signedPsbtHex: string;
    if (featureFlagsStore.state.flags.isTrezorWebUsbEnabled) {
      const trezorWeb = (await import('@/shared/utils/trezorWeb')).default;
      signedPsbtHex = await trezorWeb.signTransaction(psbt, addressType);
    } else {
      const trezor = (await import('@/shared/utils/trezor')).default;
      signedPsbtHex = await trezor.signBitcoinTransaction(psbt, addressType);
    }

    // Parse signed PSBT
    const bitcoinNetwork = getBitcoinNetwork(network);
    const signedPsbt = bitcoin.Psbt.fromHex(signedPsbtHex, { network: bitcoinNetwork });

    // Finalize and extract transaction
    const { txHex, txId } = finalizePsbt(signedPsbt);

    return {
      success: true,
      signedPsbt,
      txHex,
      txId,
    };
  } catch (error) {
    console.error('Trezor signing failed:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Trezor signing failed: ${errorMessage}`,
    };
  }
}

/**
 * Generate Keystone PSBT QR code for signing
 * Step 1: Display QR code to device
 *
 * @param psbt PSBT to sign (hex string)
 * @returns QR code data for display
 */
export async function generateKeystonePsbtQR(psbt: string): Promise<HardwareSigningResult> {
  try {
    const { generateBitcoinPSBTQR } = await import('@/shared/utils/keystone');

    // Generate QR code options
    const qrOptions = generateBitcoinPSBTQR(psbt);

    // Return QR data for rendering
    return {
      success: true,
      qrData: JSON.stringify(qrOptions),
      requiresQrScan: true,
    };
  } catch (error) {
    console.error('Keystone QR generation failed:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Keystone QR generation failed: ${errorMessage}`,
    };
  }
}

/**
 * Parse Keystone signed PSBT from scanned QR code
 * Step 2: Parse signed PSBT after user scans with device
 *
 * @param urString UR string from scanned QR code
 * @param network Bitcoin network
 * @returns Signed transaction
 */
export async function parseKeystoneSignedPsbt(
  urString: string,
  network: string
): Promise<HardwareSigningResult> {
  try {
    const { parseBitcoinSignature } = await import('@/shared/utils/keystone');
    const { URDecoder } = await import('@ngraveio/bc-ur');

    // Decode UR string
    const decoder = new URDecoder();
    decoder.receivePart(urString);

    if (!decoder.isComplete()) {
      return {
        success: false,
        error: 'Incomplete QR code data. Please scan all parts.',
      };
    }

    const ur = decoder.resultUR();

    // Parse signed PSBT
    const signedPsbtHex = parseBitcoinSignature(ur);

    // Parse PSBT
    const bitcoinNetwork = getBitcoinNetwork(network);
    const signedPsbt = bitcoin.Psbt.fromHex(signedPsbtHex, { network: bitcoinNetwork });

    // Finalize and extract transaction
    const { txHex, txId } = finalizePsbt(signedPsbt);

    return {
      success: true,
      signedPsbt,
      txHex,
      txId,
    };
  } catch (error) {
    console.error('Keystone PSBT parsing failed:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Keystone PSBT parsing failed: ${errorMessage}`,
    };
  }
}

/**
 * Sign PSBT with hardware wallet (unified interface)
 * Routes to appropriate device handler
 *
 * @param psbt PSBT to sign
 * @param walletType Hardware wallet type
 * @param network Bitcoin network
 * @param addressType Address type
 * @param options Device-specific options
 * @returns Signing result
 */
export async function signPsbtWithHardwareWallet(
  psbt: string,
  walletType: string,
  network: string,
  addressType: string = 'segwit',
  options?: {
    accountIndex?: number;  // For Ledger
    urString?: string;      // For Keystone (step 2)
  }
): Promise<HardwareSigningResult> {
  switch (walletType) {
    case WalletType.Ledger:
      return signPsbtWithLedger(psbt, network, addressType, options?.accountIndex || 0);

    case WalletType.Trezor:
      return signPsbtWithTrezor(psbt, network, addressType);

    case WalletType.Keystone:
      // Keystone is a two-step process
      if (options?.urString) {
        // Step 2: Parse signed PSBT from scanned QR
        return parseKeystoneSignedPsbt(options.urString, network);
      } else {
        // Step 1: Generate QR code for device to scan
        return generateKeystonePsbtQR(psbt);
      }

    default:
      return {
        success: false,
        error: `Unsupported hardware wallet type: ${walletType}`,
      };
  }
}

/**
 * Validate PSBT before hardware wallet signing
 * Ensures PSBT is well-formed and ready for signing
 *
 * @param psbt PSBT to validate
 * @param network Bitcoin network
 * @returns Validation result
 */
export function validatePsbtForHardwareSigning(
  psbt: string,
  network: string
): { valid: boolean; error?: string } {
  try {
    const bitcoinNetwork = getBitcoinNetwork(network);

    // Parse PSBT
    let psbtObj: bitcoin.Psbt;
    try {
      psbtObj = bitcoin.Psbt.fromHex(psbt, { network: bitcoinNetwork });
    } catch {
      psbtObj = bitcoin.Psbt.fromBase64(psbt, { network: bitcoinNetwork });
    }

    // Validate inputs
    if (psbtObj.data.inputs.length === 0) {
      return { valid: false, error: 'PSBT has no inputs' };
    }

    // Validate outputs
    if (psbtObj.txOutputs.length === 0) {
      return { valid: false, error: 'PSBT has no outputs' };
    }

    // Check witness UTXO data (required for SegWit signing)
    for (let i = 0; i < psbtObj.data.inputs.length; i++) {
      const input = psbtObj.data.inputs[i];
      if (!input.witnessUtxo && !input.nonWitnessUtxo) {
        return {
          valid: false,
          error: `Input ${i} missing UTXO data (witnessUtxo or nonWitnessUtxo required)`,
        };
      }
    }

    return { valid: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      error: `PSBT validation failed: ${errorMessage}`,
    };
  }
}

/**
 * Get device-specific signing instructions for user
 *
 * @param walletType Hardware wallet type
 * @returns User instructions
 */
export function getHardwareSigningInstructions(walletType: string): string {
  switch (walletType) {
    case WalletType.Ledger:
      return 'Connect your Ledger device, unlock it, and open the Bitcoin app. Follow the prompts on your device to review and approve the transaction.';

    case WalletType.Trezor:
      return 'Connect your Trezor device and unlock it. Follow the prompts on your device to review and approve the transaction.';

    case WalletType.Keystone:
      return 'Scan the QR code with your Keystone device, review and sign the transaction, then scan the signed transaction QR code back to complete.';

    default:
      return 'Connect your hardware wallet and follow the on-screen instructions.';
  }
}
