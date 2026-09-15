import axios from 'axios';
import { parseHttpError } from '@/shared/utils/parser';
import { bigJsonTransform } from '@/api/bigJson';
import { parseGovActionId } from '@/shared/utils/govActionId';
import {
  normalizeProposal,
  normalizeVote,
  toNexusActionStatus,
  toNexusActionType,
} from '@/api/govVocabulary';
import type {
  Committee,
  Constitution,
  GovPage,
  GovProposal,
  GovProposalDetail,
  GovVote,
  GovVotingSummary,
} from '@/api/governance.types';

/**
 * Client for Cardano governance actions, served by Nexus through the
 * gero-backend proxy at `<backend>/api/nexus`.
 *
 * SCOPE: this client covers governance ACTIONS, the committee and the
 * constitution only. DReps are NOT here — gero-backend serves those from its
 * own cache via `blockchain-api.ts` (`/api/dreps`, snake_case). Keep the two
 * apart; their response shapes and network-parameter formats both differ.
 *
 * Two conventions this client owns:
 *  1. Nexus wants the chain-prefixed network slug (`cardano-mainnet`), not the
 *     wallet's bare `Mainnet`.
 *  2. A governance action id never leaves here containing a `#`. The proxy
 *     takes the tx hash and index as separate path segments and rebuilds the
 *     `%23` form upstream.
 */

export const governanceAxiosInstance = axios.create({
  baseURL: import.meta.env['VITE_NEXUS_URL'],
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
  // Replaces Axios's default JSON.parse so BigInteger stake figures survive.
  transformResponse: bigJsonTransform,
});

/** Map the wallet's Network value to Nexus's slug. Nexus rejects the bare enum. */
function toNexusNetwork(network: string | undefined | null): string {
  const value = String(network ?? '').toLowerCase();
  if (value.includes('preprod')) return 'cardano-preprod';
  if (value.includes('preview')) return 'cardano-preview';
  return 'cardano-mainnet';
}

/** Split a gov action id into the two path segments the proxy expects. */
function idSegments(govActionId: string): { txHash: string; index: number } {
  const parsed = parseGovActionId(govActionId);
  if (!parsed) throw new Error(`Unrecognised governance action id: ${govActionId}`);
  return parsed;
}

/**
 * A 200 whose body did not parse.
 *
 * `bigJsonTransform` returns NULL rather than throwing on a malformed or
 * truncated body — deliberately, so a bad body cannot blow up a caller mid-render
 * — which leaves it to each client to notice. This one did not: `data?.items ?? []`
 * turned a parse failure into an empty list, and the single-item getters collapsed
 * it into the same `null` they use for a genuine 404. Both render as a statement
 * about the chain ("no actions", "this action does not exist") made from bytes
 * nobody could read.
 */
function parsed<T>(data: T | null | undefined, what: string): T {
  if (data === null || data === undefined) {
    throw new Error(`Malformed response body for ${what}`);
  }
  return data;
}

/** True for an Axios error whose upstream response was a 404. */
function isNotFound(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

export interface ListProposalsParams {
  network: string;
  type?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export default {
  async listProposals(params: ListProposalsParams): Promise<GovPage<GovProposal>> {
    const query: Record<string, string | number> = { network: toNexusNetwork(params.network) };
    // Translated OUT of the wallet's vocabulary, exactly as responses are
    // translated into it. See govVocabulary: sending `TreasuryWithdrawals` where
    // the server expects `TREASURY_WITHDRAWALS_ACTION` returned an empty list.
    if (params.type) query['type'] = toNexusActionType(params.type);
    if (params.status) query['status'] = toNexusActionStatus(params.status);
    if (params.page !== undefined) query['page'] = params.page;
    if (params.pageSize !== undefined) query['pageSize'] = params.pageSize;

    try {
      const { data, status } = await governanceAxiosInstance.get('/api/governance/proposals', { params: query });
      // Vocabulary is normalised HERE, at the boundary, so no component, store
      // or spec has to know which projection answered. See govVocabulary.
      if (status === 200) {
        const body = parsed(data, 'the governance action list');
        return { ...body, items: (body.items ?? []).map(normalizeProposal) };
      }
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },

  async getProposal(govActionId: string, network: string): Promise<GovProposalDetail | null> {
    const { txHash, index } = idSegments(govActionId);
    try {
      const { data, status } = await governanceAxiosInstance.get(`/api/governance/proposals/${txHash}/${index}`, {
        params: { network: toNexusNetwork(network) },
      });
      if (status === 200) return normalizeProposal(parsed(data, 'a governance action'));
      throw parseHttpError(data);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw parseHttpError(error);
    }
  },

  async getProposalVotes(
    govActionId: string,
    network: string,
    page = 1,
    pageSize = 100
  ): Promise<GovPage<GovVote>> {
    const { txHash, index } = idSegments(govActionId);
    try {
      const { data, status } = await governanceAxiosInstance.get(
        `/api/governance/proposals/${txHash}/${index}/votes`,
        { params: { network: toNexusNetwork(network), page, pageSize } }
      );
      if (status === 200) {
        const body = parsed(data, "an action's votes");
        return { ...body, items: (body.items ?? []).map(normalizeVote) };
      }
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },

  async getVotingSummary(govActionId: string, network: string): Promise<GovVotingSummary | null> {
    const { txHash, index } = idSegments(govActionId);
    try {
      const { data, status } = await governanceAxiosInstance.get(
        `/api/governance/proposals/${txHash}/${index}/voting-summary`,
        { params: { network: toNexusNetwork(network) } }
      );
      if (status === 200) return parsed(data, 'a voting summary');
      throw parseHttpError(data);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw parseHttpError(error);
    }
  },

  async getCommittee(network: string): Promise<Committee | null> {
    try {
      const { data, status } = await governanceAxiosInstance.get('/api/governance/committee', {
        params: { network: toNexusNetwork(network) },
      });
      if (status === 200) return parsed(data, 'the constitutional committee');
      throw parseHttpError(data);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw parseHttpError(error);
    }
  },

  async getConstitution(network: string): Promise<Constitution | null> {
    try {
      const { data, status } = await governanceAxiosInstance.get('/api/governance/constitution', {
        params: { network: toNexusNetwork(network) },
      });
      if (status === 200) return parsed(data, 'the constitution');
      throw parseHttpError(data);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw parseHttpError(error);
    }
  },
};
