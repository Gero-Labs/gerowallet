// Keystone and Solana: the pairing request and answer, and the sign request and signature.
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { CryptoHDKey, CryptoKeypath, CryptoMultiAccounts, PathComponent, QRHardwareCall } from '@keystonehq/bc-ur-registry';
import { SolSignature, SolSignRequest } from '@keystonehq/bc-ur-registry-sol';
import { UR, URDecoder } from '@keystonehq/keystone-sdk';

// The Keystone registry is externalized to Node and decodes Node Buffers, while the
// sources get the polyfill. Hand the sources Node's Buffer too (the bundles use one Buffer).
vi.mock('vite-plugin-node-polyfills/shims/buffer', async () => {
  const { createRequire: requireFrom } = await import('node:module');
  const { Buffer } = requireFrom(import.meta.url)('node:buffer');
  return { default: Buffer, Buffer };
});
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn() } }));
vi.mock('@/shared/utils/converter', () => ({}));

import { deriveSolanaKeypairFromMnemonic } from '@/chains/solana/solanaKeyManager';
import { base58Decode } from '@/chains/solana/solanaBase58';
import {
  getKeystoneSolanaAccountsUR, keystoneEd25519Key, keystoneSolanaSignRequest, parseKeystoneSolanaAccounts, parseKeystoneSolanaSignature,
} from './solanaKeystone';
import { InvalidAccountIndexError } from './walletAccount';

const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer');

// Fixed test vector — never used to hold funds.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FINGERPRINT = NodeBuffer.from('73c5da0a', 'hex');
const address = (account: number) => deriveSolanaKeypairFromMnemonic(MNEMONIC, account).address;

/** A Keystone key at m/44'/501'/n'/0' (SLIP-0010 sends 33 bytes, a leading 0x00). */
function solanaKey(account: number, path = [44, 501, account, 0]): CryptoHDKey {
  return new CryptoHDKey({
    isMaster: false,
    key: NodeBuffer.concat([NodeBuffer.from([0]), NodeBuffer.from(base58Decode(address(account)))]),
    origin: new CryptoKeypath(path.map((index) => new PathComponent({ index, hardened: true })), FINGERPRINT),
  });
}

const answer = (...keys: CryptoHDKey[]) => new CryptoMultiAccounts(FINGERPRINT, keys, 'Keystone 3 Pro').toCBOR();

describe('Keystone Solana pairing', () => {
  it('asks for ed25519 SLIP-0010 keys at the Solana account paths', () => {
    const decoded = URDecoder.decode(String(getKeystoneSolanaAccountsUR([0, 2]).data));
    const schemas = (QRHardwareCall.fromCBOR(decoded.cbor).getParams() as unknown as { getSchemas(): Array<{ getKeypath(): { getPath(): string }; getCurve(): number; getAlgo(): number }> }).getSchemas();
    expect(schemas.map((s) => s.getKeypath().getPath())).toEqual(["44'/501'/0'/0'", "44'/501'/2'/0'"]);
    expect(schemas.map((s) => [s.getCurve(), s.getAlgo()])).toEqual([[1, 0], [1, 0]]);
    expect(() => getKeystoneSolanaAccountsUR([])).toThrow(InvalidAccountIndexError);
  });

  it('reads each account by its path, as the address the seed gives', () => {
    const { xfp, accounts } = parseKeystoneSolanaAccounts(answer(solanaKey(1), solanaKey(0)), [0, 1]);
    expect(xfp).toBe('73c5da0a');
    expect(accounts).toEqual([0, 1].map((n) => ({
      accountIndex: n, publicKey: address(n), keys: [{ publicKey: address(n), chainCode: '', path: `m/44'/501'/${n}'/0'` }],
    })));
  });

  it('keeps only the accounts asked for at the Solana path, and refuses an answer with none', () => {
    const { accounts } = parseKeystoneSolanaAccounts(answer(solanaKey(0), solanaKey(5), solanaKey(1, [44, 501, 1])), [0, 1]);
    expect(accounts.map((a) => a.accountIndex)).toEqual([0]);
    expect(() => parseKeystoneSolanaAccounts(answer(solanaKey(3)), [0])).toThrow(InvalidAccountIndexError);
  });

  it('takes a 32-byte key or a 33-byte one with a leading zero, nothing else', () => {
    expect(keystoneEd25519Key(new Uint8Array(32).fill(7))).toHaveLength(32);
    expect(Array.from(keystoneEd25519Key(Uint8Array.of(0, ...new Uint8Array(32).fill(7))))).toEqual(new Array(32).fill(7));
    expect(() => keystoneEd25519Key(Uint8Array.of(2, ...new Uint8Array(32)))).toThrow();
    expect(() => keystoneEd25519Key(new Uint8Array(31))).toThrow();
  });
});

describe('Keystone Solana signing', () => {
  const bytes = Uint8Array.of(1, 2, 3, 4);

  it('asks the account at its path to sign the exact bytes, as a transaction or a message', () => {
    for (const kind of ['transaction', 'message'] as const) {
      const request = keystoneSolanaSignRequest({ bytes, kind, accountIndex: 2, xfp: '73c5da0a', address: address(2) });
      expect(request.type).toBe('sol-sign-request');
      const decoded = SolSignRequest.fromCBOR(NodeBuffer.from(request.cbor, 'hex'));
      expect(decoded.getSignData().toString('hex')).toBe('01020304');
      expect(decoded.getSignType()).toBe(kind === 'transaction' ? 1 : 2);
      expect(decoded.getDerivationPath()).toBe("44'/501'/2'/0'");
      expect(NodeBuffer.from(decoded.getSignRequestAddress()!).toString('hex')).toBe(NodeBuffer.from(base58Decode(address(2))).toString('hex'));
    }
    expect(() => keystoneSolanaSignRequest({ bytes, kind: 'message', accountIndex: 0, xfp: '', address: address(0) })).toThrow();
  });

  it('accepts only the signature that answers this request', () => {
    const request = keystoneSolanaSignRequest({ bytes, kind: 'transaction', accountIndex: 0, xfp: '73c5da0a', address: address(0) });
    const signatureFor = (requestId: string, signature = NodeBuffer.alloc(64, 9)) =>
      new SolSignature(signature, NodeBuffer.from(requestId.replace(/-/g, ''), 'hex')).toUR() as unknown as UR;
    expect(Array.from(parseKeystoneSolanaSignature(signatureFor(request.requestId), request.requestId))).toEqual(new Array(64).fill(9));
    expect(() => parseKeystoneSolanaSignature(signatureFor(crypto.randomUUID()), request.requestId)).toThrow();
    expect(() => parseKeystoneSolanaSignature(signatureFor(request.requestId, NodeBuffer.alloc(63)), request.requestId)).toThrow();
  });
});
