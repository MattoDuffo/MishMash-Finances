import type { IsoDate } from '../domain/types';

/** Supported date formats, named the way users will recognise them. */
export const DATE_FORMATS = [
  'YYYY-MM-DD',
  'MM/DD/YYYY',
  'DD/MM/YYYY',
  'MM/DD/YY',
  'DD/MM/YY',
  'DD.MM.YYYY',
  'YYYY/MM/DD',
  'YYYYMMDD',
  'D MMM YYYY',
  'MMM D, YYYY',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function build(y: number, m: number, d: number): IsoDate | null {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // e.g. 31 Feb
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseDate(input: string, format: string): IsoDate | null {
  const s = input.trim().split(/[ T](?=\d{1,2}:)/)[0]; // drop a time part
  let m: RegExpMatchArray | null;
  switch (format) {
    case 'YYYY-MM-DD':
      m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      return m ? build(+m[1], +m[2], +m[3]) : null;
    case 'YYYY/MM/DD':
      m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
      return m ? build(+m[1], +m[2], +m[3]) : null;
    case 'YYYYMMDD':
      m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
      return m ? build(+m[1], +m[2], +m[3]) : null;
    case 'MM/DD/YYYY':
    case 'MM/DD/YY':
      m = s.match(format === 'MM/DD/YYYY' ? /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/ : /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
      return m ? build(+m[3], +m[1], +m[2]) : null;
    case 'DD/MM/YYYY':
    case 'DD/MM/YY':
      m = s.match(format === 'DD/MM/YYYY' ? /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/ : /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
      return m ? build(+m[3], +m[2], +m[1]) : null;
    case 'DD.MM.YYYY':
      m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
      return m ? build(+m[3], +m[2], +m[1]) : null;
    case 'D MMM YYYY': {
      m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -,]*(\d{2,4})$/);
      const mi = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
      return m && mi >= 0 ? build(+m[3], mi + 1, +m[1]) : null;
    }
    case 'MMM D, YYYY': {
      m = s.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/);
      const mi = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
      return m && mi >= 0 ? build(+m[3], mi + 1, +m[2]) : null;
    }
  }
  return null;
}

/**
 * Returns every format that parses all the samples, best guess first.
 * MM/DD vs DD/MM is settled by any day above 12; if none, both are returned
 * with `preferDayFirst` deciding the order.
 */
export function detectDateFormats(samples: string[], preferDayFirst = false): DateFormat[] {
  const vals = samples.map((s) => s.trim()).filter(Boolean);
  if (vals.length === 0) return [];
  const ok = DATE_FORMATS.filter((f) => vals.every((v) => parseDate(v, f) !== null));
  if (preferDayFirst) {
    ok.sort((a, b) => Number(b.startsWith('DD')) - Number(a.startsWith('DD')));
  }
  return ok;
}
