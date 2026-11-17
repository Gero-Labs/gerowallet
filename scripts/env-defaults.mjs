/**
 * Vite plugin: fills VITE_NEXUS_URL and VITE_FLAGS_BASE_URL from VITE_BACKEND_URL and
 * VITE_SYNC_WS_URL (derived-env.mjs has the rules) when they are not set.
 *
 * A value set explicitly (an env file or the process environment) always wins, so a
 * setup with a separate Nexus or flag host keeps working. Vite reads env files after
 * the plugins' `config` hooks and lets `process.env` override them, so writing the
 * derived value there reaches `import.meta.env` in every build (main, background,
 * content, inject) and in the dev server.
 */
import { loadEnv } from 'vite';
import { derivedEnv } from './derived-env.mjs';

export { derivedEnv };

export function envDefaults() {
  return {
    name: 'gero-env-defaults',
    config(config, { mode }) {
      const env = loadEnv(mode, config.envDir ?? process.cwd(), 'VITE_');
      for (const [name, value] of Object.entries(derivedEnv(env))) process.env[name] = value;
    },
  };
}
