/**
 * Gero Card provider hosts, in one place.
 *
 * The card programme moved from KaiserEx's EU entity to Digi Ex Pro (Pty) Ltd,
 * trading as Zione (South Africa). The OAuth/API host is the same app that served
 * oauth-sa.kaiserex.com; only hostnames, pages and legal copy changed.
 * scripts/manifest.ts frame-src must allow the registration origin
 * (cardProvider.spec.ts checks it).
 */
export const CARD_PROVIDER = {
  /** Lead form shown in KaiserexRegistrationModal. It submits to Zoho inside the frame. */
  registrationUrl: 'https://zione.com/gerocard/',
} as const;
