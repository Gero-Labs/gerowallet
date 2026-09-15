import { describe, it, expect, vi, beforeEach } from 'vitest';

const TX_HASH = '941502b0aa104c850d1979232594459ad5be55bd7b18b6285bbaa32d5566213d';

const EMPTY_PAGE = { items: [], page: 1, pageSize: 50, total: 0 };

async function loadApi() {
  const mod = await import('./governance-api');
  return { api: mod.default, instance: mod.governanceAxiosInstance };
}

describe('governance-api', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_NEXUS_URL', 'https://nexus.example.test');
    vi.resetModules();
  });

  it('uses VITE_NEXUS_URL as baseURL', async () => {
    const { instance } = await loadApi();
    expect(instance.defaults.baseURL).toBe('https://nexus.example.test');
  });

  it('wires the precision-safe transform — BigInteger stake figures survive as strings', async () => {
    const { instance } = await loadApi();
    const transform = instance.defaults.transformResponse as Array<(data: unknown) => unknown>;
    expect(Array.isArray(transform)).toBe(true);
    const out = transform[0]('{"yesVotePower":25000000000000001}') as { yesVotePower: unknown };
    expect(out.yesVotePower).toBe('25000000000000001');
  });

  describe('listProposals', () => {
    it('sends the cardano-mainnet slug, not the bare enum', async () => {
      const { api, instance } = await loadApi();
      const get = vi.spyOn(instance, 'get').mockResolvedValue({ status: 200, data: EMPTY_PAGE } as never);
      await api.listProposals({ network: 'Mainnet', page: 1, pageSize: 50 });
      expect(get).toHaveBeenCalledWith('/api/governance/proposals', {
        params: { network: 'cardano-mainnet', page: 1, pageSize: 50 },
      });
    });

    it('omits undefined filters rather than sending them as empty', async () => {
      const { api, instance } = await loadApi();
      const get = vi.spyOn(instance, 'get').mockResolvedValue({ status: 200, data: EMPTY_PAGE } as never);
      await api.listProposals({ network: 'Preprod' });
      const params = (get.mock.calls[0][1] as { params: Record<string, unknown> }).params;
      expect(params).not.toHaveProperty('type');
      expect(params).not.toHaveProperty('status');
      expect(params['network']).toBe('cardano-preprod');
    });
  });

  describe('getProposal', () => {
    it('splits the gov action id into two path segments — no # ever leaves the client', async () => {
      const { api, instance } = await loadApi();
      const get = vi.spyOn(instance, 'get').mockResolvedValue({ status: 200, data: {} } as never);
      await api.getProposal(`${TX_HASH}#0`, 'Mainnet');
      expect(get).toHaveBeenCalledWith(`/api/governance/proposals/${TX_HASH}/0`, {
        params: { network: 'cardano-mainnet' },
      });
    });

    it('accepts the bech32 form of the same id', async () => {
      const { api, instance } = await loadApi();
      const get = vi.spyOn(instance, 'get').mockResolvedValue({ status: 200, data: {} } as never);
      // bech32.encode('gov_action', toWords(TX_HASH bytes + index byte 0)) — the CIP-129 form of `${TX_HASH}#0`.
      await api.getProposal('gov_action1js2s9v92zpxg2rge0y3jt9z9nt2mu4da0vvtv2zmh23j64txyy7sqtmennd', 'Mainnet');
      const path = get.mock.calls[0][0];
      expect(path).toBe(`/api/governance/proposals/${TX_HASH}/0`);
    });

    it('rejects an unparseable id without making a request', async () => {
      const { api, instance } = await loadApi();
      const get = vi.spyOn(instance, 'get');
      await expect(api.getProposal('not-an-id', 'Mainnet')).rejects.toThrow(/governance action id/i);
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe('getVotingSummary', () => {
    it('targets the voting-summary sub-resource', async () => {
      const { api, instance } = await loadApi();
      const get = vi.spyOn(instance, 'get').mockResolvedValue({ status: 200, data: {} } as never);
      await api.getVotingSummary(`${TX_HASH}#0`, 'Preprod');
      expect(get).toHaveBeenCalledWith(`/api/governance/proposals/${TX_HASH}/0/voting-summary`, {
        params: { network: 'cardano-preprod' },
      });
    });
  });
});

describe('governance-api: the filter vocabulary goes OUT too', () => {
  // Normalising only inbound was half a fix, and the missing half failed the
  // same silent way: the filter chips carry the wallet's spelling, so asking
  // production for `type=TreasuryWithdrawals` returned an empty list, which
  // reads as "there are no treasury withdrawals".
  it('translates the type and status filters to the projection spelling', async () => {
    const { api, instance } = await loadApi();
    const get = vi.spyOn(instance, 'get').mockResolvedValue({ status: 200, data: EMPTY_PAGE } as never);

    await api.listProposals({ network: 'Mainnet', type: 'TreasuryWithdrawals', status: 'active' });

    expect(get).toHaveBeenCalledWith('/api/governance/proposals', {
      params: {
        network: 'cardano-mainnet',
        type: 'TREASURY_WITHDRAWALS_ACTION',
        status: 'LIVE',
      },
    });
  });

  it('omits the filters entirely when none is chosen', async () => {
    const { api, instance } = await loadApi();
    const get = vi.spyOn(instance, 'get').mockResolvedValue({ status: 200, data: EMPTY_PAGE } as never);

    await api.listProposals({ network: 'Mainnet' });

    expect(get.mock.calls[0][1].params).not.toHaveProperty('type');
    expect(get.mock.calls[0][1].params).not.toHaveProperty('status');
  });
});

describe('governance-api: a body that did not parse is not an answer', () => {
  // bigJsonTransform returns NULL for a malformed or truncated body rather than
  // throwing. Every one of these used to read that null as content: an empty
  // list, or the same `null` a genuine 404 produces. Both state something about
  // the chain on the strength of bytes nobody could read.
  it('rejects rather than reporting an empty action list', async () => {
    const { api, instance } = await loadApi();
    vi.spyOn(instance, 'get').mockResolvedValue({ status: 200, data: null } as never);

    await expect(api.listProposals({ network: 'Mainnet' })).rejects.toBeTruthy();
  });

  it('rejects rather than reporting an action that does not exist', async () => {
    const { api, instance } = await loadApi();
    vi.spyOn(instance, 'get').mockResolvedValue({ status: 200, data: null } as never);

    await expect(api.getProposal(`${TX_HASH}#0`, 'Mainnet')).rejects.toBeTruthy();
  });

  it('rejects rather than reporting an action with no votes', async () => {
    const { api, instance } = await loadApi();
    vi.spyOn(instance, 'get').mockResolvedValue({ status: 200, data: null } as never);

    await expect(api.getProposalVotes(`${TX_HASH}#0`, 'Mainnet')).rejects.toBeTruthy();
  });

  it('rejects rather than reporting no committee and no constitution', async () => {
    const { api, instance } = await loadApi();
    vi.spyOn(instance, 'get').mockResolvedValue({ status: 200, data: null } as never);

    await expect(api.getCommittee('Mainnet')).rejects.toBeTruthy();
    await expect(api.getConstitution('Mainnet')).rejects.toBeTruthy();
    await expect(api.getVotingSummary(`${TX_HASH}#0`, 'Mainnet')).rejects.toBeTruthy();
  });

  it('still returns null for a REAL 404, which is a different thing', async () => {
    // The distinction the collapse destroyed: "this action does not exist" is an
    // answer; "the body did not parse" is not.
    const { api, instance } = await loadApi();
    const notFound = Object.assign(new Error('not found'), {
      isAxiosError: true,
      response: { status: 404 },
    });
    vi.spyOn(instance, 'get').mockRejectedValue(notFound as never);

    await expect(api.getProposal(`${TX_HASH}#0`, 'Mainnet')).resolves.toBeNull();
    await expect(api.getCommittee('Mainnet')).resolves.toBeNull();
  });
});
