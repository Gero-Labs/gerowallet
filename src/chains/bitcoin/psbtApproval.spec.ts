import { describe, expect, it } from 'vitest';
import { Psbt } from 'bitcoinjs-lib';
import { assertApprovedPsbt } from './psbtApproval';
import { createRequire } from 'node:module';

// bitcoinjs-lib is externalized to Node by Vitest; its Buffer identity is native.
const { Buffer: NodeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof import('node:buffer');

function transaction(value = 1000, locktime = 0, sequence = 0xfffffffe) {
  return new Psbt().setLocktime(locktime)
    .addInput({ hash: '01'.repeat(32), index: 0, sequence })
    .addOutput({ script: NodeBuffer.from('0014' + '02'.repeat(20), 'hex'), value });
}

describe('device PSBT approval binding', () => {
  it('accepts the same transaction with additional PSBT metadata in hex or base64', () => {
    const request = transaction();
    const returned = request.clone().updateInput(0, { witnessUtxo: { script: NodeBuffer.from('0014' + '03'.repeat(20), 'hex'), value: 2000 } });
    expect(() => assertApprovedPsbt(request.toHex(), returned.toHex())).not.toThrow();
    expect(() => assertApprovedPsbt(request.toBase64(), returned.toHex())).not.toThrow();
  });

  it.each([
    ['output amount', () => transaction(999)],
    ['lock time', () => transaction(1000, 1)],
    ['input sequence', () => transaction(1000, 0, 0xffffffff)],
    ['input outpoint', () => new Psbt().addInput({ hash: '04'.repeat(32), index: 0 }).addOutput({ script: NodeBuffer.from('6a', 'hex'), value: 0 })],
  ] as const)('rejects a stale response with a different %s', (_name, changed) => {
    expect(() => assertApprovedPsbt(transaction().toHex(), changed().toHex())).toThrow('does not match');
  });
});
