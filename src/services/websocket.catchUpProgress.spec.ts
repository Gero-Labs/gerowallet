import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catchUpProgressText } from './websocket.service';

const ROOT = join(__dirname, '..', '..');

describe('catch-up progress text', () => {
  it('formats server counts as plain text', () => {
    expect(catchUpProgressText(12, 40)).toBe('Syncing wallet data...\n12/40 transactions');
  });

  it('never carries server-supplied markup', () => {
    expect(catchUpProgressText('<form action="https://x">', 40)).toBeNull();
    expect(catchUpProgressText(12, '40<img src=x>')).toBeNull();
    expect(catchUpProgressText({ toString: () => '<b>' }, 40)).toBeNull();
  });

  it('rejects unusable counts', () => {
    for (const [sent, total] of [[0, 40], [12, 0], [-1, 40], [1.5, 40], [Infinity, 40], [12, NaN], [undefined, 40]]) {
      expect(catchUpProgressText(sent, total)).toBeNull();
    }
  });

  it('clamps sent to total', () => {
    expect(catchUpProgressText(50, 40)).toBe('Syncing wallet data...\n40/40 transactions');
  });

  it('the options overlay renders its text as text, not HTML', () => {
    const app = readFileSync(join(ROOT, 'src/options/App.vue'), 'utf8');
    const overlay = app.slice(app.indexOf('<v-overlay'), app.indexOf('</v-overlay>'));
    expect(overlay).not.toContain('v-html');
    expect(overlay).toContain('{{ text }}');
  });

  it('extension pages forbid form posts and <base>', () => {
    const manifest = readFileSync(join(ROOT, 'scripts/manifest.ts'), 'utf8');
    expect(manifest).toContain("`form-action 'none'`");
    expect(manifest).toContain("`base-uri 'none'`");
  });
});
