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

/**
 * Listing URL with attribution, for the link surfaced in the extension's beta
 * banner. No `hl` param: the store localizes from the browser locale.
 */
export const CHROME_WEB_STORE_URL_SIDEBAR = `${CHROME_WEB_STORE_URL}?utm_source=ext_sidebar`;
