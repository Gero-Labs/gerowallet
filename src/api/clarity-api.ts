import axios from 'axios';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

// ── Types ──

export interface DaoDetails {
  admins: string[];
  superAdmins: string[];
  appLink: string;
  description: string;
  name: string;
  discord: string;
  github: string;
  medium: string;
  reddit: string;
  telegram: string;
  twitter: string;
  website: string;
  youtube: string;
}

export interface VotingPowerAsset {
  id: string;
  scale: string;
  type: string;
  weight: number;
}

export interface VotingPowerCalculation {
  id: string;
  name: string;
  description: string;
  type: string;
  assets: VotingPowerAsset[];
  delegateScale: string;
  stakePoolId: string;
  timeBonusEpochs: number;
  timeBonusMultiplier: number;
}

export interface MembershipWorkflow {
  autoApprove?: boolean;
  minimumStake?: number;
  welcomeMessage?: string;
  description?: string;
}

export interface PollOption {
  id: string;
  name: string;
  description: string;
  votes: number;
}

export interface Poll {
  id: string;
  name: string;
  description: string;
  creator: string;
  isPublic: boolean;
  createdTime: number;
  votingOpensDate: number;
  votingDeadline: number;
  options: PollOption[];
}

export interface BountySubmission {
  id: string;
  name: string;
  description: string;
  createdTime: number;
  votes: number;
  walletAddress: string;
}

export interface Bounty {
  id: string;
  name: string;
  description: string;
  creator: string;
  isPublic: boolean;
  createdTime: number;
  submissionDeadline: number;
  votingOpensDate: number;
  votingDeadline: number;
  submissions: BountySubmission[];
}

export interface ProposalVote {
  tx: string;
  owner: string;
  outcome: number;
  power: number;
}

export interface AgoraParams {
  gtPolicyId: string;
  gtAssetName: string;
  maximumCosigners: number;
  governorInitialSpend: {
    transactionId: string;
    index: number;
  };
}

export interface ProposalMetadata {
  title: string;
  description: string;
  templateName: string;
}

export default {
  // ── DAO ──
  async getDaoDetails(address: string) {
    return axiosInstance.get(`/api/clarity/account-info?address=${address}`);
  },
  async getDaoMembers() {
    return axiosInstance.get<Record<string, number>>(`/api/clarity/dao/members`);
  },
  async getGeroDetails() {
    return axiosInstance.get<DaoDetails>(`/api/clarity/dao/details`);
  },
  async getVotingPowerCalculations() {
    return axiosInstance.get<VotingPowerCalculation[]>(`/api/clarity/dao/votingPowerCalculations`);
  },

  // ── Members ──
  async addMember(stakeAddress: string) {
    return axiosInstance.post<string>(`/api/clarity/members/addMember`, { stakeAddress });
  },

  // ── Governance Actions / Snapshots ──
  async getSnapshots(type?: 'polls' | 'openPolls' | 'snapshotProposals' | 'forums', restrictToActive?: boolean) {
    const params: any = {};
    if (type) params.type = type;
    if (restrictToActive !== undefined) params.restrictToActive = restrictToActive;
    return axiosInstance.get(`/api/clarity/govActions/snapshots`, { params });
  },
  async createSnapshotProposal(snapshotProposalMetadata: any) {
    return axiosInstance.post<string>(`/api/clarity/govActions/snapshots/createSnapshotProposal`, { snapshotProposalMetadata });
  },

  // ── Agora ──
  async getAgoraParams(daoId: string) {
    return axiosInstance.get<AgoraParams>(`/api/clarity/agora/agoraParams/${daoId}`);
  },
  async getProposalMetadata(proposalId: string) {
    return axiosInstance.get<ProposalMetadata>(`/api/clarity/agora/proposalMetadata/${proposalId}`);
  },
  async saveProposalMetadata(proposalMetadata: any) {
    return axiosInstance.post<string>(`/api/clarity/agora/saveProposalMetadata`, { proposalMetadata });
  },
  async getProposalVotes(proposalId: string) {
    return axiosInstance.get<ProposalVote[]>(`/api/clarity/agora/proposals/getVotes/${proposalId}`);
  },

  // ── User ──
  async getUserVotingPower(stakeAddress: string, votingPowerCalculationId: string) {
    return axiosInstance.get<number>(`/api/clarity/user/votingPower/${stakeAddress}/${votingPowerCalculationId}`);
  },

  // ── Metrics ──
  async getDefiLlamaAddresses(network: string = 'mainnet') {
    return axiosInstance.get<string[]>(`/api/clarity/metrics/getDefiLlamaAddresses`, { params: { network } });
  },

  // ── Workflows ──
  async getWorkflow(workflowId: string) {
    return axiosInstance.get<MembershipWorkflow>(`/api/clarity/workflows/getWorkflow/${workflowId}`);
  },
};
