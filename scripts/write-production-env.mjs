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
 * A value is written as it is, never through a shell. Trailing line breaks (a pasted
 * secret often ends in one) are dropped; a line break inside a value is refused: it
 * would add a line of its own to the file.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const VARIABLES = [
  'GOOGLE_CLIENT_ID',
  'VITE_NEXUS_URL',
  'VITE_BACKEND_URL',
  'VITE_APP_NAME',
  'VITE_ADA_HANDLE_BASE_URL',
  'VITE_FLAGS_BASE_URL',
  'VITE_SYNC_WS_URL',
  'VITE_KAISEREX_OAUTH_URL',
  'VITE_KRAKEN_API_URL',
  'VITE_KRAKEN_WS_URL',
  'VITE_ZKFOLD_API_URL',
  'VITE_ZKFOLD_PROVER_URL',
  'VITE_CASHBACK_ENVIRONMENT',
  'VITE_CASHBACK_IDENTIFIER',
  'VITE_IS_BETA',
  'VITE_CIP45_DEFAULT_ENABLED',
  'VITE_USE_MOCK_PROOF',
];

export const SECRETS = ['VITE_MOONPAY_API_KEY', 'VITE_GUARDARIAN_API_KEY'];

/**
 * Pinned whatever the variables say. debugLog() output includes wallet records, unlock
 * responses and PRF metadata, so a release must never enable it.
 */
export const PINNED = { VITE_DEBUG_STORES: 'false' };

export function productionEnv(env) {
  const entries = [
    ...[...VARIABLES, ...SECRETS].map(name => [name, env[name]]),
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
