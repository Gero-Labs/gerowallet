// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { describeInteropFailure, runBackgroundInteropCheck } from './check-background-interop.mjs';

describe('the background bundle\'s CommonJS interop', () => {
  // A real build of a small entry with vite.config.background.mts, run in a VM.
  it('gives @subsquid/scale-codec a callable assert, as the Midnight address codecs need', async () => {
    expect(describeInteropFailure(await runBackgroundInteropCheck())).toBe('');
  }, 180_000);
});

describe('describeInteropFailure', () => {
  it('accepts the encoding and the refusal the codec makes with a working assert', () => {
    expect(describeInteropFailure({ encoded: [4], refused: 'invalid compact' })).toBe('');
  });

  it('names what went wrong otherwise', () => {
    expect(describeInteropFailure(undefined)).toMatch('never ran');
    expect(describeInteropFailure({ encoded: [], refused: 'invalid compact' })).toMatch('expected [4]');
    expect(describeInteropFailure({ encoded: [4], refused: '' })).toMatch('was not refused');
  });
});
