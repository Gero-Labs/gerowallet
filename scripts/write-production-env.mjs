/**
 * Writes .env.production for a release build from the repository's Actions variables
 * and secrets, so every build a release run makes (the candidate in ci-cd.yml, and the
 * old-release and recovery builds of the upgrade rehearsal in chrome-web-store.yml)
 * writes the same names the same way.
 *
 * Each name in NAMES arrives as its own env entry of the step (`NAME: ${{ vars.NAME }}`,
 * or `secrets.NAME` for SECRETS). Only those are passed, never `toJSON(vars)`, so a build
 * step sees and logs no repository variable it does not use. write-production-env.spec.mjs
 * holds both workflows to this list.
 *
 * VITE_NEXUS_URL and VITE_FLAGS_BASE_URL are not asked for: they are derived from
 * VITE_BACKEND_URL and VITE_SYNC_WS_URL (derived-env.mjs) and written here as well. Today's
 * build would derive them itself, but the upgrade rehearsal also builds an OLD release
 * (OLD_RELEASE_SHA) with this script, and that code reads them and derives nothing.
 *
 * A value is written as it is, never through a shell. Trailing line breaks (a pasted
 * secret often ends in one) are dropped; a line break inside a value is refused: it
 * would add a line of its own to the file.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DERIVED, derivedEnv } from './derived-env.mjs';

export const VARIABLES = [
  'GOOGLE_CLIENT_ID',
  'VITE_BACKEND_URL',
  'VITE_SYNC_WS_URL',
  'VITE_KAISEREX_OAUTH_URL',
  'VITE_KRAKEN_WS_URL',
  'VITE_CASHBACK_ENVIRONMENT',
  'VITE_CASHBACK_IDENTIFIER',
  'VITE_IS_BETA',
  'VITE_CIP45_DEFAULT_ENABLED',
];

export const SECRETS = ['VITE_MOONPAY_API_KEY'];

/**
 * A release cannot do without these: VITE_NEXUS_URL and VITE_FLAGS_BASE_URL are derived
 * from them, so an empty one would ship a build with no Nexus or no feature flags.
 */
export const REQUIRED = ['VITE_BACKEND_URL', 'VITE_SYNC_WS_URL'];

/**
 * Pinned whatever the variables say. debugLog() output includes wallet records, unlock
 * responses and PRF metadata, so a release must never enable it.
 */
export const PINNED = { VITE_DEBUG_STORES: 'false' };

export function productionEnv(env) {
  const missing = REQUIRED.filter(name => !(env[name] ?? '').trim());
  if (missing.length) throw new Error(`${missing.join(', ')} must be set`);
  // Only from the release's own names: a stray VITE_NEXUS_URL in the step's env never wins.
  const derived = derivedEnv(Object.fromEntries(REQUIRED.map(name => [name, env[name]])));
  if (!derived.VITE_FLAGS_BASE_URL) throw new Error('VITE_SYNC_WS_URL must be a ws:// or wss:// URL');
  const entries = [
    ...[...VARIABLES, ...SECRETS].map(name => [name, env[name]]),
    ...DERIVED.map(name => [name, derived[name]]),
    ...Object.entries(PINNED),
  ];
  return entries.map(([name, value]) => {
    const text = (value ?? '').replace(/[\r\n]+$/, '');
    if (/[\r\n]/.test(text)) throw new Error(`${name} holds a line break`);
    return `${name}=${text}`;
  }).join('\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv[2] ?? '.env.production';
  const text = productionEnv(process.env);
  writeFileSync(file, text);
  console.log(`Wrote ${file} (${text.split('\n').filter(line => line.startsWith('VITE_')).length} vars)`);
}
