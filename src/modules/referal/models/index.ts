export interface Referral{
    name: string;
}
export interface RefInfo{
    refAddress: string;
    referrals?: Referral[];
    currentView: 'refer' | 'redeem';
}