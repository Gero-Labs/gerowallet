// Keystone and Solana over QR codes: pairing (a key-derivation call answered with
// `crypto-multi-accounts`) and signing (`sol-sign-request` answered with `sol-signature`).
//
// Solana keys are SLIP-0010 ed25519 at `m/44'/501'/n'/0'` (solanaPaths.ts), the same path as
// Gero's software Solana wallets, so a Keystone account has the address Phantom and Solflare
// show for that seed.
import { Curve, DerivationAlgorithm, KeystoneSDK, KeystoneSolanaSDK, UR, UREncoder } from '@keystonehq/keystone-sdk';
import { CryptoMultiAccounts } from '@keystonehq/bc-ur-registry';
import type { Options } from 'qr-code-styling/lib/types';
import { base58Decode, base58Encode } from '@/chains/solana/solanaBase58';
import { solanaAccountPath } from '@/chains/solana/solanaPaths';
import { solanaAccountIndexOfPath, solanaDeviceAccount, type SolanaDeviceAccount } from '@/chains/solana/solanaHardwarePolicy';
import { assertAccountIndices, InvalidAccountIndexError } from '@/shared/utils/walletAccount';
import { keystoneFirmwareVersion, qrCodeOptions } from '@/shared/utils/keystone';

const sdk = new KeystoneSDK();

/** The QR that asks a Keystone for the Solana accounts at `accountIndices`, in one scan. */
export function getKeystoneSolanaAccountsUR(accountIndices: number[]): Options {
  const ur: UR = sdk.generateKeyDerivationCall({
    schemas: assertAccountIndices(accountIndices).map((index) => ({
      path: solanaAccountPath(index), curve: Curve.ed25519, algo: DerivationAlgorithm.slip10,
    })),
    origin: 'gerowallet',
  });
  return qrCodeOptions(UREncoder.encodeSinglePart(ur), 190);
}

/**
 * An ed25519 key as a Keystone sends it: 32 bytes, or 33 with a leading 0x00 (the SLIP-0010
 * public key encoding). Anything else is refused.
 */
export function keystoneEd25519Key(key: Uint8Array): Uint8Array {
  if (key.length === 32) return key;
  if (key.length === 33 && key[0] === 0) return key.subarray(1);
  throw new Error('The Keystone returned an unexpected Solana key');
}

/**
 * The Solana accounts in a Keystone `crypto-multi-accounts` answer, by the path each key
 * carries. Only accounts that were asked for are kept, so a device answering with other
 * paths can never add an account the user did not see listed.
 */
export function parseKeystoneSolanaAccounts(cbor: Buffer, accountIndices: number[]): {
  xfp: string;
  accounts: SolanaDeviceAccount[];
  firmwareVersion?: string;
} {
  const multiAccounts = CryptoMultiAccounts.fromCBOR(cbor);
  const wanted = new Set(assertAccountIndices(accountIndices));
  const byIndex = new Map<number, SolanaDeviceAccount>();
  for (const key of multiAccounts.getKeys()) {
    const index = solanaAccountIndexOfPath(key.getOrigin()?.getPath() ?? '');
    if (index === undefined || !wanted.has(index) || byIndex.has(index)) continue;
    byIndex.set(index, solanaDeviceAccount(index, base58Encode(keystoneEd25519Key(new Uint8Array(key.getKey())))));
  }
  const accounts = [...byIndex.values()].sort((a, b) => a.accountIndex - b.accountIndex);
  if (accounts.length === 0) throw new InvalidAccountIndexError('The Keystone did not return the requested accounts');
  const xfp = multiAccounts.getMasterFingerprint().toString('hex');
  const firmwareVersion = keystoneFirmwareVersion(multiAccounts);
  return { xfp, accounts, ...(firmwareVersion && { firmwareVersion }) };
}

export type KeystoneSolanaSignKind = 'transaction' | 'message';

export interface KeystoneSolanaSignRequest {
  /** `ur.type`, for KeystoneSignDialog / KeystoneSignSheet. */
  type: string;
  /** `ur.cbor` as hex. */
  cbor: string;
  requestId: string;
}

/**
 * A `sol-sign-request` for `bytes`: a transaction MESSAGE (what a Solana signature covers), or
 * a dApp message signed as is.
 */
export function keystoneSolanaSignRequest(args: {
  bytes: Uint8Array;
  kind: KeystoneSolanaSignKind;
  accountIndex: number;
  xfp: string;
  address: string;
}): KeystoneSolanaSignRequest {
  if (!/^[0-9a-f]{8}$/i.test(args.xfp)) throw new Error('This Keystone has no recorded fingerprint. Pair it again.');
  const requestId = crypto.randomUUID();
  const ur = sdk.sol.generateSignRequest({
    requestId,
    signData: Buffer.from(args.bytes).toString('hex'),
    dataType: args.kind === 'transaction' ? KeystoneSolanaSDK.DataType.Transaction : KeystoneSolanaSDK.DataType.Message,
    path: solanaAccountPath(args.accountIndex),
    xfp: args.xfp,
    // The SDK takes the address as hex: the 32 key bytes.
    address: Buffer.from(base58Decode(args.address)).toString('hex'),
    origin: 'gerowallet',
  });
  return { type: ur.type, cbor: ur.cbor.toString('hex'), requestId };
}

/** The 64-byte signature in a scanned `sol-signature`, refused unless it answers `requestId`. */
export function parseKeystoneSolanaSignature(ur: UR, requestId: string): Uint8Array {
  if (ur.type !== 'sol-signature') throw new Error('This QR code is not a Solana signature');
  const { signature, requestId: answered } = sdk.sol.parseSignature(ur);
  if (answered !== requestId) throw new Error('This QR code answers another request. Scan the signature for this one.');
  if (!/^[0-9a-f]{128}$/i.test(signature)) throw new Error('The Keystone returned an unexpected signature');
  return new Uint8Array(Buffer.from(signature, 'hex'));
}
