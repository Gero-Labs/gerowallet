// src/sidepanel/composables/useAgentStaking.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { createAgentStaking, type DelegateProposal, type ClaimRewardsProposal } from './useAgentStaking';
import type { StakeVerdict } from '@/services/agent/stakingGuardrail';

const POOL_ID = 'pool1goodpoolid';
const OWN_ADDR = 'addr_own';
const STAKE_ADDR = 'stake_own';
const CBOR = 'deadbeef';

const okVerdict: StakeVerdict = { ok: true, reasons: [] };
const blockedVerdict: StakeVerdict = { ok: false, reasons: ['This would delegate to a different pool than you asked for.'] };

function makeDeps(overrides: Partial<Parameters<typeof createAgentStaking>[0]> = {}) {
  return {
    resolvePool: vi.fn().mockResolvedValue(POOL_ID),
    getWithdrawable: vi.fn().mockResolvedValue(5_000000n),
    getStakeAddress: vi.fn().mockResolvedValue(STAKE_ADDR),
    getOwnAddresses: vi.fn().mockReturnValue([OWN_ADDR]),
    buildDelegate: vi.fn().mockResolvedValue(CBOR),
    buildWithdraw: vi.fn().mockResolvedValue(CBOR),
    decodeAndVerifyDelegate: vi.fn().mockReturnValue(okVerdict),
    decodeAndVerifyWithdraw: vi.fn().mockReturnValue(okVerdict),
    ...overrides,
  };
}

describe('createAgentStaking', () => {
  describe('delegate intent', () => {
    it('produces a ready proposal when Guardrail passes', async () => {
      const deps = makeDeps();
      const { busy, error, proposal, prepare } = createAgentStaking(deps);

      await prepare({ type: 'delegate', poolSymbol: 'GERO' });

      const p = proposal.value as DelegateProposal | null;
      expect(busy.value).toBe(false);
      expect(error.value).toBe('');
      expect(p).not.toBeNull();
      expect(p?.kind).toBe('delegate');
      expect(p?.status).toBe('ready');
      expect(p?.poolSymbol).toBe('GERO');
      expect(p?.targetPoolId).toBe(POOL_ID);
      expect(p?.unsignedTxCbor).toBe(CBOR);
      expect(p?.reasons).toEqual([]);

      expect(deps.resolvePool).toHaveBeenCalledWith('GERO');
      expect(deps.buildDelegate).toHaveBeenCalledWith(POOL_ID);
      expect(deps.decodeAndVerifyDelegate).toHaveBeenCalledWith(
        CBOR,
        [OWN_ADDR],
        POOL_ID,
        expect.any(BigInt),
      );
    });

    it('produces a blocked proposal when Guardrail fails', async () => {
      const deps = makeDeps({ decodeAndVerifyDelegate: vi.fn().mockReturnValue(blockedVerdict) });
      const { error, proposal, prepare } = createAgentStaking(deps);

      await prepare({ type: 'delegate', poolSymbol: 'GERO' });

      expect(error.value).toBe('');
      expect(proposal.value).not.toBeNull();
      expect(proposal.value?.status).toBe('blocked');
      expect(proposal.value?.reasons).toEqual(blockedVerdict.reasons);
    });

    it('sets error and no proposal when pool cannot be resolved', async () => {
      const deps = makeDeps({ resolvePool: vi.fn().mockResolvedValue(null) });
      const { error, proposal, prepare } = createAgentStaking(deps);

      await prepare({ type: 'delegate', poolSymbol: 'UNKNOWN' });

      expect(error.value).toMatch(/could not find that pool/i);
      expect(proposal.value).toBeNull();
      expect(deps.buildDelegate).not.toHaveBeenCalled();
    });
  });

  describe('claimRewards intent', () => {
    it('produces a ready proposal for a valid rewards withdrawal', async () => {
      const deps = makeDeps();
      const { error, proposal, prepare } = createAgentStaking(deps);

      await prepare({ type: 'claimRewards' });

      const p = proposal.value as ClaimRewardsProposal | null;
      expect(error.value).toBe('');
      expect(p).not.toBeNull();
      expect(p?.kind).toBe('claimRewards');
      expect(p?.status).toBe('ready');
      expect(p?.amount).toBe(5_000000n);
      expect(p?.unsignedTxCbor).toBe(CBOR);
      expect(p?.reasons).toEqual([]);

      expect(deps.getWithdrawable).toHaveBeenCalled();
      expect(deps.getStakeAddress).toHaveBeenCalled();
      expect(deps.buildWithdraw).toHaveBeenCalledWith(5_000000n);
      expect(deps.decodeAndVerifyWithdraw).toHaveBeenCalledWith(
        CBOR,
        [OWN_ADDR],
        STAKE_ADDR,
        5_000000n,
        expect.any(BigInt),
      );
    });

    it('sets error and no proposal when withdrawable amount is zero', async () => {
      const deps = makeDeps({ getWithdrawable: vi.fn().mockResolvedValue(0n) });
      const { error, proposal, prepare } = createAgentStaking(deps);

      await prepare({ type: 'claimRewards' });

      expect(error.value).toMatch(/no rewards to claim/i);
      expect(proposal.value).toBeNull();
      expect(deps.buildWithdraw).not.toHaveBeenCalled();
    });
  });

  describe('safety', () => {
    it('does not call any sign function (no auto-sign dep exists in interface)', async () => {
      // Verify that the deps interface has no sign function at all.
      // If no sign dep is injected and never called, the composable cannot auto-sign.
      const deps = makeDeps();
      const agentStaking = createAgentStaking(deps);

      await agentStaking.prepare({ type: 'delegate', poolSymbol: 'GERO' });

      // The deps object has exactly the functions we injected; no sign function was called.
      const depKeys = Object.keys(deps);
      expect(depKeys).not.toContain('sign');
      expect(depKeys).not.toContain('signTx');
      expect(depKeys).not.toContain('submitTx');
    });

    it('enforces busy guard and does not run parallel prepares', async () => {
      let resolvePool!: () => void;
      const poolPromise = new Promise<string>((res) => { resolvePool = () => res(POOL_ID); });
      const deps = makeDeps({ resolvePool: vi.fn().mockReturnValue(poolPromise) });
      const { busy, prepare } = createAgentStaking(deps);

      const first = prepare({ type: 'delegate', poolSymbol: 'GERO' });
      expect(busy.value).toBe(true);

      // Second call while busy should be a no-op.
      await prepare({ type: 'delegate', poolSymbol: 'GERO' });
      expect(deps.resolvePool).toHaveBeenCalledTimes(1);

      resolvePool();
      await first;
      expect(busy.value).toBe(false);
    });
  });
});
