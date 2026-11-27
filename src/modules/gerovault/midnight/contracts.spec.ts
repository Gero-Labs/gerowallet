// The Midnight vault contracts: the network gate, the statement table against the freeze's own
// vectors (computed with the vendored contract), the expiry bounds, the vault id and the message
// types the background registers.
import { describe, expect, it } from 'vitest';
import vectors from '@/chains/midnight/vault/build/vectors.json';
import { MIDNIGHT_VAULT_BUILDS, loadMidnightVaultContract } from '@/chains/midnight/vault/build';
import { MessageTypes } from '@/models/MessageTypes';
import { EXTENSION_PAGE_ONLY_METHODS, CONTENT_SCRIPT_OPTIONS_METHODS } from '@/chrome/senderTrust';
import {
  GEROVAULT_MIDNIGHT_NETWORKS,
  JUBJUB_IDENTITY_HEX,
  MIDNIGHT_DELEGATE_PAYOUT_DOMAIN,
  MIDNIGHT_REQUEST_KINDS,
  MIDNIGHT_REQUEST_KIND_INFO,
  MIDNIGHT_VAULT_MESSAGE_TYPES,
  isGeroVaultMidnightNetwork,
  midnightVaultId,
  midnightVaultNetworkOf,
} from './contracts';

const bytes = (value: string): Uint8Array => Uint8Array.from(value.match(/../g)!.map(pair => Number.parseInt(pair, 16)));
const padded = (value: string): Uint8Array => {
  const encoded = new TextEncoder().encode(value);
  expect(encoded.length).toBeLessThanOrEqual(32);
  const out = new Uint8Array(32);
  out.set(encoded);
  return out;
};

describe('the network gate', () => {
  it('opens preprod only', () => {
    expect(GEROVAULT_MIDNIGHT_NETWORKS).toEqual(['preprod']);
    expect(['Preprod', 'preprod', 'midnight-preprod'].map(isGeroVaultMidnightNetwork)).toEqual([true, true, true]);
    expect(['Mainnet', 'Preview', 'midnight-mainnet', '', undefined, 7].map(isGeroVaultMidnightNetwork)).toEqual([false, false, false, false, false, false]);
  });

  it('reads a wallet network field as a vault network', () => {
    expect(midnightVaultNetworkOf('Mainnet')).toBe('mainnet');
    expect(midnightVaultNetworkOf(' midnight-Preview ')).toBe('preview');
    expect(midnightVaultNetworkOf('Testnet')).toBeUndefined();
    expect(midnightVaultNetworkOf(null)).toBeUndefined();
  });
});

describe('the statement table', () => {
  const statements = vectors.statementDigests as readonly { kind: string; inputs: Record<string, string | number>; value: string }[];

  it('has one entry per request kind, every statement kind of the freeze among them', () => {
    expect(Object.keys(MIDNIGHT_REQUEST_KIND_INFO).sort()).toEqual([...MIDNIGHT_REQUEST_KINDS].sort());
    const domains = Object.values(MIDNIGHT_REQUEST_KIND_INFO).map(info => info.domain).filter(Boolean);
    expect([...domains, MIDNIGHT_DELEGATE_PAYOUT_DOMAIN].sort()).toEqual(statements.map(s => `midnight-vault:${s.kind}`).sort());
  });

  it.each(['test', 'production'] as const)('gives the domains that reproduce every owner and guardian statement vector (%s build)', async profile => {
    const contract = await loadMidnightVaultContract(MIDNIGHT_VAULT_BUILDS[profile].buildId);
    const owned = Object.values(MIDNIGHT_REQUEST_KIND_INFO).filter(info => info.domain && info.circuit !== 'execute');
    expect(owned).toHaveLength(10);
    for (const info of owned) {
      const vector = statements.find(s => `midnight-vault:${s.kind}` === info.domain)!;
      const { vault, network, nonce, expiry, subject } = vector.inputs;
      const digest = contract.pureCircuits.ownerStatementDigest(
        padded(info.domain!),
        { bytes: bytes(String(vault)) },
        padded(String(network)),
        BigInt(nonce),
        BigInt(expiry),
        BigInt(subject),
      );
      expect(digest, info.domain!).toBe(BigInt(vector.value));
    }
  });

  it('signs the recovery nonce for the bound cancel and for guardian statements, the owner nonce otherwise', () => {
    const byNonce = (nonce: string) => MIDNIGHT_REQUEST_KINDS.filter(kind => MIDNIGHT_REQUEST_KIND_INFO[kind].nonce === nonce);
    expect(byNonce('recovery')).toEqual(['cancel-recovery', 'propose-recovery', 'withdraw-recovery']);
    expect(byNonce('committee')).toEqual(['maintenance']);
    expect(MIDNIGHT_REQUEST_KINDS.filter(kind => MIDNIGHT_REQUEST_KIND_INFO[kind].signers === 'guardians')).toEqual(['propose-recovery', 'withdraw-recovery']);
  });

  it('bounds expiry: owners 7 days (48 h by default), guardians 30 days (7 days), cancels 48 hours', () => {
    const DAY = 86_400;
    for (const kind of MIDNIGHT_REQUEST_KINDS) {
      const { maxExpirySeconds, defaultExpirySeconds, signers } = MIDNIGHT_REQUEST_KIND_INFO[kind];
      const expected = signers === 'guardians' ? [30 * DAY, 7 * DAY] : kind.startsWith('cancel-') ? [2 * DAY, 2 * DAY] : [7 * DAY, 2 * DAY];
      expect([maxExpirySeconds, defaultExpirySeconds], kind).toEqual(expected);
    }
  });

  it('shows the request code on guardian, recovery and guardian-change statements only', () => {
    expect(MIDNIGHT_REQUEST_KINDS.filter(kind => MIDNIGHT_REQUEST_KIND_INFO[kind].requestCode)).toEqual(
      ['propose-guardians', 'cancel-guardians', 'cancel-recovery', 'propose-recovery', 'withdraw-recovery'],
    );
  });
});

describe('encodings', () => {
  it('spells the identity point as x = 0, y = 1, little-endian', () => {
    const point = bytes(JUBJUB_IDENTITY_HEX);
    expect(point).toHaveLength(64);
    expect(point.slice(0, 32).every(b => b === 0)).toBe(true);
    expect(point[32]).toBe(1);
    expect(point.slice(33).every(b => b === 0)).toBe(true);
  });

  it('derives the vault id from the network id and the contract address', () => {
    const address = '22'.repeat(32);
    expect(midnightVaultId('preprod', address)).toBe('3aa9521c1181b2d9c62f77ad836c9353916fd7a962c38bbe8ba1c1b2b73820a9');
    expect(midnightVaultId('mainnet', address)).toBe('4a4070a8b4f0568dfc536a4b92e276f53ad6788f4455214c16170a3817cac0d7');
    expect(() => midnightVaultId('preprod', 'AB'.repeat(32))).toThrow(TypeError);
    expect(() => midnightVaultId('preprod', address.slice(2))).toThrow(TypeError);
    expect(() => midnightVaultId('Preprod' as never, address)).toThrow(TypeError);
  });
});

describe('background messages', () => {
  it('are message types the background can register, and extension pages alone may send', () => {
    for (const type of MIDNIGHT_VAULT_MESSAGE_TYPES) {
      expect((MessageTypes as Record<string, string>)[type]).toBe(type);
      expect(EXTENSION_PAGE_ONLY_METHODS.has(type)).toBe(true);
      expect(CONTENT_SCRIPT_OPTIONS_METHODS.has(type)).toBe(false);
    }
  });
});
