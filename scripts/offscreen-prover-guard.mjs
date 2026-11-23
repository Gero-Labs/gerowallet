/**
 * The offscreen Midnight prover page must load no other chunk of the app.
 *
 * An offscreen document has `chrome.runtime` and no other extension API. The
 * wallet's stores read `chrome.storage` while their modules load, so a store
 * chunk imported by that page throws before the page's own code runs: the page
 * never opens its port to the background, and every on-device proof ends in
 * "The Midnight prover did not start".
 *
 * That happened without a line of the page's source changing. Vite's
 * modulepreload polyfill is one small module shared by every HTML entry, and
 * `experimentalMinChunkSize` (vite.config.mts) merged it into a chunk that
 * imports the stores. The polyfill is off now; this fails the build if the page
 * ever imports a chunk again, whatever the reason.
 */

/** The page, relative to the repository root. vite.config.mts builds it from this path. */
export const OFFSCREEN_PROVER_PAGE = 'src/offscreen/midnight-prover.html';

const isProverPage = (id) => typeof id === 'string' && id.replace(/\\/g, '/').endsWith(`/${OFFSCREEN_PROVER_PAGE}`);

/**
 * The chunks the prover page's entry imports as it loads, or `undefined` when
 * this build has no such page (the background, content and inject builds).
 */
export function offscreenProverImports(bundle) {
  const entry = Object.values(bundle).find((file) => file.type === 'chunk' && file.isEntry && isProverPage(file.facadeModuleId));
  return entry ? [...entry.imports] : undefined;
}

/** Vite plugin: fails a build whose prover page imports any chunk. */
export const offscreenProverStandsAlone = {
  name: 'offscreen-prover-stands-alone',
  apply: 'build',
  generateBundle(_options, bundle) {
    const imports = offscreenProverImports(bundle);
    if (imports?.length) {
      this.error(
        `The offscreen prover page (${OFFSCREEN_PROVER_PAGE}) imports ${imports.join(', ')}. It must import no other chunk: `
        + 'app code throws in an offscreen document and the Midnight prover then never starts.',
      );
    }
  },
};
