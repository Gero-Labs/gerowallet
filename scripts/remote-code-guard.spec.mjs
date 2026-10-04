import { describe, expect, it } from 'vitest';
import { findRemoteCode, isScannable } from './remote-code-guard.mjs';

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

  it('flags remote importScripts() and dynamic import()', () => {
    expect(reasons("importScripts('https://example.com/worker.js')")).toEqual(['importScripts() of a remote URL']);
    expect(reasons('await import(`https://example.com/mod.js`)')).toEqual(['dynamic import() of a remote URL']);
  });

  it('flags a script CDN URL on its own', () => {
    expect(reasons('const src = "https://unpkg.com/lib@1/dist/lib.min.js";')).toEqual(['a JavaScript CDN URL']);
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
