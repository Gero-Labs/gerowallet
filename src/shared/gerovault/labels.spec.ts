// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { displayLabel, readLabel, writeLabel } from './labels';

const ISOLATE = (inner: string) => `\u2068${inner}\u2069`;

describe('labels: the read rule', () => {
  it('accepts any well-formed text of at most 64 bytes without control characters', () => {
    for (const ok of ['Alice', 'x'.repeat(64), '\u00E9'.repeat(32), 'Alice\u202Eecila', '\u2067Bob\u2069', 'Ca\u200Brol', '\u0378', '\uE000', '\u3164', 'line\u2028sep', '']) {
      expect(readLabel(ok)).toBe(ok);
    }
  });

  it('refuses control characters, more than 64 bytes and anything not well-formed', () => {
    for (const bad of ['line\nbreak', 'tab\there', 'nul\u0000', 'c1\u0085', 'del\u007F', 'x'.repeat(65), '\u00E9'.repeat(33), 'lone\uD800', 42, undefined]) {
      expect(readLabel(bad)).toBeUndefined();
    }
  });
});

describe('labels: the write rule', () => {
  it('writes the NFC form', () => {
    expect(writeLabel('Ame\u0301lie')).toBe('Am\u00E9lie');
    expect(writeLabel('Treasurer')).toBe('Treasurer');
    expect(writeLabel('\u{1F512} Vault')).toBe('\u{1F512} Vault');
  });

  it('refuses format, separator, private-use, unassigned and control characters, fillers, empty and oversized labels', () => {
    for (const bad of [
      'Alice\u202Eecila', // right-to-left override (Cf)
      '\u2067Bob\u2069', // isolates (Cf)
      'Ca\u200Brol', // zero-width space (Cf)
      'soft\u00ADhyphen', // Cf
      'line\u2028sep', // Zl
      'para\u2029sep', // Zp
      'private\uE000', // Co
      'unassigned\u0378', // Cn
      '\u3164', // Hangul filler
      'half\uFFA0width',
      'tab\there',
      '',
      'x'.repeat(65),
      'lone\uD800',
      42,
    ]) {
      expect(() => writeLabel(bad)).toThrow(expect.objectContaining({ code: 'INVALID_LABEL' }));
    }
  });

  it('writes only what the read rule accepts', () => {
    for (const ok of ['Alice', 'Ame\u0301lie', '\u{1F512}', 'x'.repeat(64)]) expect(readLabel(writeLabel(ok))).toBe(writeLabel(ok));
  });
});

describe('labels: display', () => {
  it('isolates every label for bidirectional text', () => {
    expect(displayLabel('Alice')).toBe(ISOLATE('Alice'));
    expect(displayLabel('\u05D0\u05D1')).toBe(ISOLATE('\u05D0\u05D1'));
  });

  it('shows format, unassigned, private-use, separator characters and fillers as visible escapes', () => {
    expect(displayLabel('Alice\u202Eecila')).toBe(ISOLATE('Alice[U+202E]ecila'));
    expect(displayLabel('\u2067Bob\u2069')).toBe(ISOLATE('[U+2067]Bob[U+2069]'));
    expect(displayLabel('Ca\u200Brol')).toBe(ISOLATE('Ca[U+200B]rol'));
    expect(displayLabel('new\u0378')).toBe(ISOLATE('new[U+0378]'));
    expect(displayLabel('pua\u{F0000}')).toBe(ISOLATE('pua[U+F0000]'));
    expect(displayLabel('\u3164')).toBe(ISOLATE('[U+3164]'));
    expect(displayLabel('a\u2028b')).toBe(ISOLATE('a[U+2028]b'));
    expect(displayLabel('a\nb')).toBe(ISOLATE('a[U+000A]b'));
    expect(displayLabel(undefined)).toBe(ISOLATE(''));
  });

  it('leaves no character that could break out of the isolation', () => {
    const hostile = '\u2069\u202E\u2066\u200F\u061C';
    const shown = displayLabel(hostile);
    expect(shown.slice(1, -1)).toBe('[U+2069][U+202E][U+2066][U+200F][U+061C]');
    expect(/[\u2066-\u2069\u202A-\u202E\u200E\u200F\u061C]/.test(shown.slice(1, -1))).toBe(false);
  });
});
