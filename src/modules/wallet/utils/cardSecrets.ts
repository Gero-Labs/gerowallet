/**
 * Input rules for the two secrets a cardholder types into the wallet: the number printed
 * on a delivered physical card (to activate it) and a new PIN. Neither value is stored or
 * logged; these helpers only shape and check what the user typed.
 */

/** Digits of a typed card number, capped at the 19 the provider accepts. */
export function panDigits(input: string): string {
  return input.replace(/\D/g, '').slice(0, 19);
}

/** Groups of four for display: "5375 2410 8805 4121". */
export function formatPan(digits: string): string {
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** 16-19 digits (the provider's rule) that also pass the Luhn checksum every card number carries. */
export function isValidPan(digits: string): boolean {
  if (!/^\d{16,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export type PinProblem = 'length' | 'weak' | 'mismatch';

/**
 * Why a new PIN cannot be saved, or null when it can. Weak means one repeated digit or a
 * straight run (1234, 9876): the first guesses anyone tries.
 */
export function pinProblem(pin: string, confirm: string): PinProblem | null {
  if (!/^\d{4}$/.test(pin)) return 'length';
  const steps = [1, 2, 3].map(i => Number(pin[i]) - Number(pin[i - 1]));
  if (steps.every(s => s === 0) || steps.every(s => s === 1) || steps.every(s => s === -1)) return 'weak';
  if (pin !== confirm) return 'mismatch';
  return null;
}
