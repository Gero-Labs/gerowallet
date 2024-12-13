export interface Referral{
    name: string;
    address: string;
    dateRedeemed: string;
    eligible: boolean;
    reward: number;
}
export interface RefInfo{
    refAddress: string;
    referrals?: Referral[];
    currentView: 'refer' | 'redeem';
    totalRewards: number; // in $GERO
    totalRewardsInADA: number // in ADA
}