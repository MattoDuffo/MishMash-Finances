import type { Category, Id, Minor, MonthKey, Transaction } from './types';
import { categoryLines, isTransferLine, transferCategoryIds } from './ledger';
import { addMonths, monthOf } from './dates';
import type { Recurring } from './recurring';

export interface MonthSummary {
  income: Minor;
  spending: Minor; // positive
  net: Minor;
  byCategory: Map<Id | null, Minor>; // spending per category, positive
  byPayee: Map<string, Minor>;
  count: number;
  largest: Transaction | null;
}

export function summarizeMonth(month: MonthKey, txns: Transaction[], categories: Category[]): MonthSummary {
  const transferIds = transferCategoryIds(categories);
  const incomeIds = new Set(categories.filter((c) => c.group === 'income').map((c) => c.id));
  const s: MonthSummary = { income: 0, spending: 0, net: 0, byCategory: new Map(), byPayee: new Map(), count: 0, largest: null };
  for (const t of txns) {
    if (monthOf(t.date) !== month) continue;
    let counted = false;
    for (const l of categoryLines(t)) {
      if (isTransferLine(t, l.categoryId, transferIds)) continue;
      counted = true;
      if (l.amount > 0 && (l.categoryId === null || incomeIds.has(l.categoryId))) s.income += l.amount;
      else {
        s.spending -= l.amount; // refunds reduce spending
        s.byCategory.set(l.categoryId, (s.byCategory.get(l.categoryId) ?? 0) - l.amount);
      }
    }
    if (!counted) continue;
    s.count++;
    if (t.amount < 0) {
      s.byPayee.set(t.payee, (s.byPayee.get(t.payee) ?? 0) - t.amount);
      if (!s.largest || t.amount < s.largest.amount) s.largest = t;
    }
  }
  s.net = s.income - s.spending;
  return s;
}

export interface Recap {
  month: MonthKey;
  current: MonthSummary;
  previous: MonthSummary;
  savingsRate: number | null;
  topCategories: { categoryId: Id | null; amount: Minor; change: Minor }[];
  biggestIncrease: { categoryId: Id | null; change: Minor } | null;
  topPayees: { payee: string; amount: Minor }[];
  newRecurring: Recurring[];
}

export function monthlyRecap(month: MonthKey, txns: Transaction[], categories: Category[], recurring: Recurring[]): Recap {
  const current = summarizeMonth(month, txns, categories);
  const previous = summarizeMonth(addMonths(month, -1), txns, categories);
  const topCategories = [...current.byCategory.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([categoryId, amount]) => ({ categoryId, amount, change: amount - (previous.byCategory.get(categoryId) ?? 0) }));
  const increases = topCategories.filter((c) => c.change > 0).sort((a, b) => b.change - a.change);
  return {
    month,
    current,
    previous,
    savingsRate: current.income > 0 ? current.net / current.income : null,
    topCategories,
    biggestIncrease: increases[0] ? { categoryId: increases[0].categoryId, change: increases[0].change } : null,
    topPayees: [...current.byPayee.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([payee, amount]) => ({ payee, amount })),
    newRecurring: recurring.filter((r) => !r.isIncome && monthOf(r.firstDate) >= addMonths(month, -2) && monthOf(r.lastDate) === month),
  };
}
