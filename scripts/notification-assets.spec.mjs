// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The app's test config injects a browser process shim into global references.
const nodeProcess = createRequire(import.meta.url)('node:process');

describe('production notification assets', () => {
  it('copies real assets to manifest and notification URLs in an empty output directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gero-notification-assets-'));
    try {
      cpSync(join(repository, 'src/assets/notifications'), join(directory, 'src/assets/notifications'), { recursive: true });
      expect(existsSync(join(directory, 'extension'))).toBe(false);
      // Run the actual production config's copy hook in a separate process:
      // no full build, shared cwd changes or stale developer extension files.
      const viteUrl = pathToFileURL(join(repository, 'node_modules/vite/dist/node/index.js')).href;
      const configPath = join(repository, 'vite.config.mts');
      execFileSync(nodeProcess.execPath, ['--input-type=module', '-e', `
        import { loadConfigFromFile } from ${JSON.stringify(viteUrl)};
        const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, ${JSON.stringify(configPath)});
        const copy = loaded.config.build.rollupOptions.plugins.find(plugin => plugin.name === 'copy');
        if (!copy?.writeBundle) throw new Error('Production asset copy hook is missing');
        process.chdir(${JSON.stringify(directory)});
        await copy.writeBundle();
      `], { cwd: repository, env: { ...nodeProcess.env, NODE_ENV: 'production' }, stdio: 'pipe', windowsHide: true });

      // The manifest exposes 2.6.0.png and the worker displays v2.6.3.png.
      for (const name of ['2.6.0.png', 'v2.6.3.png']) {
        const emitted = join(directory, 'extension/public', name);
        expect(existsSync(emitted), `${name} must match its public/ runtime URL`).toBe(true);
        expect(readFileSync(emitted)).toEqual(readFileSync(join(repository, 'src/assets/notifications', name)));
      }
    } finally {
      if (!directory.startsWith(join(tmpdir(), 'gero-notification-assets-'))) throw new Error('Unexpected fixture directory');
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
