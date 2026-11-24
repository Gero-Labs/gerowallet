// Midnight Preview is read-only in GeroWallet until Nexus opens its writes
// (issue 1477 step 3, issue 1453): one capability, `writesSupported` in
// midnightConfig.ts, holds every write through the write gate.
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Network } from '@/models/types';
import { getMidnightEndpoints, isMidnightReadOnlyNetwork } from './midnightConfig';
import { midnightWriteBlock, noteMidnightNetworkUpgrading, noteMidnightUpdateRequired, resetMidnightWriteGateForTests, useMidnightNetworkUpgrading, useMidnightUpdateRequired, useMidnightWriteBlock, writeBlockIn } from './midnightWriteGate';
import { assertMidnightWritesOpen } from './midnightWriteStatus';
import { MidnightApiError, isMidnightServerSideFailure, midnightSendBlockOf, readableMidnightError } from '@/api/midnightApiError';
import { useMidnightSendHold } from '@/shared/composables/useMidnightSendHold';

beforeEach(() => resetMidnightWriteGateForTests());

describe('the capability', () => {
  it('Preview takes no writes; Mainnet and Preprod do', () => {
    expect(getMidnightEndpoints(Network.PREVIEW)!.writesSupported).toBe(false);
    expect(getMidnightEndpoints(Network.PREPROD)!.writesSupported).toBe(true);
    expect(getMidnightEndpoints(Network.MAINNET)!.writesSupported).toBe(true);
  });

  it('is read in every spelling of the network, and never for one the wallet does not know', () => {
    for (const name of ['Preview', 'preview', 'midnight-preview', ' Midnight-Preview ']) expect(isMidnightReadOnlyNetwork(name)).toBe(true);
    for (const name of ['Mainnet', 'midnight-mainnet', 'Preprod', 'preprod', 'Stagenet', 'Devnet', '', undefined, null]) {
      expect(isMidnightReadOnlyNetwork(name)).toBe(false);
    }
  });
});

describe('the write gate', () => {
  it('holds every write on Preview as read-only, ahead of anything the server noted', async () => {
    expect(writeBlockIn({}, 'Preview', Date.now())).toBe('readOnly');
    await noteMidnightNetworkUpgrading('Preview', 'status');
    await noteMidnightUpdateRequired('Preview', 'response');
    expect(await midnightWriteBlock('Preview')).toBe('readOnly');
    expect(useMidnightWriteBlock(() => 'Preview').value).toBe('readOnly');
    // So neither write banner shows for it.
    expect(useMidnightNetworkUpgrading(() => 'Preview').value).toBe(false);
    expect(useMidnightUpdateRequired(() => 'Preview').value).toBe(false);
  });

  it('leaves the other networks to the server: open until it says otherwise', async () => {
    expect(writeBlockIn({}, 'Preprod', Date.now())).toBeNull();
    expect(await midnightWriteBlock('Mainnet')).toBeNull();
    await noteMidnightNetworkUpgrading('Preprod', 'status');
    expect(await midnightWriteBlock('Preprod')).toBe('networkUpgrading');
  });

  it('throws the read-only error before any send or registration', async () => {
    const error = await assertMidnightWritesOpen('Preview').catch((e) => e);
    expect(error).toBeInstanceOf(MidnightApiError);
    expect(error).toMatchObject({ kind: 'readOnly', network: 'Preview' });
    expect(error.message).toBe('Sending on Midnight Preview isn\'t available in GeroWallet yet. Balances, history and receiving work.');
    expect(midnightSendBlockOf(error)).toBe('readOnly');
    // The wallet's state, not the dapp's request: the connector answers InternalError.
    expect(isMidnightServerSideFailure(error)).toBe(true);
    await expect(assertMidnightWritesOpen('Preprod')).resolves.toBeUndefined();
    expect(readableMidnightError('readOnly', {}, 'Preview')).toBe(error.message);
  });
});

describe('Send and Register for DUST say why they are held', () => {
  it('on Preview: the read-only label and sentences', () => {
    const hold = useMidnightSendHold(() => 'Preview');
    expect(hold.hold.value).toBe('readOnly');
    expect(hold.held.value).toBe(true);
    expect(hold.sendTextShort.value).toBe('Read-only in GeroWallet for now');
    expect(hold.sendText.value).toBe('Sending on Midnight Preview isn\'t available in GeroWallet yet. Balances, history and receiving work.');
    expect(hold.registrationText.value).toBe('DUST registration on Midnight Preview isn\'t available in GeroWallet yet.');
    expect(hold.icon.value).toBe('mdi-eye-outline');
  });

  it('on Preprod: nothing held', () => {
    const hold = useMidnightSendHold(() => 'Preprod');
    expect(hold.held.value).toBe(false);
    expect(hold.sendText.value).toBe('');
  });
});

describe('dApp transaction requests on a read-only network', () => {
  const bg = readFileSync(join(__dirname, '../../chrome/background.ts'), 'utf8').replace(/\r\n/g, '\n');
  const handler = (method: string) => {
    const start = bg.indexOf(`app.add(MIDNIGHT_METHOD.${method}, `);
    const next = bg.indexOf('\napp.add(', start + 1);
    return bg.slice(start, next === -1 ? undefined : next);
  };

  it.each(['balanceUnsealedTransaction', 'balanceSealedTransaction', 'makeIntent', 'makeTransfer'])(
    '%s is refused before the prompt is parked', (method) => {
      const body = handler(method);
      const refusal = body.indexOf('if (refuseMidnightReadOnly(currentWallet.network, reply)) return true;');
      expect(refusal).toBeGreaterThan(-1);
      expect(refusal).toBeLessThan(body.indexOf('parkMidnightRequest('));
    });

  it('the refusal is InternalError with the wallet\'s own sentence, from the one capability', () => {
    const helper = bg.slice(bg.indexOf('function refuseMidnightReadOnly('), bg.indexOf('function requireMidnightWallet('));
    expect(helper).toContain('if (!isMidnightReadOnlyNetwork(network)) return false;');
    expect(helper).toContain("midnightApiError(MidnightErrorCode.InternalError, readableMidnightError('readOnly', {}, network))");
  });

  it('submitTransaction is answered by the write gate before any request', () => {
    const body = handler('submitTransaction');
    const gate = body.indexOf('const writeBlock = await midnightWriteBlock(wallet.network);');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(body.indexOf('getMidnightApi('));
  });
});
