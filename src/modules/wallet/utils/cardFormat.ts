import i18n, { getLocaleCode } from '@/plugins/i18n';

/** BCP 47 tag for the wallet's UI language ('de' → 'de-DE'). */
export function uiLocale(): string {
  return getLocaleCode(String(i18n.locale));
}

/** A card amount in the card's own currency, formatted for the UI language: €250.00 / 250,00 €. */
export function cardMoney(amount: number, currency = 'EUR'): string {
  try {
    return new Intl.NumberFormat(uiLocale(), { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
  } catch {
    // An unknown currency code from the provider: show it as text rather than fail.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** An ADA quantity with two decimals in the UI language (no symbol). */
export function adaFigure(value: number): string {
  return new Intl.NumberFormat(uiLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
