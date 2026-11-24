// Ledger's Solana app: export accounts and sign a transaction message. Page-side, over the same
// cached transport as Gero's other Ledger calls (ledger.ts), so the user picks USB or Bluetooth
// once. The Solana app must be open on the device.
import Solana from '@ledgerhq/hw-app-solana';
import type Transport from '@ledgerhq/hw-transport';
import ledger from '@/shared/utils/ledger';
import hardwareLoading from '@/plugins/hardwareLoading';
import i18n from '@/plugins/i18n';
import { base58Encode } from '@/chains/solana/solanaBase58';
import { assertAccountIndices } from '@/shared/utils/walletAccount';
import { solanaDeviceAccount, solanaDevicePath, type SolanaDeviceAccount } from '@/chains/solana/solanaHardwarePolicy';

async function solanaApp(isBluetooth: boolean): Promise<{ app: Solana; transport: Transport }> {
  const transport: Transport = isBluetooth ? await ledger.connectViaBT() : await ledger.connectViaUSB();
  return { app: new Solana(transport), transport };
}

/** The Solana app answers getAppConfiguration only when it is the open app. */
async function assertSolanaAppOpen(app: Solana): Promise<void> {
  try {
    await app.getAppConfiguration();
  } catch {
    throw new Error(i18n.t('solana.hardware.ledgerOpenApp') as string);
  }
}

/** The accounts at `accountIndices`, one device confirmation each is not needed (no display). */
export async function getLedgerSolanaAccounts(isBluetooth: boolean, accountIndices: number[]): Promise<{
  productName: string;
  btSupported: boolean;
  accounts: SolanaDeviceAccount[];
}> {
  const indices = assertAccountIndices(accountIndices);
  const { app, transport } = await solanaApp(isBluetooth);
  await assertSolanaAppOpen(app);
  hardwareLoading.setText(i18n.t('solana.hardware.readingAccounts') as string);
  const accounts: SolanaDeviceAccount[] = [];
  for (const index of indices) {
    const { address } = await app.getAddress(solanaDevicePath(index), false);
    if (address.length !== 32) throw new Error('The Ledger returned an unexpected Solana key');
    accounts.push(solanaDeviceAccount(index, base58Encode(new Uint8Array(address))));
  }
  return { productName: transport.deviceModel?.productName ?? 'Ledger', btSupported: !!transport.deviceModel?.bluetoothSpec, accounts };
}

/** The ed25519 signature of a transaction message by the account at `accountIndex` (64 bytes). */
export async function signSolanaWithLedger(isBluetooth: boolean, accountIndex: number, message: Uint8Array): Promise<Uint8Array> {
  const { app } = await solanaApp(isBluetooth);
  await assertSolanaAppOpen(app);
  hardwareLoading.setText(i18n.t('solana.hardware.confirmOnDevice') as string);
  const { signature } = await app.signTransaction(solanaDevicePath(accountIndex), Buffer.from(message));
  if (signature.length !== 64) throw new Error('The Ledger returned an unexpected signature');
  return new Uint8Array(signature);
}
