/**
 * Which build of the extension is talking to the server, and whether the
 * server's minimum for Midnight sends is above it.
 *
 * Every Midnight API request carries `X-Gero-Client: extension/<version>`, the
 * version from the manifest, so the server can tell one build from another
 * (a staged Chrome rollout leaves some users on an old build for days). The
 * status read can name the lowest extension version it accepts for sends
 * (`minClientVersion.extension`); a build below it shows "Update required".
 */

export const GERO_CLIENT_HEADER = 'X-Gero-Client';

/** The installed extension's version from its manifest, or '' outside the extension (tests, tooling). */
export function extensionVersion(): string {
  try {
    const version = typeof chrome !== 'undefined' ? chrome.runtime?.getManifest?.()?.version : undefined;
    return typeof version === 'string' ? version : '';
  } catch {
    return '';
  }
}

/** `extension/<version>`, or '' when the version is unknown. */
export function geroClientValue(version: string = extensionVersion()): string {
  return version ? `extension/${version}` : '';
}

/** The header for a Midnight API request; empty when the version is unknown, so nothing made up is sent. */
export function geroClientHeaders(version: string = extensionVersion()): Record<string, string> {
  const value = geroClientValue(version);
  return value ? { [GERO_CLIENT_HEADER]: value } : {};
}

/** The numeric parts of a version (`2.8.10` → [2, 8, 10]); null when it isn't one. */
function versionParts(version: string): number[] | null {
  const match = /^\s*v?(\d+(?:\.\d+){0,3})/.exec(version);
  return match ? match[1].split('.').map(Number) : null;
}

/**
 * True only when both are versions and `version` is below `minimum`, compared
 * part by part (missing parts count as 0). Anything unreadable is not "below":
 * a malformed minimum must never lock a build out.
 */
export function isVersionBelow(version: string, minimum: string): boolean {
  const have = versionParts(version);
  const need = versionParts(minimum);
  if (!have || !need) return false;
  for (let i = 0; i < Math.max(have.length, need.length); i++) {
    const a = have[i] ?? 0;
    const b = need[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}
