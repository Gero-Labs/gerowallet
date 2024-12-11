export interface Referral{
    walletAddress: string;
    name: string;
    redeemDate: number; // represents timestamp
    elibility: boolean;
    reward: number;
}
export interface RefInfo{
    refAddress: string;
    referrals?: Referral[];
    currentView: 'refer' | 'redeem';

}