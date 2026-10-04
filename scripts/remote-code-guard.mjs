/**
 * Chrome Web Store MV3 policy: an extension may not load remotely hosted code.
 *
 * 2.7.2 was rejected ("Blue Argon") for a `<script src="https://cdn.jsdelivr.net/...">`
 * template inside @effect/platform's HttpApiScalar, a server-side API-docs page
 * that reached the UI bundle as a transitive Midnight SDK dependency. Nothing
 * in our own source referenced it, so only a check on the emitted artifact
 * would have caught it.
 *
 * `findRemoteCode()` runs on every emitted chunk via the `forbid-remote-code`
 * plugin in vite.config.mts and fails the build on a hit. The CLI scans an
 * already-built folder, e.g. before uploading a release:
 *
 *   node scripts/remote-code-guard.mjs extension
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REMOTE_CODE_RULES = [
  {
    // `[^>]*` stops at the tag's closing `>`, so a relative src followed by an
    // unrelated URL later in the file does not match.
    pattern: /<script\b[^>]*\bsrc\s*=[^>]*https?:\/\//i,
    reason: '<script src> pointing at a remote URL',
  },
  { pattern: /\bimportScripts\(\s*["'`]https?:\/\//, reason: 'importScripts() of a remote URL' },
  { pattern: /\bimport\(\s*["'`]https?:\/\//, reason: 'dynamic import() of a remote URL' },
  {
    pattern: /\b(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|cdn\.skypack\.dev|esm\.sh)\//,
    reason: 'a JavaScript CDN URL',
  },
];

const SNIPPET_RADIUS = 80;

/** Every rule that matches `code`, with a short excerpt around the first hit. */
export function findRemoteCode(code) {
  const hits = [];
  for (const { pattern, reason } of REMOTE_CODE_RULES) {
    const match = pattern.exec(code);
    if (!match) continue;
    const start = Math.max(0, match.index - SNIPPET_RADIUS);
    const end = Math.min(code.length, match.index + match[0].length + SNIPPET_RADIUS);
    hits.push({ reason, snippet: code.slice(start, end).replace(/\s+/g, ' ') });
  }
  return hits;
}

/** Only files the browser can execute or parse as markup. */
export function isScannable(fileName) {
  return /\.(?:m?js|html)$/i.test(fileName);
}

export function formatHits(fileName, hits) {
  return hits.map(({ reason, snippet }) => `  ${fileName}: ${reason}\n    …${snippet}…`).join('\n');
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.argv[2] ?? 'extension';
  const report = walk(root)
    .filter(isScannable)
    .map((path) => formatHits(relative(root, path), findRemoteCode(readFileSync(path, 'utf8'))))
    .filter(Boolean);
  if (report.length) {
    console.error(`remote-code-guard: remotely hosted code in ${root}:\n${report.join('\n')}`);
    process.exit(1);
  }
  console.log(`remote-code-guard: OK — no remotely hosted code in ${root}`);
}
