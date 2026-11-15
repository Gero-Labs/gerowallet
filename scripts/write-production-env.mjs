/**
 * Writes .env.production for a release build from the repository's Actions variables
 * and secrets, so every build a release run makes (the candidate in ci-cd.yml, and the
 * old-release and recovery builds of the upgrade rehearsal in chrome-web-store.yml)
 * gets its configuration from ONE controlled source and ONE list of names.
 *
 *   PRODUCTION_VARS   `${{ toJSON(vars) }}`: every repository variable. Only the names
 *                     in VARIABLES are read; anything else in it is ignored.
 *   <secret name>     each name in SECRETS, passed one by one as its own env entry.
 *
 * A value is written as it is, never through a shell. A value holding a line break is
 * refused: it would add a line of its own to the file.
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

export function productionEnv(variablesJson, env) {
  let variables = {};
  if (variablesJson) {
    variables = JSON.parse(variablesJson);
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) throw new Error('PRODUCTION_VARS must be a JSON object');
  }
  const entries = [
    ...VARIABLES.map(name => [name, variables[name]]),
    ...SECRETS.map(name => [name, env[name]]),
    ...Object.entries(PINNED),
  ];
  return entries.map(([name, value]) => {
    const text = value === undefined || value === null ? '' : String(value);
    if (/[\r\n]/.test(text)) throw new Error(`${name} holds a line break`);
    return `${name}=${text}`;
  }).join('\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv[2] ?? '.env.production';
  const text = productionEnv(process.env.PRODUCTION_VARS, process.env);
  writeFileSync(file, text);
  console.log(`Wrote ${file} (${text.split('\n').filter(line => line.startsWith('VITE_')).length} vars)`);
}
