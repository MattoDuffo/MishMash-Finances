import type { IsoDate, MonthKey } from './types';

export const monthOf = (d: IsoDate): MonthKey => d.slice(0, 7);

export function addMonths(m: MonthKey, n: number): MonthKey {
  const [y, mo] = m.split('-').map(Number);
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export function monthsBetween(a: MonthKey, b: MonthKey): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

export function toIso(d: Date): IsoDate {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return toIso(t);
}

/** Adds months keeping the day, clamped to the month's last day. */
export function addMonthsToDate(d: IsoDate, n: number, day = Number(d.slice(8, 10))): IsoDate {
  const m = addMonths(monthOf(d), n);
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${m}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export const daysBetween = (a: IsoDate, b: IsoDate) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function endOfMonth(m: MonthKey): IsoDate {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
}

export function monthLabel(m: MonthKey, style: 'short' | 'long' = 'short'): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString(undefined, style === 'short' ? { month: 'short' } : { month: 'long', year: 'numeric' });
}
