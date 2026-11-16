import type { Account, IsoDate, Minor, MonthKey, Settings, Transaction, Valuation } from './types';
import { VALUED_KINDS } from './types';
import { addMonths, endOfMonth, monthOf } from './dates';

/** Balance on a date: latest valuation for valued kinds, else opening + transactions. */
export function balanceOn(a: Account, date: IsoDate, txns: Transaction[], valuations: Valuation[]): Minor {
  if (VALUED_KINDS.includes(a.kind)) {
    const vs = valuations.filter((v) => v.accountId === a.id && v.date <= date).sort((x, y) => y.date.localeCompare(x.date));
    if (vs.length) {
      // Transactions after the valuation (e.g. contributions) still count.
      return vs[0].value + txns.filter((t) => t.accountId === a.id && t.date > vs[0].date && t.date <= date).reduce((n, t) => n + t.amount, 0);
    }
    if (valuations.some((v) => v.accountId === a.id)) return 0; // valued later, not yet held
  }
  return txns.reduce((n, t) => (t.accountId === a.id && t.date <= date ? n + t.amount : n), a.openingBalance);
}

/** Converts to the base currency with the user's manual rates; null if a rate is missing. */
export function toBase(amount: Minor, currency: string, settings: Settings): Minor | null {
  if (currency === settings.baseCurrency) return amount;
  const rate = settings.exchangeRates[currency];
  return rate ? Math.round(amount * rate) : null;
}

export interface NetWorth {
  assets: Minor;
  liabilities: Minor; // negative
  net: Minor;
  missingRates: string[];
}

export function netWorthOn(accounts: Account[], date: IsoDate, txns: Transaction[], valuations: Valuation[], settings: Settings): NetWorth {
  let assets = 0;
  let liabilities = 0;
  const missing = new Set<string>();
  for (const a of accounts) {
    if (a.archived) continue;
    const b = toBase(balanceOn(a, date, txns, valuations), a.currency, settings);
    if (b === null) {
      missing.add(a.currency);
      continue;
    }
    if (b >= 0) assets += b;
    else liabilities += b;
  }
  return { assets, liabilities, net: assets + liabilities, missingRates: [...missing] };
}

export function netWorthHistory(
  accounts: Account[],
  txns: Transaction[],
  valuations: Valuation[],
  settings: Settings,
  today: IsoDate,
  months = 24,
): { month: MonthKey; net: Minor }[] {
  const firstData = [...txns.map((t) => t.date), ...valuations.map((v) => v.date)].sort()[0];
  const now = monthOf(today);
  let start = addMonths(now, -(months - 1));
  if (firstData && monthOf(firstData) > start) start = monthOf(firstData);
  const out: { month: MonthKey; net: Minor }[] = [];
  for (let m = start; m <= now; m = addMonths(m, 1)) {
    const date = m === now ? today : endOfMonth(m);
    out.push({ month: m, net: netWorthOn(accounts, date, txns, valuations, settings).net });
  }
  return out;
}
