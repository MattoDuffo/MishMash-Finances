/**
 * Finds recurring bills, subscriptions and income in transaction history,
 * and predicts the next occurrences. Everything is inferred from imported
 * data; nothing is looked up online.
 */
import type { Category, Id, IsoDate, Minor, Transaction } from './types';
import { payeeKey } from './payee';
import { addDays, addMonthsToDate, daysBetween } from './dates';

export type Cadence = 'weekly' | 'fortnightly' | 'twice-monthly' | 'monthly' | 'quarterly' | 'yearly';

const CADENCES: { cadence: Cadence; days: number; tol: number; months?: number }[] = [
  { cadence: 'weekly', days: 7, tol: 1 },
  { cadence: 'fortnightly', days: 14, tol: 2 },
  { cadence: 'twice-monthly', days: 15.2, tol: 2.5 },
  { cadence: 'monthly', days: 30.4, tol: 4, months: 1 },
  { cadence: 'quarterly', days: 91, tol: 8, months: 3 },
  { cadence: 'yearly', days: 365, tol: 12, months: 12 },
];

export interface Recurring {
  key: string;
  payee: string;
  accountId: Id;
  categoryId: Id | null;
  cadence: Cadence;
  amount: Minor; // latest amount
  typicalAmount: Minor;
  variable: boolean;
  lastDate: IsoDate;
  nextDate: IsoDate;
  occurrences: number;
  isIncome: boolean;
  isSubscription: boolean;
  /** Money moving between your own accounts (e.g. card payments, savings). */
  isTransfer: boolean;
  priceChange: { from: Minor; to: Minor; date: IsoDate } | null;
  firstDate: IsoDate;
  /** Day of month the charge normally lands on (monthly and longer cadences). */
  anchorDay?: number;
  /** The two days of the month for twice-monthly items, e.g. [1, 15]. */
  anchorDays?: [number, number];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function nextAfter(date: IsoDate, cadence: Cadence, anchorDay?: number, anchorDays?: [number, number]): IsoDate {
  const c = CADENCES.find((x) => x.cadence === cadence)!;
  if (cadence === 'twice-monthly' && anchorDays) {
    const [a, b] = anchorDays;
    const day = Number(date.slice(8, 10));
    return day < (a + b) / 2 ? addMonthsToDate(date, 0, b) : addMonthsToDate(date, 1, a);
  }
  return c.months ? addMonthsToDate(date, c.months, anchorDay) : addDays(date, c.days);
}

export function detectRecurring(txns: Transaction[], today: IsoDate, categories: Category[] = []): Recurring[] {
  const groupOf = new Map(categories.map((c) => [c.id, c.group]));
  const nameOf = new Map(categories.map((c) => [c.id, c.name.toLowerCase()]));
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.transferId) continue;
    const key = `${t.accountId}|${payeeKey(t.payee)}|${t.amount > 0 ? 'in' : 'out'}`;
    if (!payeeKey(t.payee)) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const found: Recurring[] = [];
  for (const [key, list] of groups) {
    // One charge per date (ignore same-day duplicates for cadence).
    const byDate = [...new Map(list.sort((a, b) => a.date.localeCompare(b.date)).map((t) => [t.date, t])).values()];
    if (byDate.length < 2) continue;
    const gaps = byDate.slice(1).map((t, i) => daysBetween(byDate[i].date, t.date));
    const med = median(gaps);
    // Paid on two fixed days a month (e.g. 1st and 15th) vs every 14 days.
    const dom = byDate.map((t) => Number(t.date.slice(8, 10)));
    // Split the days of month into two groups at the widest gap.
    const uniq = [...new Set(dom)].sort((a, b) => a - b);
    let cut = uniq[0];
    let widest = -1;
    for (let i = 1; i < uniq.length; i++) {
      if (uniq[i] - uniq[i - 1] > widest) {
        widest = uniq[i] - uniq[i - 1];
        cut = uniq[i - 1];
      }
    }
    const lowDays = dom.filter((d) => d <= cut);
    const highDays = dom.filter((d) => d > cut);
    const tight = (xs: number[]) => xs.length > 0 && Math.max(...xs) - Math.min(...xs) <= 3;
    const semi = med >= 13 && med <= 17.5 && tight(lowDays) && tight(highDays);
    const c = semi ? CADENCES.find((x) => x.cadence === 'twice-monthly')! : CADENCES.find((x) => x.cadence !== 'twice-monthly' && Math.abs(med - x.days) <= x.tol);
    if (!c) continue;
    const anchorDays: [number, number] | undefined = semi ? [Math.round(median(lowDays)), Math.round(median(highDays))] : undefined;
    const fit = gaps.filter((g) => Math.abs(g - c.days) <= c.tol * 1.5).length / gaps.length;
    const minCount = c.cadence === 'yearly' || c.cadence === 'quarterly' ? 2 : 3;
    if (byDate.length < minCount || fit < 0.7) continue;

    const amounts = byDate.map((t) => t.amount);
    const typical = Math.round(median(amounts));
    const spread = Math.max(...amounts.map((a) => Math.abs(a - typical))) / Math.max(1, Math.abs(typical));
    const variable = spread > 0.15;
    const last = byDate[byDate.length - 1];
    const anchorDay = Math.round(median(byDate.map((t) => Number(t.date.slice(8, 10)))));
    const step = (d: IsoDate) => nextAfter(d, c.cadence, c.months ? anchorDay : undefined, anchorDays);
    let next = step(last.date);
    // Stopped: more than 1.5 intervals since the last charge.
    if (daysBetween(last.date, today) > c.days * 1.5 + c.tol) continue;
    while (next < today) next = step(next);

    let priceChange: Recurring['priceChange'] = null;
    if (!variable && byDate.length >= 2) {
      const prev = byDate[byDate.length - 2];
      if (Math.abs(last.amount) > Math.abs(prev.amount) && Math.abs(last.amount - prev.amount) >= Math.max(1, Math.abs(prev.amount) * 0.01)) {
        priceChange = { from: prev.amount, to: last.amount, date: last.date };
      }
    }
    // Weekly shopping varies too much to be a "bill".
    if (variable && (c.cadence === 'weekly' || c.cadence === 'fortnightly')) continue;
    const group = last.categoryId ? groupOf.get(last.categoryId) : undefined;
    // Varying amounts only count for bills (utilities) and income, not
    // for places you happen to visit about once a month.
    if (variable && group && group !== 'bills' && group !== 'income') continue;
    const isIncome = last.amount > 0;
    const catName = last.categoryId ? (nameOf.get(last.categoryId) ?? '') : '';
    const subscriptionLike =
      catName.includes('subscri') || (!variable && (c.cadence === 'monthly' || c.cadence === 'yearly') && Math.abs(typical) < 20000 && (!group || group === 'lifestyle'));
    found.push({
      key,
      payee: last.payee,
      accountId: last.accountId,
      categoryId: last.categoryId,
      cadence: c.cadence,
      amount: last.amount,
      typicalAmount: typical,
      variable,
      lastDate: last.date,
      nextDate: next,
      occurrences: byDate.length,
      isIncome,
      isSubscription: !isIncome && group !== 'transfer' && subscriptionLike,
      isTransfer: group === 'transfer' || Boolean(last.transferId),
      priceChange,
      firstDate: byDate[0].date,
      anchorDay: c.months ? anchorDay : undefined,
      anchorDays,
    });
  }
  return found.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

export interface Occurrence {
  date: IsoDate;
  item: Recurring;
}

/** Expected occurrences between two dates (inclusive). */
export function upcoming(items: Recurring[], from: IsoDate, to: IsoDate): Occurrence[] {
  const out: Occurrence[] = [];
  for (const item of items) {
    for (let d = item.nextDate; d <= to; d = nextAfter(d, item.cadence, item.anchorDay, item.anchorDays)) if (d >= from) out.push({ date: d, item });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** What the next charge will probably be: the latest price unless amounts vary. */
export function expectedAmount(r: Recurring): Minor {
  return r.variable ? r.typicalAmount : r.amount;
}

/** Monthly cost of a recurring item, for subscription totals. */
export function monthlyCost(r: Recurring): Minor {
  const per = { weekly: 52 / 12, fortnightly: 26 / 12, 'twice-monthly': 2, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[r.cadence];
  return Math.round(expectedAmount(r) * per);
}
