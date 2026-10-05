import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { SyncService } from './sync.service';
import type { WalletBg } from '@/chrome/walletBg';
import { MAINNET_PLUTUS_V3, PREVIEW_PLUTUS_V2 } from '@/shared/utils/__fixtures__/referenceScripts';

vi.mock('@/api/api', () => ({ Api: class {} }));
vi.mock('@/api/blockchain-api', () => ({ default: {} }));
vi.mock('@/chrome/walletBg', () => ({ WalletBg: class {} }));
vi.mock('@/stores/loading', () => ({ default: {} }));
vi.mock('@/stores/networkStore', () => ({ default: { setTip: vi.fn() } }));
vi.mock('@/stores/walletStore', () => ({ default: { state: {} }, walletStore: {} }));
vi.mock('@/services/websocket.service', () => ({ default: {} }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

const ADDRESS = 'addr_test1qpdmx56dml9qtej5vxhejju492w9pfv7j9270wjh0pfe9hdzqxa4r35qhuqx29n693k4gqukhk3lfw37xkp4egvh6raq4d4rzj';

/** A Nexus account UTxO row, as gero-sync forwards `GET /api/account/{stake}/utxos`. */
const nexusRow = (txIndex: number, referenceScript: unknown) => ({
  txHash: 'e2aa6c4bfa99562f0c6219a2dc1bb439a9cfb954113f9dc3bda96fe926771e25',
  txIndex,
  address: ADDRESS,
  value: '2000000',
  stakeAddress: 'stake_test1uz3qrw63c6qt7qr9zeazcm25qwttmgl5hglrtq6u5xtap7sjh5a56',
  datumHash: null,
  inlineDatum: null,
  referenceScript,
  assetList: [],
  isSpent: false,
});

/** gero-sync's own row for an output it read from a block (CardanoChainSync.toNexusShapedUtxo). */
const blockRow = (txIndex: number, scriptRef: string) => ({
  txHash: '354ffe7958d62a8a2bf0b0bd97a06694d59dc49b6d02f1ab40165a3955257168',
  txIndex,
  address: ADDRESS,
  value: '30907010',
  assetList: [],
  datumHash: null,
  inlineDatum: null,
  referenceScript: scriptRef,
});

describe('UTxOs pushed by gero-sync', () => {
  afterEach(() => vi.restoreAllMocks());

  it('are stored with their reference scripts as cardano-js-sdk Scripts', async () => {
    const applyUtxos = vi.fn().mockResolvedValue(undefined);
    const service = new SyncService({ applyUtxos } as unknown as WalletBg);
    vi.spyOn(service, 'healMissingTxCbor').mockResolvedValue();
    vi.spyOn(service as never, 'refreshAccountRewards').mockResolvedValue(undefined as never);

    await service.setSync({
      type: 'SYNC',
      utxos: [
        nexusRow(1, { hash: PREVIEW_PLUTUS_V2.hash, size: PREVIEW_PLUTUS_V2.size, type: 'plutusV2', bytes: PREVIEW_PLUTUS_V2.bytes, json: null }),
        nexusRow(2, { hash: PREVIEW_PLUTUS_V2.hash, size: null, type: null, bytes: null, json: null }),
        blockRow(0, MAINNET_PLUTUS_V3.cip33),
      ],
    });

    const [stored] = applyUtxos.mock.calls[0] as [Cardano.Utxo[]];
    expect(stored).toHaveLength(3);
    const [plutusV2, hashOnly, fromBlock] = stored.map(([, txOut]) => txOut.scriptReference);
    expect(plutusV2?.__type).toBe(Cardano.ScriptType.Plutus);
    expect(Serialization.Script.fromCore(plutusV2!).hash()).toBe(PREVIEW_PLUTUS_V2.hash);
    expect(hashOnly).toBeUndefined();
    expect(Serialization.Script.fromCore(fromBlock!).hash()).toBe(MAINNET_PLUTUS_V3.hash);
  });
});
