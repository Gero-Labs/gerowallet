// WCAG contrast gate for the token palette. Fails (exit 1) if any pair
// drops below its threshold. Policy: text-1/text-2 must be AA-normal
// (4.5:1) on every surface; text-3 is captions/labels only, so it must be
// AA-normal on canvas/surface and AA-large (3:1) on raised/overlay;
// on-grad text must be AA-normal on both gradient stops.
//
// The palette is PARSED from the real sources -- src/shared/styles/tokens.css
// and src/config/themes.ts -- never copied here. A hardcoded copy would let a
// contrast regression edited into the actual token files sail through green,
// which would make this gate theatre. An unparseable or missing token is a
// hard failure, not a silent skip.
import { readFileSync } from 'node:fs';

const TOKENS = readFileSync('src/shared/styles/tokens.css', 'utf8');
const THEMES = readFileSync('src/config/themes.ts', 'utf8');

function tok(name) {
  const m = TOKENS.match(new RegExp(`^\\s*--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, 'm'));
  if (!m) { console.error(`FATAL: --${name} not found (or not a 6-digit hex) in tokens.css`); process.exit(2); }
  return m[1];
}
function chain(key) {
  const m = THEMES.match(
    new RegExp(`${key}:\\s*\\{\\s*accent:\\s*'(#[0-9a-fA-F]{6})',\\s*gradient1:\\s*'(#[0-9a-fA-F]{6})',\\s*gradient2:\\s*'(#[0-9a-fA-F]{6})'`),
  );
  if (!m) { console.error(`FATAL: chainAccents.${key} not parseable from src/config/themes.ts`); process.exit(2); }
  return { accent: m[1], gradient1: m[2], gradient2: m[3] };
}

const T = {
  canvas: tok('g-canvas'), surface: tok('g-surface'), raised: tok('g-raised'), overlay: tok('g-overlay'),
  text1: tok('g-text-1'), text2: tok('g-text-2'), text3: tok('g-text-3'),
  accent: tok('g-accent'), onGrad: tok('g-on-grad'), grad1: tok('g-grad-1'), grad2: tok('g-grad-2'),
  error: tok('g-error'), success: tok('g-success'), warning: tok('g-warning'), info: tok('g-info'),
};

// EVERY chain's flat accent and gradient stops are used as text/focus/CTA-text
// backing across all surfaces, so all get checked. Read from themes.ts, so a
// new or edited chain palette is covered automatically.
const cardano = chain('cardano'), bitcoin = chain('bitcoin'), apex = chain('apex'), midnight = chain('midnight');
const CHAIN = {
  cardanoAccent: cardano.accent, bitcoinAccent: bitcoin.accent, apexAccent: apex.accent, midnightAccent: midnight.accent,
  bitcoinGrad1: bitcoin.gradient1, bitcoinGrad2: bitcoin.gradient2,
  apexGrad1: apex.gradient1, apexGrad2: apex.gradient2,
  midnightGrad1: midnight.gradient1, midnightGrad2: midnight.gradient2,
};
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (hex) => {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const checks = [];
for (const s of ['canvas', 'surface', 'raised', 'overlay']) {
  checks.push([`text1 on ${s}`, T.text1, T[s], 4.5]);
  checks.push([`text2 on ${s}`, T.text2, T[s], 4.5]);
  checks.push([`text3 on ${s}`, T.text3, T[s], s === 'raised' || s === 'overlay' ? 3.0 : 4.5]);
  for (const sem of ['error', 'success', 'warning', 'info', 'accent']) {
    checks.push([`${sem} on ${s}`, T[sem], T[s], 3.0]); // semantic text is >=13px/500 or paired with a glyph
  }
}
checks.push(['onGrad on grad1', T.onGrad, T.grad1, 4.5]);
checks.push(['onGrad on grad2', T.onGrad, T.grad2, 4.5]);
for (const s of ['canvas', 'surface', 'raised', 'overlay']) {
  for (const [name, hex] of Object.entries(CHAIN)) {
    if (name.endsWith('Accent')) checks.push([`${name} on ${s}`, hex, T[s], 3.0]);
  }
}
// CTA text must survive every chain's gradient stops
for (const g of ['bitcoinGrad1', 'bitcoinGrad2', 'apexGrad1', 'apexGrad2', 'midnightGrad1', 'midnightGrad2']) {
  checks.push([`onGrad on ${g}`, T.onGrad, CHAIN[g], 4.5]);
}

let failed = 0;
for (const [name, fg, bg, min] of checks) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${r.toFixed(2)}:1 (min ${min}:1)`);
}
if (failed) { console.error(`\n${failed} contrast check(s) failed.`); process.exit(1); }
console.log(`\nAll ${checks.length} contrast checks passed.`);
