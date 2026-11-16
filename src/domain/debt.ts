import type { Id, Minor } from './types';

export interface Debt {
  id: Id;
  name: string;
  balance: Minor; // amount owed, positive
  apr: number; // percent
  minPayment: Minor;
}

export type Strategy = 'avalanche' | 'snowball';

export interface PayoffResult {
  months: number;
  totalInterest: Minor;
  totalPaid: Minor;
  order: { id: Id; name: string; month: number }[];
  /** False if payments don't cover interest within 50 years. */
  feasible: boolean;
  timeline: Minor[]; // total balance at the end of each month
}

/**
 * Month-by-month payoff: every debt gets its minimum, and the extra amount
 * (plus minimums freed by paid-off debts) goes to the priority debt.
 * Avalanche targets the highest rate; snowball the smallest balance.
 */
export function simulatePayoff(debts: Debt[], extra: Minor, strategy: Strategy): PayoffResult {
  const ds = debts.filter((d) => d.balance > 0).map((d) => ({ ...d }));
  const budget = ds.reduce((n, d) => n + d.minPayment, 0) + extra;
  let totalInterest = 0;
  let totalPaid = 0;
  const order: PayoffResult['order'] = [];
  const timeline: Minor[] = [];
  let month = 0;
  while (ds.some((d) => d.balance > 0) && month < 600) {
    month++;
    for (const d of ds) {
      if (d.balance <= 0) continue;
      const interest = Math.round((d.balance * d.apr) / 100 / 12);
      d.balance += interest;
      totalInterest += interest;
    }
    let left = budget;
    for (const d of ds) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.balance, d.minPayment, left);
      d.balance -= pay;
      left -= pay;
      totalPaid += pay;
    }
    const priority = ds
      .filter((d) => d.balance > 0)
      .sort((a, b) => (strategy === 'avalanche' ? b.apr - a.apr || a.balance - b.balance : a.balance - b.balance || b.apr - a.apr));
    for (const d of priority) {
      if (left <= 0) break;
      const pay = Math.min(d.balance, left);
      d.balance -= pay;
      left -= pay;
      totalPaid += pay;
    }
    for (const d of ds) if (d.balance <= 0 && !order.some((o) => o.id === d.id)) order.push({ id: d.id, name: d.name, month });
    timeline.push(ds.reduce((n, d) => n + Math.max(0, d.balance), 0));
  }
  return { months: month, totalInterest, totalPaid, order, feasible: !ds.some((d) => d.balance > 0), timeline };
}
