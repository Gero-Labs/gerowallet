import { describe, it, expect } from 'vitest';
import type { Cardano } from '@cardano-sdk/core';
import { assembleWitnesses } from './usePoolSigning';

describe('assembleWitnesses', () => {
  it('merges 3 vkey witnesses (owner + operator + fee) into one signatures map', () => {
    const owner = new Map([['ownerVkey', 'ownerSig']]) as Cardano.Signatures;
    const cold = { vkey: 'coldVkey', signature: 'coldSig' };
    const fee = { vkey: 'feeVkey', signature: 'feeSig' };
    const sigs = assembleWitnesses(owner, cold, fee);
    expect(sigs.size).toBe(3);
    expect(sigs.get('coldVkey' as Cardano.Ed25519PublicKeyHex)).toBe('coldSig');
    expect(sigs.get('feeVkey' as Cardano.Ed25519PublicKeyHex)).toBe('feeSig');
    expect(sigs.get('ownerVkey' as Cardano.Ed25519PublicKeyHex)).toBe('ownerSig');
  });

  it('does not mutate the owner signatures map passed in', () => {
    const owner = new Map([['ownerVkey', 'ownerSig']]) as Cardano.Signatures;
    const cold = { vkey: 'coldVkey', signature: 'coldSig' };
    const fee = { vkey: 'feeVkey', signature: 'feeSig' };
    assembleWitnesses(owner, cold, fee);
    expect(owner.size).toBe(1);
  });
});
