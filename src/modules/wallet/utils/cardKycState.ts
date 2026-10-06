/** `status.name` values from GET /api/get-user-verifications (provider OpenAPI). */
export type KycStatus =
  | 'registered'
  | 'verification_started'
  | 'verified'
  | 'approved'
  | 'rejected'
  | 'verification_failed';

export type CardOnboardingState = 'auth' | 'new' | 'pending' | 'approved';

/** Maps the provider's verification status to the card page's onboarding state. */
export function kycStatusToCardState(status: string | null | undefined): CardOnboardingState {
  switch (status) {
    case 'verification_started':
    case 'verified':
      return 'pending';
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'auth';
    case 'verification_failed': // verification can be restarted from the "new" screen
    case 'registered':
    default:
      return 'new';
  }
}
