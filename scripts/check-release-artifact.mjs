/** Validate the emitted MV3 directory before it is archived or published. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, matchesGlob, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findRemoteCode, isScannable } from './remote-code-guard.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function extensionIdForKey(key) {
  if (typeof key !== 'string' || !key || !/^[A-Za-z0-9+/=\s]+$/.test(key)) throw new Error('Manifest key is missing or invalid');
  return sha256(Buffer.from(key, 'base64')).slice(0, 32).replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
}

export function inspectReleaseArtifact(directory, { expectedVersion, expectedId } = {}) {
  const root = resolve(directory);
  const problems = [];
  const files = readdirSync(root, { recursive: true }).filter(name => statSync(join(root, name)).isFile()).map(name => name.split(sep).join('/')).sort();
  const present = new Set(files);
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const requireLocal = (resource, label, glob = false) => {
    if (typeof resource !== 'string' || !resource || /[\\?#]/.test(resource) || resource.startsWith('/') || isAbsolute(resource) || resource.split('/').includes('..') || /^[a-z]+:/i.test(resource)) {
      problems.push(`${label} must be a packaged relative path`);
      return;
    }
    const normalized = resource.replace(/^(?:\.\/)+/, '');
    if (glob ? !files.some(file => matchesGlob(file, normalized)) : !present.has(normalized)) problems.push(`${label} is missing: ${resource}`);
  };
  if (manifest.manifest_version !== 3) problems.push('Manifest must use MV3');
  if (!expectedVersion || manifest.version !== expectedVersion) problems.push('Manifest version does not match the explicit candidate version');
  let extensionId = null;
  if (manifest.key) {
    try { extensionId = extensionIdForKey(manifest.key); }
    catch (error) { problems.push(error.message); }
  }
  if (expectedId && extensionId !== expectedId) problems.push('Manifest key does not match the expected extension ID');
  const csp = manifest.content_security_policy?.extension_pages;
  const entries = typeof csp === 'string' ? csp.split(';').filter(part => part.trim()).map(part => {
    const [name, ...sources] = part.trim().split(/\s+/);
    return [name, sources];
  }) : [];
  const directives = new Map(entries);
  if (entries.length !== directives.size) problems.push('CSP must not contain duplicate directives');
  const scripts = directives.get('script-src');
  if (!scripts?.includes("'self'") || scripts.some(source => !["'self'", "'wasm-unsafe-eval'"].includes(source))) {
    problems.push('Production script-src must contain self and only optional wasm-unsafe-eval');
  }
  const objects = directives.get('object-src');
  if (!objects?.length || !objects.every(source => ["'self'", "'none'"].includes(source))) problems.push('object-src must restrict objects to self or none');
  for (const directive of ['form-action', 'base-uri']) {
    const sources = directives.get(directive);
    if (sources?.length !== 1 || sources[0] !== "'none'") problems.push(`${directive} must be 'none'`);
  }
  for (const directive of ['script-src-elem', 'script-src-attr', 'worker-src']) {
    const sources = directives.get(directive);
    if (sources && (!sources.length || sources.some(source => !["'self'", "'none'"].includes(source)))) problems.push(`${directive} must restrict execution to self or none`);
  }
  // vite.config.background.mts emits one IIFE, so Chrome must load it as classic.
  if (manifest.background?.type && manifest.background.type !== 'classic') problems.push('Background must use the existing classic IIFE service-worker format');
  requireLocal(manifest.background?.service_worker, 'Background service worker');
  // The background opens this dashboard itself; no options_ui is registered.
  requireLocal(manifest.options_page ?? manifest.options_ui?.page ?? 'index.html', 'Options page');
  requireLocal(manifest.side_panel?.default_path, 'Side panel');
  for (const icon of Object.values(manifest.icons ?? {})) requireLocal(icon, 'Icon');
  for (const content of manifest.content_scripts ?? []) {
    for (const script of content.js ?? []) requireLocal(script, 'Content script');
    for (const style of content.css ?? []) requireLocal(style, 'Content stylesheet');
  }
  for (const resource of (manifest.web_accessible_resources ?? []).flatMap(entry => entry.resources ?? [])) requireLocal(resource, 'Web-accessible resource', true);
  const wasmFiles = files.filter(file => file.endsWith('.wasm'));
  if (!wasmFiles.length) problems.push('No locally packaged WASM files');
  const checksums = {};
  for (const file of files) {
    const bytes = readFileSync(join(root, file));
    checksums[file] = sha256(bytes);
    if (/\.(?:zip|crx)$/i.test(file)) problems.push(`Nested archive must not enter the release directory: ${file}`);
    if (!isScannable(file)) continue;
    const code = bytes.toString('utf8');
    for (const hit of findRemoteCode(code)) problems.push(`${file}: ${hit.reason}`);
    if (!file.endsWith('.html')) continue;
    if (/<script\b[^>]*>\s*[^<\s]/i.test(code)) problems.push(`${file}: inline script is incompatible with production CSP`);
    for (const match of code.matchAll(/<(script|link)\b([^>]+)>/gi)) {
      const attrs = match[2];
      if (match[1].toLowerCase() === 'link' && !/\brel\s*=\s*["'](?:stylesheet|modulepreload)["']/i.test(attrs)) continue;
      const reference = /\b(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
      if (!reference) continue;
      if (/^(?:[a-z]+:|\/\/)/i.test(reference)) {
        problems.push(`${file}: executable asset reference must be local`);
        continue;
      }
      const target = resolve(reference.startsWith('/') ? root : dirname(join(root, file)), reference.replace(/^\//, ''));
      const name = relative(root, target).split(sep).join('/');
      requireLocal(name, `${file} asset`);
    }
  }
  return {
    ok: problems.length === 0,
    version: manifest.version,
    extensionId,
    identityVerified: Boolean(expectedId && expectedId === extensionId),
    permissions: manifest.permissions ?? [],
    hostPermissions: manifest.host_permissions ?? [],
    contentSecurityPolicy: csp,
    fileCount: files.length,
    wasmFiles,
    checksums,
    problems,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const value = flag => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const root = args[0] ?? 'extension';
  const expectedVersion = value('--expected-version');
  const expectedId = value('--expected-id');
  const report = inspectReleaseArtifact(root, { expectedVersion, expectedId });
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const lockBytes = readFileSync(join(repo, 'package-lock.json'));
  const lock = JSON.parse(lockBytes.toString('utf8'));
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  if (pkg.version !== expectedVersion || lock.version !== expectedVersion || lock.packages?.['']?.version !== expectedVersion) report.problems.push('Package and lockfile versions must match the explicit candidate version');
  report.ok = report.problems.length === 0;
  report.packageLockSha256 = sha256(lockBytes);
  report.nodeVersion = process.version;
  report.generatedAt = new Date().toISOString();
  const output = value('--report');
  if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) {
    console.error(`check-release-artifact: FAIL\n${report.problems.map(problem => `  - ${problem}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`check-release-artifact: OK (${report.fileCount} files, ${report.wasmFiles.length} local WASM files, version ${report.version}, identity ${report.identityVerified ? 'verified' : 'not verified'})`);
  }
}
