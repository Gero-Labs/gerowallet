/**
 * GHSA-m39w-wppc-96w9 (a substituted recipient in a Nexus-built send), as its reporter's test C1
 * ran it against v2.7.2.
 * Same local node:http mock Nexus, same addresses and amounts; the only change is the
 * expectation: the wallet's own client refuses the substituted build (nexus-tx-api.ts verifyBuilt).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';

const VICTIM = 'addr1q8l7hny7x96fadvq8cukyqkcfca5xmkrvfrrkt7hp76v3qvssm7fz9ajmtd58ksljgkyvqu6gl23hlcfgv7um5v0rn8qtnzlfk';
const OWN = 'addr1qx42424242424242424242424242424242424242424242kvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxqjhw070';
// The report's attacker string does not pass the bech32 checksum as pasted; rebuilt as its harness
// describes it (payment key hash 'bb' x 28), with the wallet's own stake part.
const ATTACKER = Cardano.BaseAddress.fromCredentials(
  Cardano.NetworkId.Mainnet,
  { type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16('bb'.repeat(28)) },
  Cardano.Address.fromString(OWN)!.asBase()!.getStakeCredential(),
).toAddress().toBech32();
const SEND_LOVELACE = 50_000_000n;

function buildTxCbor(recipient: string, lovelace: bigint): string {
  const coreTx = {
    body: {
      inputs: [{ txId: Cardano.TransactionId('cd'.repeat(32)), index: 0 }],
      outputs: [
        { address: recipient, value: { coins: lovelace } },
        { address: OWN, value: { coins: 949_800_000n } },
      ],
      fee: 200_000n,
    },
    witness: { signatures: new Map() },
    isValid: true,
  } as unknown as Cardano.Tx;
  return Serialization.Transaction.fromCore(coreTx).toCbor();
}

describe('GHSA-m39w-wppc-96w9 C1 against the current client', () => {
  let server: http.Server;
  let answer = '';
  const honestCbor = buildTxCbor(VICTIM, SEND_LOVELACE);
  const swappedCbor = buildTxCbor(ATTACKER, SEND_LOVELACE);

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      req.on('data', () => undefined);
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tx_cbor: answer, tx_hash: 'ab'.repeat(32), estimated_fee: '200000' }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    vi.stubEnv('VITE_NEXUS_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    vi.resetModules();
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    vi.unstubAllEnvs();
  });

  const request = {
    outputs: [{ address: VICTIM, lovelace: SEND_LOVELACE.toString() }],
    changeAddress: OWN,
    utxos: [{ txHash: 'cd'.repeat(32), outputIndex: 0, address: OWN, lovelace: '1000000000' }],
  };

  it('refuses the swapped build before anything can show or sign it', async () => {
    const { nexusTxApi } = await import('@/api/nexus-tx-api');
    const { TxIntentMismatchError } = await import('@/shared/utils/txIntentGuard');
    answer = swappedCbor;
    const error = await nexusTxApi.buildTransferTx(request as never, 'Mainnet').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TxIntentMismatchError);
    expect((error as InstanceType<typeof TxIntentMismatchError>).violations).toContain('foreignOutput');
  });

  it('still returns the honest build', async () => {
    const { nexusTxApi } = await import('@/api/nexus-tx-api');
    answer = honestCbor;
    const response = await nexusTxApi.buildTransferTx(request as never, 'Mainnet');
    expect(response.tx_cbor).toBe(honestCbor);
  });
});
