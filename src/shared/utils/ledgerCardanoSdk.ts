import { Cardano } from '@cardano-sdk/core';
import hardwareLoading from '@/plugins/hardwareLoading';
import snackbar from '@/plugins/snackbar';
import { LedgerKeyAgent } from '@cardano-sdk/hardware-ledger';
import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import BluetoothTransport from '@ledgerhq/hw-transport-web-ble';

/**
 * Ledger helper functions for Cardano JS SDK transactions
 * This module provides Ledger hardware wallet integration without using CSL
 */

interface LedgerSigningOptions {
  tx: Cardano.Tx;
  accountIndex: number;
  isUsb: boolean;
  addresses: any;
  knownAddresses?: Cardano.PaymentAddress[];
}

/**
 * Connect to a Ledger device via USB
 */
async function connectViaUSB(): Promise<any> {
  try {
    hardwareLoading.setText('Connecting to Ledger via USB...');

    const transport = await TransportWebUSB.create();
    if (!transport) {
      throw new Error('Failed to connect to Ledger device via USB');
    }
    return transport;
  } catch (error) {
    console.error('USB connection failed:', error);
    throw new Error('Failed to connect to Ledger. Please ensure your device is connected and unlocked.');
  }
}

/**
 * Connect to a Ledger device via Bluetooth
 */
async function connectViaBluetooth(): Promise<any> {
  try {
    hardwareLoading.setText('Connecting to Ledger via Bluetooth...');
    const transport = await BluetoothTransport.create();
    if (!transport) {
      throw new Error('Failed to connect to Ledger device via Bluetooth');
    }
    return transport;
  } catch (error) {
    console.error('Bluetooth connection failed:', error);
    throw new Error('Failed to connect to Ledger via Bluetooth. Please ensure Bluetooth is enabled and your device is paired.');
  }
}

/**
 * Create LedgerKeyAgent for signing transactions
 */
async function createLedgerKeyAgent(
  transport: any,
  accountIndex: number,
  networkId: Cardano.NetworkId
): Promise<any> {
  try {
    hardwareLoading.setText('Initializing Ledger Key Agent...');

    // Create the LedgerKeyAgent with the transport
    return await LedgerKeyAgent.createWithDevice(
      {
        accountIndex,
        chainId: networkId === Cardano.NetworkId.Mainnet ? Cardano.ChainIds.Mainnet : Cardano.ChainIds.Preprod,
        communicationType: 'Node' as any // Use Node type for browser environments
      },
      transport
    );;
  } catch (error) {
    console.error('Failed to create LedgerKeyAgent:', error);
    throw new Error('Failed to initialize Ledger signing agent. Please ensure the Cardano app is open on your device.');
  }
}

/**
 * Sign a Cardano JS SDK transaction with Ledger
 */
export async function signTransactionWithLedger(options: LedgerSigningOptions): Promise<Cardano.Witness> {
  let transport: any | null = null;

  try {
    hardwareLoading.setLoading(true);

    // Connect to a Ledger device
    transport = options.isUsb
      ? await connectViaUSB()
      : await connectViaBluetooth();

    // Get network ID (1 for mainnet, 0 for testnet/preprod)
    const networkId = Cardano.NetworkId.Mainnet; // TODO: Get from wallet context

    // Create LedgerKeyAgent
    const keyAgent = await createLedgerKeyAgent(
      transport,
      options.accountIndex,
      networkId
    );

    hardwareLoading.setText('Signing transaction with Ledger...');

    // Sign the transaction
    // The LedgerKeyAgent will handle the communication with the device
    const witness = await keyAgent.signTransaction(
      options.tx,
      {
        knownAddresses: options.knownAddresses || [],
        txInKeyPathMap: new Map() // TODO: Build proper key path map from UTXOs
      }
    );

    hardwareLoading.setLoading(false);
    snackbar.fireSuccess('Transaction signed successfully with Ledger');

    return witness;
  } catch (error) {
    hardwareLoading.setLoading(false);
    console.error('Ledger signing error:', error);

    if (error instanceof Error) {
      if (error.message.includes('denied')) {
        throw new Error('Transaction rejected on Ledger device');
      } else if (error.message.includes('locked')) {
        throw new Error('Ledger device is locked. Please unlock and try again.');
      } else if (error.message.includes('app')) {
        throw new Error('Please open the Cardano app on your Ledger device');
      }
    }

    throw new Error(`Ledger signing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    // Clean up transport connection
    if (transport) {
      try {
        await transport.close();
      } catch (e) {
        console.error('Error closing transport:', e);
      }
    }
  }
}

/**
 * Build transaction witness from Ledger signature
 */
export function buildWitnessFromLedger(
  witness: Cardano.Witness
): string {
  try {
    // The witness from LedgerKeyAgent is already in the correct format
    // We just need to serialize it for submission
    if (typeof witness === 'string') {
      return witness;
    }
    return witness.signatures ? JSON.stringify(witness) : witness.toString();
  } catch (error) {
    console.error('Failed to build witness from Ledger:', error);
    throw new Error('Failed to process Ledger signature');
  }
}

/**
 * Get extended public key from Ledger for wallet initialization
 * This is used when pairing a new Ledger wallet
 */
export async function getLedgerExtendedPublicKey(
  isUsb: boolean,
  accountIndex: number = 0
): Promise<{ publicKey: string; chainCode: string }> {
  let transport: any | null = null;

  try {
    hardwareLoading.setLoading(true);
    hardwareLoading.setText('Please unlock your Ledger and open the Cardano app...');

    // Connect to device
    transport = isUsb
      ? await connectViaUSB()
      : await connectViaBluetooth();

    // Create a temporary key agent to get public key
    const networkId = Cardano.NetworkId.Mainnet; // Network doesn't matter for public key
    const keyAgent = await createLedgerKeyAgent(transport, accountIndex, networkId);

    // Get the extended public key
    hardwareLoading.setText('Retrieving public key from Ledger...');

    // The key agent should have the extended public key
    // This is a simplified approach - in practice you might need to use
    // the underlying Ledger API directly for this operation
    const extendedAccountPublicKey = await keyAgent.getExtendedAccountPublicKey();

    hardwareLoading.setLoading(false);

    return {
      publicKey: extendedAccountPublicKey.toString(),
      chainCode: '' // Chain code might need to be extracted separately
    };
  } catch (error) {
    hardwareLoading.setLoading(false);
    console.error('Failed to get Ledger public key:', error);
    throw new Error('Failed to retrieve public key from Ledger device');
  } finally {
    if (transport) {
      try {
        await transport.close();
      } catch (e) {
        console.error('Error closing transport:', e);
      }
    }
  }
}

/**
 * Check if a Ledger device is available and the Cardano app is open
 */
export async function checkLedgerConnection(isUsb: boolean): Promise<boolean> {
  let transport: any | null = null;

  try {
    transport = isUsb
      ? await connectViaUSB()
      : await connectViaBluetooth();

    // If we can create transport, device is connected
    // Further checks could be added here to verify Cardano app is open

    return true;
  } catch (error) {
    return false;
  } finally {
    if (transport) {
      try {
        await transport.close();
      } catch (e) {
        console.error('Error closing transport:', e);
      }
    }
  }
}
