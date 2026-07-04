/**
 * Filename for the encrypted MPC recovery-share download (Plan D, Task 7).
 * Kept as a tiny pure function so it's independently unit-testable without
 * mounting the Vue component (which needs the crypto download side effect).
 */
export function recoveryFileName(walletId: number): string {
  return `gero-recovery-${walletId}.gmpc`;
}
