import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { DUST_MAPPING_VALIDATOR } from '@/shared/utils/dustMappingValidator';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('axios', () => {
  const instance = { post, interceptors: { request: { use: () => undefined }, response: { use: () => undefined } } };
  return {
    default: { create: () => instance, isAxiosError: () => false },
    AxiosError: class AxiosError extends Error {},
  };
});
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/services/nexusDevice.service', () => ({ getNexusAccessToken: vi.fn(), reauthenticateNexus: vi.fn() }));

const { MidnightApi } = await import('./midnight-api');

const NETWORK = 'Preprod';
const VALIDATOR = DUST_MAPPING_VALIDATOR[NETWORK].address;
const net = Cardano.NetworkId.Testnet;
const keyCred = (c: string) => ({ type: Cardano.CredentialType.KeyHash, hash: c.repeat(56) as Cardano.Credential['hash'] });
const OWN = Cardano.BaseAddress.fromCredentials(net, keyCred('a'), keyCred('b')).toAddress().toBech32();
const ATTACKER = Cardano.BaseAddress.fromCredentials(net, keyCred('f'), keyCred('f')).toAddress().toBech32();
const DUST = '01' + 'c'.repeat(64);
const NFT = `${'7'.repeat(56)}6d6170` as Cardano.AssetId;
const TX = '9'.repeat(64);

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const datum = (dustHex: string): Cardano.PlutusData => ({
  constructor: 0n,
  fields: { items: [{ constructor: 0n, fields: { items: [bytes('b'.repeat(56))] } }, bytes(dustHex)] },
});
const out = (address: string, coins: bigint, extra: Partial<Cardano.TxOut> = {}): Cardano.TxOut =>
  ({ address: address as Cardano.PaymentAddress, value: { coins }, ...extra });

/** Real registration CBOR, as Nexus returns it. */
function registrationCbor(outputs: Cardano.TxOut[]): string {
  const core = {
    id: TX,
    body: {
      inputs: [{ txId: TX, index: 0 }],
      outputs,
      fee: 300_000n,
      mint: new Map([[NFT, 1n]]),
      requiredExtraSignatures: ['a'.repeat(56), 'b'.repeat(56)],
    },
    witness: { signatures: new Map() },
  } as unknown as Cardano.Tx;
  return Serialization.Transaction.fromCore(core).toCbor();
}
const mapping = (dustHex: string) =>
  out(VALIDATOR, 1_500_000n, { value: { coins: 1_500_000n, assets: new Map([[NFT, 1n]]) }, datum: datum(dustHex) });
const nexusReturns = (txCbor: string) => post.mockResolvedValueOnce({
  status: 200,
  data: {
    status: 'complete', tx_cbor: txCbor, tx_hash: TX, validator_address: VALIDATOR,
    validator_script_hash: DUST_MAPPING_VALIDATOR[NETWORK].scriptHash, datum_cbor: '', redeemer_cbor: '', mint_asset: null,
  },
});

