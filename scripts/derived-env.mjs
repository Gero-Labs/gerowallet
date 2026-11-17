/**
 * Endpoints derived instead of asked for twice (no imports: the release workflow runs
 * write-production-env.mjs from a checkout with no node_modules):
 *
 *   VITE_NEXUS_URL       = VITE_BACKEND_URL + '/api/nexus'   (gero-backend's Nexus proxy)
 *   VITE_FLAGS_BASE_URL  = VITE_SYNC_WS_URL as http(s)       (gero-sync serves both)
 *
 * VITE_SYNC_WS_URL is gero-sync's BASE URL, path included (websocket.service.ts adds
 * `/ws/sync`; midnightConfig.ts builds its http relay from it the same way), so a path
 * such as `ws://localhost:8081/sync` carries over: flags at `http://localhost:8081/sync`.
 */

/** The names derived. */
export const DERIVED = ['VITE_NEXUS_URL', 'VITE_FLAGS_BASE_URL'];

/** The derived values for `env`, only for names it does not already set. */
export function derivedEnv(env) {
  const out = {};
  const backend = (env.VITE_BACKEND_URL ?? '').trim().replace(/\/+$/, '');
  if (!env.VITE_NEXUS_URL && backend) out.VITE_NEXUS_URL = `${backend}/api/nexus`;
  const sync = (env.VITE_SYNC_WS_URL ?? '').trim().replace(/\/+$/, '');
  if (!env.VITE_FLAGS_BASE_URL && /^wss?:\/\//i.test(sync)) {
    out.VITE_FLAGS_BASE_URL = sync.replace(/^ws(s?):\/\//i, 'http$1://');
  }
  return out;
}
