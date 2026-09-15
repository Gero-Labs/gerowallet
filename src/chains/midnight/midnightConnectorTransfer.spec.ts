// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bech32m } from 'bech32';
import { UnshieldedAddress } from 'midnight-v9-address-format';
import { syncedMidnightShieldedBalances, validateMidnightConnectorTransfer } from './midnightConnectorTransfer';

function output(network = 'stagenet') {
  return {
    kind: 'unshielded', type: 'aB'.repeat(32), value: '12345678901234567890',
    recipient: UnshieldedAddress.codec.encode(network, new UnshieldedAddress(Buffer.alloc(32, 1))).toString(),
  };
}

describe('Midnight connector public-token transfer validation', () => {
  it.each(['Mainnet', 'Preprod', 'Stagenet'])('accepts real SDK %s public addresses and preserves exact custom-token units', network => {
    const input = output(network.toLowerCase());
    expect(validateMidnightConnectorTransfer({ desiredOutputs: [input] }, network)).toEqual({
      ok: true, outputs: [{ ...input, type: 'ab'.repeat(32) }],
    });
  });
  it.each([undefined, '', '00'.repeat(32)])('preserves native NIGHT compatibility %#', type => {
    const result = validateMidnightConnectorTransfer({ desiredOutputs: [{ ...output(), type }] }, 'Stagenet');
    expect(result).toMatchObject({ ok: true, outputs: [{ type: '00'.repeat(32) }] });
  });
  it.each(['0', '-1', '1.5', '0x20', ' 1 ', true, 42, '9'.repeat(81)])('rejects malformed or unbounded amounts %# before approval', value => {
    expect(validateMidnightConnectorTransfer({ desiredOutputs: [{ ...output(), value }] }, 'Stagenet').ok).toBe(false);
  });
  it.each(['nothex', 'a'.repeat(63), '0'.repeat(65), '__proto__', false])('rejects invalid token colors %#', type => {
    expect(validateMidnightConnectorTransfer({ desiredOutputs: [{ ...output(), type }] }, 'Stagenet').ok).toBe(false);
  });
  it('rejects wrong networks, tampered checksums, shielded HRPs and truncated payloads', () => {
    const valid = output();
    const tampered = valid.recipient.slice(0, -1) + (valid.recipient.endsWith('q') ? 'p' : 'q');
    for (const recipient of [output('preprod').recipient, tampered,
      bech32m.encode('mn_shield-addr_stagenet', bech32m.toWords(Buffer.alloc(64)), 1024),
      bech32m.encode('mn_addr_stagenet', bech32m.toWords(Buffer.alloc(31)), 1024)]) {
      expect(validateMidnightConnectorTransfer({ desiredOutputs: [{ ...valid, recipient }] }, 'Stagenet').ok).toBe(false);
    }
  });
  it('keeps mixed/private outputs and unsupported fee delegation outside this contract', () => {
    expect(validateMidnightConnectorTransfer({ desiredOutputs: [output(), { ...output(), kind: 'shielded' }] }, 'Stagenet').ok).toBe(false);
    expect(validateMidnightConnectorTransfer({ desiredOutputs: [output()], options: { payFees: false } }, 'Stagenet').ok).toBe(false);
    expect(validateMidnightConnectorTransfer({ desiredOutputs: Array.from({ length: 101 }, () => output()) }, 'Stagenet').ok).toBe(false);
  });
});

describe('Midnight connector private balance reads', () => {
  it.each(['idle', 'syncing', 'error'])('rejects %s even when cached balances exist', status => {
    expect(() => syncedMidnightShieldedBalances(status, { ['aa'.repeat(32)]: 10n })).toThrow('not synchronized');
  });
  it('distinguishes a fully synced empty wallet from unknown state', () => {
    expect(syncedMidnightShieldedBalances('synced')).toEqual({});
    expect(syncedMidnightShieldedBalances('synced', { ['aa'.repeat(32)]: 12345678901234567890n })).toEqual({
      ['aa'.repeat(32)]: '12345678901234567890',
    });
  });
});
