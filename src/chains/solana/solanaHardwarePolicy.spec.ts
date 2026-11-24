// Which devices hold Solana accounts, what each signs, and the one path they sign at.
import { describe, expect, it } from 'vitest';
import { WalletType } from '@/models/types';
import {
  isSolanaHardware, solanaAccountIndexOfPath, solanaDeviceAccount, solanaDevicePath, solanaHardwareSignsMessages,
} from './solanaHardwarePolicy';

describe('Solana hardware policy', () => {
  it('pairs Ledger, Trezor and Keystone; only Keystone signs dApp messages', () => {
    for (const type of [WalletType.Ledger, WalletType.Trezor, WalletType.Keystone]) expect(isSolanaHardware(type)).toBe(true);
    for (const type of [WalletType.Normal, WalletType.Watch, WalletType.Google, undefined]) expect(isSolanaHardware(type)).toBe(false);
    expect(solanaHardwareSignsMessages(WalletType.Keystone)).toBe(true);
    expect(solanaHardwareSignsMessages(WalletType.Ledger)).toBe(false);
    expect(solanaHardwareSignsMessages(WalletType.Trezor)).toBe(false);
    expect(solanaHardwareSignsMessages(WalletType.Normal)).toBe(false);
  });

  it('uses the software wallets’ path, m/44\'/501\'/n\'/0\'', () => {
    expect(solanaDevicePath(3)).toBe("44'/501'/3'/0'");
    expect(solanaDeviceAccount(3, 'addr')).toEqual({
      accountIndex: 3, publicKey: 'addr', keys: [{ publicKey: 'addr', chainCode: '', path: "m/44'/501'/3'/0'" }],
    });
  });

  it('reads the account from that path only', () => {
    expect(solanaAccountIndexOfPath("m/44'/501'/7'/0'")).toBe(7);
    expect(solanaAccountIndexOfPath("44'/501'/0'/0'")).toBe(0);
    for (const path of ["44'/501'/1'", "44'/501'/1'/0'/0'", "44'/1815'/1'/0'", "44'/501'/1/0'", "44'/501'/2147483648'/0'", '']) {
      expect(solanaAccountIndexOfPath(path)).toBeUndefined();
    }
  });
});
