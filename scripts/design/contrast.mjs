// WCAG contrast gate for the token palette. Fails (exit 1) if any pair
// drops below its threshold. Policy: text-1/text-2 must be AA-normal
// (4.5:1) on every surface; text-3 is captions/labels only, so it must be
// AA-normal on canvas/surface and AA-large (3:1) on raised/overlay;
// on-grad text must be AA-normal on both gradient stops.
const T = {
  canvas: '#000000', surface: '#0C0E12', raised: '#12151B', overlay: '#1A1E26',
  text1: '#F7F8F9', text2: '#B8BCC4', text3: '#7A8088',
  accent: '#33C7DD', onGrad: '#06181B', grad1: '#00DFF3', grad2: '#00FAD5',
  error: '#F97066', success: '#47CD89', warning: '#FDB022', info: '#7AA7FF',
};
// EVERY chain's flat accent and gradient stops are used as text/focus/CTA-text
// backing across all surfaces, so all get checked.
// Keep in sync with chainAccents in src/config/themes.ts.
const CHAIN = {
  cardanoAccent: '#33C7DD', bitcoinAccent: '#F7931A', apexAccent: '#E06030', midnightAccent: '#8B7CF6',
  bitcoinGrad1: '#F7931A', bitcoinGrad2: '#FFB84D',
  apexGrad1: '#E06030', apexGrad2: '#F08040',
  midnightGrad1: '#8B7CF6', midnightGrad2: '#B49CFF',
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
