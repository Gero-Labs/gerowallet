import { describe, it, expect } from 'vitest';
import { recoveryFileName } from './googleRecoveryFilename';

describe('recoveryFileName', () => {
  it('builds the .gmpc filename from the wallet id', () => {
    expect(recoveryFileName(42)).toBe('gero-recovery-42.gmpc');
  });

  it('never embeds anything other than the numeric wallet id', () => {
    const name = recoveryFileName(7);
    expect(name).toMatch(/^gero-recovery-\d+\.gmpc$/);
  });
});
