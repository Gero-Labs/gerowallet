/**
 * Formatting and utility helpers for the perpetuals trading UI.
 *
 * Extracted from PerpetualsDialog.vue so they can be reused across
 * any perps-related component without duplication.
 */
export function usePerpsFormatters() {

  /**
   * Format a price value with 2–5 decimal places, using locale grouping.
   */
  function formatPrice(val: string | number | undefined): string {
    if (val === undefined || val === null || val === '') return '—';
    const n = parseFloat(String(val));
    if (isNaN(n)) return '—';
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 });
  }

  /**
   * Format a number with exactly 2 decimal places, using locale grouping.
   */
  function formatFullNumber(val: string | number | undefined): string {
    if (val === undefined || val === null || val === '') return '—';
    const n = parseFloat(String(val));
    if (isNaN(n)) return '—';
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /**
   * Format a 24h percentage change with sign prefix and 2 decimals.
   */
  function formatChange(val: string | undefined): string {
    if (!val) return '0.00';
    const n = parseFloat(val);
    return (n >= 0 ? '+' : '') + n.toFixed(2);
  }

  /**
   * Format a funding rate (decimal) as a signed percentage with 4 decimals.
   */
  function formatFundingRate(val: string | undefined): string {
    if (!val) return '0.0000%';
    const n = parseFloat(val) * 100;
    return (n >= 0 ? '+' : '') + n.toFixed(4) + '%';
  }

  /**
   * Format a balance string to 2 fixed decimal places.
   */
  function formatBalance(val: string | undefined): string {
    if (!val) return '0.00';
    const n = parseFloat(val);
    if (isNaN(n)) return '0.00';
    return n.toFixed(2);
  }

  /**
   * Format a timestamp (epoch ms or ISO string) as a full locale date/time.
   */
  function formatTime(val: number | string | undefined): string {
    if (!val) return '—';
    const ts = typeof val === 'number' ? val : Date.parse(val);
    if (isNaN(ts)) return String(val);
    return new Date(ts).toLocaleString();
  }

  /**
   * Format a trade timestamp (epoch ms) as HH:MM:SS.
   */
  function formatTradeTime(val: number | undefined): string {
    if (!val) return '—';
    const d = new Date(val);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

  /**
   * Format an order-book size value as a locale integer (no decimals).
   */
  function formatOBSize(val: string): string {
    const n = parseFloat(val);
    if (isNaN(n)) return val;
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  /**
   * Snap a numeric value down to the nearest step size.
   * Per Integrator Guide Section 10.6: floor(value / step) * step,
   * formatted with the correct number of decimals from the step string.
   */
  function snapToStep(value: number, step: string): string {
    const s = parseFloat(step);
    if (!s || s <= 0) return String(value);
    const snapped = Math.floor(value / s) * s;
    const decimals = step.includes('.') ? step.split('.')[1].length : 0;
    return snapped.toFixed(decimals);
  }

  /**
   * Format a raw numeric string for display in a currency input field,
   * adding thousand-separator commas to the integer part.
   */
  function formatCurrencyInput(val: string): string {
    if (!val) return '';
    const parts = val.split('.');
    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.length > 1 ? `${intPart}.${parts[1]}` : intPart;
  }

  /**
   * Parse a formatted currency input back to a plain numeric string,
   * stripping commas and non-numeric characters (except a single dot).
   */
  function parseCurrencyInput(val: string): string {
    const cleaned = val.replace(/,/g, '').replace(/[^\d.]/g, '');
    // Allow only one decimal point
    const parts = cleaned.split('.');
    if (parts.length > 2) return parts[0] + '.' + parts.slice(1).join('');
    return cleaned;
  }

  return {
    formatPrice,
    formatFullNumber,
    formatChange,
    formatFundingRate,
    formatBalance,
    formatTime,
    formatTradeTime,
    formatOBSize,
    snapToStep,
    formatCurrencyInput,
    parseCurrencyInput,
  };
}
