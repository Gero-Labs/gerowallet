import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { extensionIdForKey, inspectReleaseArtifact } from './check-release-artifact.mjs';

let directory;
const key = Buffer.from('synthetic-public-manifest-key').toString('base64');
const options = { expectedVersion: '3.0.0', expectedId: extensionIdForKey(key) };
const write = (name, contents) => { mkdirSync(dirname(join(directory, name)), { recursive: true }); writeFileSync(join(directory, name), contents); };
const updateManifest = change => {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  change(manifest);
  write('manifest.json', JSON.stringify(manifest));
};

describe('release artifact gate', () => {
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'gero-release-'));
    write('manifest.json', JSON.stringify({
      manifest_version: 3, version: '3.0.0', key,
      background: { service_worker: './background/index.js' },
      options_page: 'index.html', side_panel: { default_path: 'sidepanel/index.html' },
      content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'none';" },
      web_accessible_resources: [{ resources: ['assets/*.wasm'], matches: ['<all_urls>'] }],
    }));
    write('background/index.js', 'export {};');
    write('assets/app.js', 'export {};');
    write('assets/app.css', 'body { color: black; }');
    write('assets/crypto.wasm', Buffer.from([0, 97, 115, 109]));
    write('index.html', '<script type="module" src="./assets/app.js"></script><link rel="stylesheet" href="./assets/app.css">');
    write('sidepanel/index.html', '<script type="module" src="../assets/app.js"></script>');
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('records hashes and verifies version, identity, both UIs and packaged WASM', () => {
    const report = inspectReleaseArtifact(directory, options);
    expect(report.problems).toEqual([]);
    expect(report.identityVerified).toBe(true);
    expect(report.checksums['assets/app.js']).toMatch(/^[a-f0-9]{64}$/);
    expect(report.wasmFiles).toEqual(['assets/crypto.wasm']);
  });

  it.each([
    ['wrong version', manifest => { manifest.version = '2.7.3'; }],
    ['missing identity', manifest => { delete manifest.key; }],
    ['wrong identity', manifest => { manifest.key = Buffer.from('other-key').toString('base64'); }],
    ['remote worker', manifest => { manifest.background.service_worker = 'https://example.org/worker.js'; }],
    ['worker format changed', manifest => { manifest.background.type = 'module'; }],
    ['missing side panel', manifest => { manifest.side_panel.default_path = 'absent.html'; }],
    ['remote scripts permitted', manifest => { manifest.content_security_policy.extension_pages = "script-src 'self' https:; object-src 'none'"; }],
    ['eval permitted', manifest => { manifest.content_security_policy.extension_pages = "script-src 'self' 'unsafe-eval'; object-src 'none'"; }],
    ['duplicate CSP directive', manifest => { manifest.content_security_policy.extension_pages = "script-src https:; script-src 'self'; object-src 'none'"; }],
    ['script element override', manifest => { manifest.content_security_policy.extension_pages += 'script-src-elem https:;'; }],
    ['resource outside package', manifest => { manifest.web_accessible_resources[0].resources = ['../secret.wasm']; }],
  ])('rejects %s', (_name, change) => {
    updateManifest(change);
    expect(inspectReleaseArtifact(directory, options).ok).toBe(false);
  });

  it.each([
    ['index.html', '<script src="https://cdn.example.org/app.js"></script>'],
    ['sidepanel/index.html', '<script src="../assets/missing.js"></script>'],
    ['index.html', '<script>runCode()</script>'],
    ['assets/app.js', 'import("https://example.org/code.js")'],
    ['old-release.zip', 'stale archive'],
  ])('rejects malformed executable or stale packaged content in %s', (file, content) => {
    write(file, content);
    expect(inspectReleaseArtifact(directory, options).ok).toBe(false);
  });

  it('reports identity as unverified unless an expected release ID is supplied', () => {
    expect(inspectReleaseArtifact(directory, { expectedVersion: '3.0.0' }).identityVerified).toBe(false);
  });
});
