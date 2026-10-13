/** Extension HTML is copied, so it does not pass through Vite's HTML transform. */
export function createDevEntryHtml(source: string, entry: 'options' | 'sidepanel', port: number): string {
  const origin = `http://localhost:${port}`;
  return source
    // Connect HMR even if an outdated dependency prevents the app from importing.
    .replace('<head>', `<head>\n  <script type="module" src="${origin}/@vite/client"></script>`)
    .replace('"./main.ts"', `"${origin}/${entry}/main.ts"`)
    // Relative source styles are served by Vite. Absolute /vendor links still
    // resolve to the assets copied into the extension by copyDevAssets().
    .replace(/\bhref=(["'])(\.\.?\/[^"']+\.css(?:\?[^"']*)?)\1/g,
      (_match, quote: string, href: string) => `href=${quote}${new URL(href, `${origin}/${entry}/`).href}${quote}`)
    .replace('<div id="app"></div>', '<div id="app">Vite server did not start</div>');
}
