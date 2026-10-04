/**
 * Chrome Web Store MV3 policy: an extension may not load remotely hosted code.
 *
 * 2.7.2 was rejected ("Blue Argon") for a `<script src="https://cdn.jsdelivr.net/...">`
 * template inside @effect/platform's HttpApiScalar, a server-side API-docs page
 * that reached the UI bundle as a transitive Midnight SDK dependency. Nothing
 * in our own source referenced it, so only a check on the emitted artifact
 * would have caught it.
 *
 * The rules catch the common literal forms (remote `<script src>`, injected
 * `<script>` elements, static `import` / `export … from` a URL, `importScripts()` /
 * `import()` / `new Worker()` of a URL, JavaScript CDN hosts). A URL assembled at runtime gets past them, so new
 * dependencies still need a look.
 *
 * `forbidRemoteCode` fails a Vite build whose emitted JS/HTML matches a rule.
 * Files copied into extension/ outside Rollup (vendored SDKs, prepare.ts) never
 * pass through it, so `npm run build` and CI also run this file as a CLI over
 * the whole folder:
 *
 *   node scripts/remote-code-guard.mjs extension
 */
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Spans are bounded so a long run without `>` cannot make a match super-linear.
const REMOTE_URL = String.raw`(?:https?:)?\/\/`;
const QUOTE = '["\'`]';

export const REMOTE_CODE_RULES = [
  {
    pattern: /<script\b[^>]{0,200}?\bsrc\s*=[^>]{0,40}?https?:\/\//i,
    reason: '<script src> pointing at a remote URL',
  },
  {
    pattern: new RegExp(String.raw`<script\b[^>]{0,200}?\bsrc\s*=\s*${QUOTE}\/\/`, 'i'),
    reason: '<script src> pointing at a protocol-relative URL',
  },
  {
    pattern: new RegExp(String.raw`createElement\(\s*${QUOTE}script${QUOTE}\s*\)[\s\S]{0,300}?\.src\s*=\s*${QUOTE}${REMOTE_URL}`, 'i'),
    reason: 'an injected <script> element with a remote src',
  },
  { pattern: new RegExp(String.raw`\bimportScripts\(\s*${QUOTE}${REMOTE_URL}`), reason: 'importScripts() of a remote URL' },
  { pattern: new RegExp(String.raw`\bimport\(\s*${QUOTE}${REMOTE_URL}`), reason: 'dynamic import() of a remote URL' },
  {
    // `import "url"`, `import x from "url"`, `export * from "url"`, minified or not.
    // Rollup keeps URL specifiers as externals, so they reach the output as-is.
    pattern: new RegExp(String.raw`(?:\bimport\s*|\b(?:import|export)\b[^;"'\`()]{0,500}?\bfrom\s*)${QUOTE}${REMOTE_URL}`),
    reason: 'a static import or re-export from a remote URL',
  },
  { pattern: new RegExp(String.raw`\bnew\s+(?:Shared)?Worker\(\s*${QUOTE}${REMOTE_URL}`), reason: 'a Worker loaded from a remote URL' },
  {
    // Images, fonts, stylesheets and JSON on these hosts are data, not code.
    pattern: /\b(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|cdn\.skypack\.dev|esm\.sh)\/(?![^\s"'`)]{0,300}\.(?:png|jpe?g|gif|svg|webp|avif|ico|json|css|woff2?|ttf|otf)(?:[?#\s"'`)]|$))/i,
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

/**
 * Vite plugin. `enforce: 'post'` matters: Vite emits the HTML pages from its own
 * `generateBundle`, which runs after normal-order plugins, so without it the
 * pages are not in `bundle` yet when this scans it.
 */
export const forbidRemoteCode = {
  name: 'forbid-remote-code',
  apply: 'build',
  enforce: 'post',
  generateBundle(_options, bundle) {
    const report = Object.values(bundle)
      .filter((file) => isScannable(file.fileName))
      .map((file) => {
        const code = file.type === 'chunk' ? file.code : file.source;
        return typeof code === 'string' ? formatHits(file.fileName, findRemoteCode(code)) : '';
      })
      .filter(Boolean);
    if (report.length) {
      this.error(`Chrome Web Store MV3 forbids remotely hosted code:\n${report.join('\n')}`);
    }
  },
};

// Node realpaths the main module's URL but not argv[1], so compare real paths:
// run through a symlink or junction, a plain comparison skipped the scan and exited 0.
function isMain() {
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMain()) {
  const root = process.argv[2] ?? 'extension';
  const report = readdirSync(root, { recursive: true })
    .filter((path) => isScannable(path) && statSync(join(root, path)).isFile())
    .map((path) => formatHits(path, findRemoteCode(readFileSync(join(root, path), 'utf8'))))
    .filter(Boolean);
  if (report.length) {
    console.error(`remote-code-guard: remotely hosted code in ${root}:\n${report.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`remote-code-guard: OK — no remotely hosted code in ${root}`);
  }
}
