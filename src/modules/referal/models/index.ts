export interface Referral{
    walletAddress: string;
    name: string;
    dateRedeemed: string;
    eligible: boolean;
    reward: number;
    rewardInADA: number;
}
export interface RefInfo{
    refAddress: string;
    referrals?: Referral[];
    totalRewards: number; // in $GERO
    totalRewardsInADA?: number // in ADA
}