import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The design system's disabled button (raised fill, muted text, hairline border)
// for every GButton tier and the bare `.geroButton` CTA, disabled or only
// aria-disabled. Rendered before/after in the PR; this pins the rule.
const baseline = readFileSync(join(__dirname, 'baseline.css'), 'utf8');
const gbutton = readFileSync(join(__dirname, '../components/GButton/GButton.vue'), 'utf8');

const ruleFor = (selectorPart: string): string => {
  const at = baseline.indexOf(selectorPart);
  expect(at, selectorPart).toBeGreaterThan(-1);
  return baseline.slice(at, baseline.indexOf('}', at) + 1);
};

describe('disabled buttons', () => {
  it('one rule covers .geroButton and every GButton tier, disabled or aria-disabled', () => {
    const rule = ruleFor(':is(.v-application, .v-overlay-container) .v-btn.geroButton.v-btn--disabled,');
    for (const selector of [
      '.v-btn.geroButton:disabled',
      '.v-btn.geroButton[aria-disabled="true"]',
      '.v-btn.g-btn.v-btn--disabled:not(.v-btn--loading)',
      '.v-btn.g-btn[aria-disabled="true"]',
    ]) expect(rule).toContain(selector);
    expect(rule).toContain('background: var(--g-raised) !important;');
    expect(rule).toContain('color: var(--g-text-3) !important;');
    expect(rule).toContain('border: 1px solid var(--g-hairline-1);');
    // Undoes Vuetify's 26% opacity (its rules sit in a cascade layer, so no flag is needed).
    expect(rule).toContain('opacity: 1;');
  });

  it("removes Vuetify's grey overlay on disabled buttons", () => {
    const rule = ruleFor('.v-btn.geroButton:is(.v-btn--disabled, :disabled, [aria-disabled="true"]) .v-btn__overlay');
    expect(rule).toContain('.v-btn.g-btn:is(.v-btn--disabled, [aria-disabled="true"]) .v-btn__overlay');
    expect(rule).toContain('opacity: 0;');
  });

  it('GButton keeps no disabled rule of its own to drift from it', () => {
    expect(gbutton).not.toMatch(/\.v-btn--disabled[^{]*\{/);
  });
});
