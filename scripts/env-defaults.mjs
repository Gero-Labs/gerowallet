/**
 * Endpoints the build derives instead of asking for twice:
 *
 *   VITE_NEXUS_URL       = VITE_BACKEND_URL + '/api/nexus'   (gero-backend's Nexus proxy)
 *   VITE_FLAGS_BASE_URL  = VITE_SYNC_WS_URL as http(s)       (gero-sync serves both)
 *
 * A value set explicitly (an env file or the process environment) always wins, so a
 * setup with a separate Nexus or flag host keeps working. Vite reads env files after
 * the plugins' `config` hooks and lets `process.env` override them, so writing the
 * derived value there reaches `import.meta.env` in every build (main, background,
 * content, inject) and in the dev server.
 */
import { loadEnv } from 'vite';

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

export function envDefaults() {
  return {
    name: 'gero-env-defaults',
    config(config, { mode }) {
      const env = loadEnv(mode, config.envDir ?? process.cwd(), 'VITE_');
      for (const [name, value] of Object.entries(derivedEnv(env))) process.env[name] = value;
    },
  };
}
