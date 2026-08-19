/**
 * Canonical Chrome Web Store listing for the Gero Dashboard extension.
 *
 * Single source of truth on purpose: the extension ID is advertised to dApps
 * through wallet-discovery metadata (`src/chrome/inject.ts`) as well as linked
 * from inside the extension, and a stale copy silently sends new users to a
 * dead store page.
 */
export const CHROME_WEB_STORE_EXTENSION_ID = 'bgpipimickeadkjlklgciifhnalhdjhe';

/** Bare listing URL — what we advertise to external consumers (dApps). */
export const CHROME_WEB_STORE_URL = `https://chromewebstore.google.com/detail/gero-dashboard/${CHROME_WEB_STORE_EXTENSION_ID}`;

/** Listing URL with attribution params, for links surfaced inside the extension. */
export function chromeWebStoreUrlWithSource(utmSource: string): string {
  return `${CHROME_WEB_STORE_URL}?hl=en-US&utm_source=${encodeURIComponent(utmSource)}`;
}
