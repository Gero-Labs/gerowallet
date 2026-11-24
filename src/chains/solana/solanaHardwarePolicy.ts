// Which hardware wallets hold Solana accounts in Gero, and what each can sign. Dependency-free:
// the worker, the pairing steps, the Send form and the dApp prompts all read it.
//
// Every device signs at the same path as Gero's software wallets, `m/44'/501'/n'/0'`
// (solanaPaths.ts), so an account shows the same address in Gero, Phantom, Solflare and
// Trezor Suite.
//
// Message signing (dApp `solana:signMessage` and Sign in with Solana) needs a signature over
// the dApp's raw bytes. The Ledger and Trezor Solana apps sign messages only in Solana's
// off-chain message format (a header and a length are signed with the text), which a dApp
// verifying the raw bytes rejects; Keystone signs the bytes themselves. So only Keystone signs
// messages; Ledger and Trezor sign transactions only.
import { WalletType } from '@/models/types';
import { solanaAccountPath } from './solanaPaths';

/** Devices that hold Solana accounts: pairing, Send and dApp transactions. */
export const SOLANA_HARDWARE_WALLET_TYPES: readonly string[] = [WalletType.Ledger, WalletType.Trezor, WalletType.Keystone];

/** Devices that also sign dApp messages and Sign in with Solana (raw bytes). */
export const SOLANA_MESSAGE_SIGNING_HARDWARE: readonly string[] = [WalletType.Keystone];

export function isSolanaHardware(type: string | undefined): boolean {
  return !!type && SOLANA_HARDWARE_WALLET_TYPES.includes(type);
}

export function solanaHardwareSignsMessages(type: string | undefined): boolean {
  return !!type && SOLANA_MESSAGE_SIGNING_HARDWARE.includes(type);
}

/** A Solana account a device exported, in the shape the pairing steps store. */
export interface SolanaDeviceAccount {
  accountIndex: number;
  /** The base58 address (a Solana record's `publicKey`). */
  publicKey: string;
  keys: Array<{ publicKey: string; chainCode: string; path: string }>;
}

/** The account at `accountIndex` with `address`, its path the standard one. */
export function solanaDeviceAccount(accountIndex: number, address: string): SolanaDeviceAccount {
  const path = solanaAccountPath(accountIndex);
  return { accountIndex, publicKey: address, keys: [{ publicKey: address, chainCode: '', path }] };
}

/** The account index of a `m/44'/501'/n'/0'` path (with or without `m/`), or undefined for any other path. */
export function solanaAccountIndexOfPath(path: string): number | undefined {
  const match = /^(?:m\/)?44'\/501'\/(\d{1,10})'\/0'$/.exec(path);
  if (!match) return undefined;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) && index < 0x80000000 ? index : undefined;
}

/** The path a device is asked for, without the `m/` some libraries refuse. */
export function solanaDevicePath(accountIndex: number): string {
  return solanaAccountPath(accountIndex).slice(2);
}
