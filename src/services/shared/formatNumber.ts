/**
 * Format a number in German style (Mio., Mrd., Bio.)
 */
export function formatNumberDE(num: number): string {
  if (Math.abs(num) >= 1e12) return (num / 1e12).toFixed(2) + ' Bio.';
  if (Math.abs(num) >= 1e9) return (num / 1e9).toFixed(2) + ' Mrd.';
  if (Math.abs(num) >= 1e6) return (num / 1e6).toFixed(2) + ' Mio.';
  if (Math.abs(num) >= 1e3) return (num / 1e3).toFixed(1) + 'T';
  return num.toFixed(2);
}

/**
 * Format currency in German style
 */
export function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format percentage
 */
export function formatPercent(value: number, decimals = 2): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}