describe('MidnightApi refuses a DUST mapping transaction that differs from the request', () => {
  beforeEach(() => {
    post.mockReset();
    // Koios (the registration-UTxO proof's fallback) is offline in these tests.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  });
  const api = new MidnightApi(NETWORK);
  const request = { cardanoAddress: OWN, paymentKeyHashHex: 'a'.repeat(56), dustAddressHex: DUST };

  it('returns a registration that is exactly what was asked for', async () => {
    const txCbor = registrationCbor([mapping(DUST), out(OWN, 97_000_000n)]);
    nexusReturns(txCbor);
    await expect(api.buildDustRegistrationTx(request)).resolves.toMatchObject({ txCbor });
  });

  it('refuses a registration that also pays someone else', async () => {
    nexusReturns(registrationCbor([mapping(DUST), out(ATTACKER, 90_000_000n), out(OWN, 7_000_000n)]));
    await expect(api.buildDustRegistrationTx(request))
      .rejects.toMatchObject({ name: 'TxIntentMismatchError', message: 'txGuard.builtTxMismatch', violations: ['foreignOutput'] });
  });

  it('refuses a registration that sends the DUST to another address', async () => {
    nexusReturns(registrationCbor([mapping('01' + 'e'.repeat(64)), out(OWN, 97_000_000n)]));
    await expect(api.buildDustRegistrationTx(request)).rejects.toMatchObject({ name: 'TxIntentMismatchError' });
  });

  it('refuses an update that does not spend the registration it names', async () => {
    nexusReturns(registrationCbor([mapping(DUST), out(OWN, 97_000_000n)]));
    await expect(api.buildDustUpdateTx({
      cardanoAddress: OWN, registrationUtxoTxHash: '8'.repeat(64), registrationUtxoOutputIndex: 0, dustAddressHex: DUST,
    })).rejects.toMatchObject({ name: 'TxIntentMismatchError' });
  });

  it('refuses CBOR it cannot decode', async () => {
    nexusReturns('deadbeef');
    await expect(api.buildDustRegistrationTx(request)).rejects.toMatchObject({ name: 'TxIntentMismatchError' });
  });
});

describe('MidnightApi pins the mapping NFT of the registration being spent', () => {
  const OTHER_NFT = `${'6'.repeat(56)}6d6170` as Cardano.AssetId;
  /** The real transaction that created the registration UTxO: the mapping NFT at the validator. */
  const registrationTx = (() => {
    const core = {
      id: TX,
      body: {
        inputs: [{ txId: '5'.repeat(64), index: 0 }],
        outputs: [mapping(DUST), out(OWN, 97_000_000n)],
        fee: 300_000n,
        mint: new Map([[NFT, 1n]]),
      },
      witness: { signatures: new Map() },
    } as unknown as Cardano.Tx;
    const tx = Serialization.Transaction.fromCore(core);
    return { cbor: tx.toCbor(), hash: String(tx.getId()) };
  })();
  const proofSources = [async () => new Map([[registrationTx.hash, registrationTx.cbor]])];
  const manage = { cardanoAddress: OWN, registrationUtxoTxHash: registrationTx.hash, registrationUtxoOutputIndex: 0 };
  const manageCbor = (body: Partial<Cardano.TxBody>) => Serialization.Transaction.fromCore({
    id: TX,
    body: { inputs: [{ txId: registrationTx.hash, index: 0 }], outputs: [], fee: 300_000n, ...body },
    witness: { signatures: new Map() },
  } as unknown as Cardano.Tx).toCbor();
  const api = new MidnightApi(NETWORK);

  beforeEach(() => {
    post.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  });

  it('accepts a deregistration that burns the registration\'s NFT', async () => {
    nexusReturns(manageCbor({ outputs: [out(OWN, 98_000_000n)], mint: new Map([[NFT, -1n]]) }));
    await expect(api.buildDustDeregistrationTx(manage, { proofSources })).resolves.toBeTruthy();
  });

  it('refuses a deregistration that burns some other token', async () => {
    nexusReturns(manageCbor({ outputs: [out(OWN, 98_000_000n)], mint: new Map([[OTHER_NFT, -1n]]) }));
    await expect(api.buildDustDeregistrationTx(manage, { proofSources })).rejects.toMatchObject({ name: 'TxIntentMismatchError' });
  });

  it('refuses an update that re-locks a different token at the validator', async () => {
    const wrong = out(VALIDATOR, 1_500_000n, { value: { coins: 1_500_000n, assets: new Map([[OTHER_NFT, 1n]]) }, datum: datum(DUST) });
    nexusReturns(manageCbor({ outputs: [wrong, out(OWN, 97_000_000n)] }));
    await expect(api.buildDustUpdateTx({ ...manage, dustAddressHex: DUST }, { proofSources }))
      .rejects.toMatchObject({ name: 'TxIntentMismatchError' });
    nexusReturns(manageCbor({ outputs: [mapping(DUST), out(OWN, 97_000_000n)] }));
    await expect(api.buildDustUpdateTx({ ...manage, dustAddressHex: DUST }, { proofSources })).resolves.toBeTruthy();
  });

  it('falls back to the one-unit rule when the registration cannot be proven', async () => {
    nexusReturns(manageCbor({ outputs: [out(OWN, 98_000_000n)], mint: new Map([[OTHER_NFT, -1n]]) }));
    await expect(api.buildDustDeregistrationTx(manage)).resolves.toBeTruthy();
  });
});
