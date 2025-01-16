interface Referral{
    walletAddress: string;
    name: string;
    dateRedeemed: string;
    eligible: boolean;
    reward: number;
    rewardInADA: number;
}

interface Redeem{
    canClaim: boolean;
    actions?: {
        name: string
        done: boolean;
        info: string;
    }[]
    
}
export interface RefInfo{
    refAddress: string;
    referrals?: Referral[];
    redeem?: Redeem;
    totalRewards: number; // in $GERO
    totalRewardsInADA?: number // in ADA
}