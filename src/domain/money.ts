import type { Minor } from './types';

/** Minor-unit digits for currencies that don't use 2. */
const EXPONENTS: Record<string, number> = { JPY: 0, KRW: 0, VND: 0, ISK: 0, BHD: 3, KWD: 3, OMR: 3, TND: 3 };

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

/**
 * Parses user-typed or CSV amounts into minor units.
 * Accepts "1,234.56", "-12.5", "(45.00)" (accounting negative), "$10",
 * "1.234,56" (European) and a trailing minus "12.00-".
 * Returns null if the text is not a number.
 */
export function parseAmount(input: string, currency = 'USD'): Minor | null {
  let s = input.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  s = s.replace(/[^\d.,\-+]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!s || /[-+]/.test(s)) return null;

  let intPart = s;
  let fracPart = '';
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot || hasComma) {
    let dec: string | null;
    if (hasDot && hasComma) {
      // Both present: whichever comes last is the decimal mark.
      dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    } else {
      const sep = hasDot ? '.' : ',';
      const parts = s.split(sep);
      // Repeated separator ("1,234,567") or a comma followed by exactly three
      // digits ("1,234") is a thousands separator; otherwise it's decimal.
      const thousands = parts.length > 2 || (sep === ',' && parts[1].length === 3);
      dec = thousands ? null : sep;
    }
    if (dec) {
      const idx = s.lastIndexOf(dec);
      intPart = s.slice(0, idx);
      fracPart = s.slice(idx + 1);
    }
    intPart = intPart.replace(/[.,]/g, '');
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart) || (!intPart && !fracPart)) return null;

  const exp = currencyExponent(currency);
  const frac = (fracPart + '0'.repeat(exp)).slice(0, exp);
  // Round half up on any extra digits.
  const roundUp = fracPart.length > exp && Number(fracPart[exp]) >= 5 ? 1 : 0;
  const value = Number(intPart || '0') * 10 ** exp + Number(frac || '0') + roundUp;
  return negative ? -value : value;
}

/** Shows each currency the way it's written at home, e.g. SGD as $12.50. */
const HOME_LOCALE: Record<string, string> = {
  SGD: 'en-SG',
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'en-IE',
  AUD: 'en-AU',
  NZD: 'en-NZ',
  CAD: 'en-CA',
  MYR: 'en-MY',
  HKD: 'en-HK',
  INR: 'en-IN',
};

/** The locale a currency is normally written in, if known. */
export function homeLocale(currency: string): string | undefined {
  return HOME_LOCALE[currency.toUpperCase()];
}

export function formatMoney(amount: Minor, currency = 'SGD', locale?: string): string {
  const exp = currencyExponent(currency);
  try {
    return new Intl.NumberFormat(locale ?? HOME_LOCALE[currency.toUpperCase()], {
      style: 'currency',
      currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(amount / 10 ** exp);
  } catch {
    return `${(amount / 10 ** exp).toFixed(exp)} ${currency}`;
  }
}
