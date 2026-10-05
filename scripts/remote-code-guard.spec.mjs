// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { findRemoteCode, forbidRemoteCode, isScannable } from './remote-code-guard.mjs';

/**
 * The positive fixture is the line the Chrome Web Store quoted when it rejected
 * 2.7.2 (js/index10.js, from @effect/platform's HttpApiScalar). The negatives
 * are verbatim from that same build, where they are legitimate: the guard must
 * stay quiet on them or every build fails.
 */
const REJECTED_SNIPPET = '${source._tag === "Cdn" ? `<script src="${`https://cdn.jsdelivr.net/npm/@scalar/api-reference@${source.version ?? "latest"}/dist/browser/standalone.min.js`}" crossorigin><\\/script>` : `<script>${source.source}<\\/script>`}';

const reasons = code => findRemoteCode(code).map(hit => hit.reason);

describe('findRemoteCode', () => {
  it('flags the snippet the Web Store rejected', () => {
    expect(reasons(REJECTED_SNIPPET)).toEqual([
      '<script src> pointing at a remote URL',
      'a JavaScript CDN URL',
    ]);
  });

  it('flags remote importScripts(), dynamic import() and Workers', () => {
    expect(reasons("importScripts('https://example.com/worker.js')")).toEqual(['importScripts() of a remote URL']);
    expect(reasons('await import(`https://example.com/mod.js`)')).toEqual(['dynamic import() of a remote URL']);
    expect(reasons('new Worker("//example.com/w.js")')).toEqual(['a Worker loaded from a remote URL']);
  });

  it('flags static imports and re-exports from any remote host', () => {
    const forms = [
      'import "https://example.com/remote.js";',
      "import x from 'https://evil.example/x.js';",
      'import{a as b,c}from"//evil.example/x.js"',
      'import * as ns from `https://example.com/ns.js`;',
      'export * from "https://example.com/m.js";',
      "export { y as z } from 'https://example.com/m.js';",
    ];
    for (const code of forms) expect(reasons(code)).toEqual(['a static import or re-export from a remote URL']);
  });

  it('ignores local static imports and lookalike identifiers', () => {
    const local = [
      'import "./polyfills.js";',
      "import x from '../x.js'; export * from './y.js';",
      'const important = from("https://example.com/data.json");',
      'exportFrom("https://example.com/feed")',
    ];
    for (const code of local) expect(findRemoteCode(code)).toEqual([]);
  });

  it('flags an injected <script> element and a protocol-relative src', () => {
    const loader = 'const s=document.createElement("script");s.src="https://www.googletagmanager.com/gtag/js?id="+id;document.head.appendChild(s)';
    expect(reasons(loader)).toEqual(['an injected <script> element with a remote src']);
    expect(reasons('<script src="//example.com/widget.js"></script>')).toEqual(['<script src> pointing at a protocol-relative URL']);
  });

  it('flags a script CDN URL on its own, in any case', () => {
    expect(reasons('const src = "https://unpkg.com/lib@1/dist/lib.min.js";')).toEqual(['a JavaScript CDN URL']);
    expect(reasons('const src = "https://CDN.JSDELIVR.NET/npm/lib";')).toEqual(['a JavaScript CDN URL']);
  });

  it('ignores non-code files on CDN hosts', () => {
    expect(findRemoteCode('logo: "https://cdn.jsdelivr.net/gh/org/repo/logos/ada.png"')).toEqual([]);
    expect(findRemoteCode("fetch('https://unpkg.com/registry@1/tokens.json')")).toEqual([]);
  });

  it('ignores a relative <script src> even when a URL follows later', () => {
    const html = '<script type="module" crossorigin src="./assets/options.js"></script>\n<a href="https://gerowallet.io">';
    expect(findRemoteCode(html)).toEqual([]);
  });

  it('ignores the legitimate URLs in the 2.7.2 build', () => {
    const benign = [
      // VueUse useWebWorkerFn: a blob worker, deps are whatever the caller passes.
      "return `importScripts('${depsString}')`;",
      // Favicon <img> source, not code.
      '"src": `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&url=https://${host}`',
      // Outbound link to our own API docs.
      '"href": "https://nexus.gerowallet.io/swagger-ui", "target": "_blank"',
    ];
    for (const code of benign) expect(findRemoteCode(code)).toEqual([]);
  });
});

describe('isScannable', () => {
  it('covers scripts and markup only', () => {
    expect(['js/index10.js', 'background/index.mjs', 'sidepanel/index.html'].every(isScannable)).toBe(true);
    expect(['assets/options.css', 'public/logo.svg', 'manifest.json'].some(isScannable)).toBe(false);
  });
});

/** Runs a real Vite build of one page with only the guard plugin installed. */
async function buildPage(html, mainJs = 'document.title = "fixture";\n') {
  const root = mkdtempSync(join(tmpdir(), 'remote-code-guard-'));
  writeFileSync(join(root, 'index.html'), html);
  writeFileSync(join(root, 'main.js'), mainJs);
  try {
    return await build({ root, configFile: false, logLevel: 'silent', plugins: [forbidRemoteCode], build: { write: false } });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('forbidRemoteCode plugin', () => {
  // Vite emits the HTML pages after normal-order plugins run, so this only
  // passes while the plugin is `enforce: 'post'`.
  it('fails the build on a remote <script src> in the HTML page', async () => {
    const page = '<script src="https://cdn.example.com/widget.js"></script><script type="module" src="./main.js"></script>';
    await expect(buildPage(page)).rejects.toThrow(/index\.html: <script src> pointing at a remote URL/);
  });

  // Rollup keeps a URL specifier as an external, so the import reaches the chunk.
  it('fails the build on a static import from a remote URL', async () => {
    const page = '<script type="module" src="./main.js"></script>';
    await expect(buildPage(page, 'import "https://example.com/remote.js";\n'))
      .rejects.toThrow(/\.js: a static import or re-export from a remote URL/);
  });

  it('passes a page with only bundled scripts', async () => {
    await expect(buildPage('<script type="module" src="./main.js"></script>')).resolves.toBeDefined();
  });
});
