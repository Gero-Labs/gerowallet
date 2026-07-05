// src/services/agent/decodeSwapTx.spec.ts
import { describe, it, expect } from 'vitest';
import { toDecodedTx } from './decodeSwapTx';

// Real Cardano AssetId = policyId (56 hex chars) + assetNameHex.
// 'GERO0000...' padded to 56 chars acts as the policyId; '4745524f' is assetName hex.
const POLICY_GERO = '4745524f47455247455247455247455247455247455247455247455247455247'.slice(0, 56); // 56 chars
const ASSET_NAME = '4745524f'; // hex for 'GERO'
const ASSET_ID_RAW = `${POLICY_GERO}${ASSET_NAME}`; // concatenated, no separator (Cardano.AssetId format)
const ASSET_ID_DOT = `${POLICY_GERO}.${ASSET_NAME}`; // dot-key format the Guardrail expects

describe('toDecodedTx', () => {
  it('maps Cardano.Tx outputs to DecodedTx (address, lovelace, assets)', () => {
    const assets = new Map<string, bigint>([[ASSET_ID_RAW, 900n]]);
    const cardanoTx = {
      body: {
        outputs: [
          { address: 'addr_own', value: { coins: 2_000000n, assets } },
          { address: 'addr_foreign', value: { coins: 100_000000n, assets: undefined } },
        ],
      },
    };
    const decoded = toDecodedTx(cardanoTx as never, (id: string) => `${id.slice(0, 56)}.${id.slice(56)}`);
    expect(decoded.outputs[0].address).toBe('addr_own');
    expect(decoded.outputs[0].lovelace).toBe(2_000000n);
    expect(decoded.outputs[0].assets[ASSET_ID_DOT]).toBe(900n);
    expect(decoded.outputs[1].lovelace).toBe(100_000000n);
    expect(decoded.outputs[1].assets).toEqual({});
  });
});
