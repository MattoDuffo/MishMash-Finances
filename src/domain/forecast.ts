import type { Account, Minor, Transaction, IsoDate } from './types';
import { CASH_KINDS } from './types';
import { upcoming, expectedAmount, type Recurring } from './recurring';
import { addDays } from './dates';

export interface ForecastDay {
  date: IsoDate;
  balance: Minor;
  events: { payee: string; amount: Minor }[];
}

/**
 * Projects the combined balance of cash accounts (checking, savings, cash)
 * forward using detected recurring items in those accounts.
 */
export function cashForecast(accounts: Account[], txns: Transaction[], recurring: Recurring[], today: IsoDate, days = 60) {
  const cash = accounts.filter((a) => !a.archived && CASH_KINDS.includes(a.kind));
  const ids = new Set(cash.map((a) => a.id));
  let balance = cash.reduce((n, a) => n + a.openingBalance, 0);
  for (const t of txns) if (ids.has(t.accountId) && t.date <= today) balance += t.amount;
  const start = balance;
  const end = addDays(today, days);
  // Regular transfers between two cash accounts cancel out; leave them out.
  const inCash = recurring.filter((r) => ids.has(r.accountId));
  const internal = new Set(
    inCash.filter((r) => inCash.some((o) => o !== r && o.accountId !== r.accountId && o.typicalAmount === -r.typicalAmount && o.cadence === r.cadence)).map((r) => r.key),
  );
  const events = upcoming(inCash.filter((r) => !internal.has(r.key)), addDays(today, 1), end);
  const series: ForecastDay[] = [{ date: today, balance, events: [] }];
  let i = 0;
  for (let d = addDays(today, 1); d <= end; d = addDays(d, 1)) {
    const todays: ForecastDay['events'] = [];
    while (i < events.length && events[i].date === d) {
      todays.push({ payee: events[i].item.payee, amount: expectedAmount(events[i].item) });
      balance += expectedAmount(events[i].item);
      i++;
    }
    series.push({ date: d, balance, events: todays });
  }
  const lowest = series.reduce((m, d) => (d.balance < m.balance ? d : m), series[0]);
  return { start, series, lowest, end: balance, currency: cash[0]?.currency ?? 'USD' };
}
