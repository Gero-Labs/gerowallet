import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { createDevEntryHtml } from './dev-entry-html';

const parserWindow = new Window({ settings: {
  disableCSSFileLoading: true,
  disableJavaScriptFileLoading: true,
  disableJavaScriptEvaluation: true,
} });
afterAll(() => parserWindow.close());

describe('extension development HTML', () => {
  it.each(['options', 'sidepanel'] as const)('loads %s source styles and HMR from the dev server', (entry) => {
    const source = readFileSync(resolve('src', entry, 'index.html'), 'utf8');
    const html = createDevEntryHtml(source, entry, 3303);
    const document = new parserWindow.DOMParser().parseFromString(html, 'text/html');
    const firstStyle = document.querySelector('link[rel="stylesheet"]');
    expect(firstStyle?.getAttribute('href')).toBe('http://localhost:3303/shared/styles/vuetify-layers.css?no-inline');
    expect(firstStyle?.getAttribute('media')).toBe('all');
    const scripts = [...document.querySelectorAll('script[type="module"]')].map(script => script.getAttribute('src'));
    expect(scripts).toEqual(['http://localhost:3303/@vite/client', `http://localhost:3303/${entry}/main.ts`]);
    expect(document.querySelector('link[href="/vendor/gero-swap/gero-swap.css"]')).not.toBeNull();
    expect(document.querySelector('script[src="/vendor/gero-swap/gero-swap.js"]')).not.toBeNull();
    // The source remains suitable for a production build, without localhost.
    expect(source).not.toContain('http://localhost:3303');
  });

  it('resolves relative styles with a custom port while preserving external and extension assets', () => {
    const html = createDevEntryHtml(`<head><link href='./local.css?direct'><link href='../shared/base.css'>
      <link href='/vendor/widget.css'><link href='https://example.com/theme.css'></head>
      <script type="module" src="./main.ts"></script><div id="app"></div>`, 'sidepanel', 4404);
    const document = new parserWindow.DOMParser().parseFromString(html, 'text/html');
    expect([...document.querySelectorAll('link')].map(link => link.getAttribute('href'))).toEqual([
      'http://localhost:4404/sidepanel/local.css?direct',
      'http://localhost:4404/shared/base.css',
      '/vendor/widget.css',
      'https://example.com/theme.css',
    ]);
    expect(document.querySelector('#app')?.textContent).toBe('Vite server did not start');
  });
});
