import { describe, it, expect } from 'vitest';
import type { Account, Category, Transaction } from './types';
import { computeBudget, moveMoney, suggestedAssignment, fiftyThirtyTwenty } from './budget';
import { detectRecurring, upcoming } from './recurring';
import { simulatePayoff } from './debt';
import { cashForecast } from './forecast';
import { balanceOn, netWorthOn } from './wealth';
import { projectRetirement } from './retirement';
import { monthlyRecap } from './recap';
import { DEFAULT_SETTINGS } from './settings';
import { addMonthsToDate } from './dates';
import { findTransferPairs } from './transfers';
import { applyRules } from './rules';

const cats: Category[] = [
  { id: 'salary', name: 'Salary', group: 'income', archived: false },
  { id: 'rent', name: 'Rent', group: 'bills', archived: false },
  { id: 'food', name: 'Groceries', group: 'everyday', archived: false },
  { id: 'fun', name: 'Fun', group: 'lifestyle', archived: false },
  { id: 'xfer', name: 'Transfer', group: 'transfer', archived: false },
];
let n = 0;
const tx = (date: string, amount: number, categoryId: string | null, payee = 'x', accountId = 'chk'): Transaction => ({
  id: String(n++),
  accountId,
  date,
  amount,
  payee,
  categoryId,
  notes: '',
  source: 'csv',
  importId: null,
  createdAt: '',
});

describe('budget', () => {
  const txns = [tx('2026-10-01', 300000, 'salary'), tx('2026-10-05', -100000, 'rent'), tx('2026-10-10', -30000, 'food'), tx('2026-11-01', 300000, 'salary'), tx('2026-11-08', -45000, 'food'), tx('2026-11-09', -50000, 'xfer')];
  const budgets = [
    { id: '2026-10', assigned: { rent: 100000, food: 40000 } },
    { id: '2026-11', assigned: { rent: 100000, food: 30000 } },
  ];
  it('carries leftovers forward and computes ready to assign', () => {
    const v = computeBudget('2026-11', cats, budgets, txns);
    const food = v.rows.find((r) => r.category.id === 'food')!;
    expect(food.carriedIn).toBe(10000);
    expect(food.available).toBe(10000 + 30000 - 45000);
    expect(v.overspent.map((r) => r.category.id)).toEqual(['food']);
    expect(v.readyToAssign).toBe(600000 - 270000);
    expect(v.income).toBe(300000);
  });
  it('ignores transfers', () => {
    const v = computeBudget('2026-11', cats, budgets, txns);
    expect(v.totalActivity).toBe(-45000);
  });
  it('moves money between categories', () => {
    expect(moveMoney(budgets[1], 'rent', 'food', 5000).assigned).toEqual({ rent: 95000, food: 35000 });
  });
  it('suggests amounts for targets', () => {
    expect(suggestedAssignment({ ...cats[3], target: { type: 'by-date', amount: 120000, date: '2027-04-15' } }, '2026-11', 0)).toBe(20000);
    expect(suggestedAssignment({ ...cats[3], target: { type: 'monthly', amount: 5000 } }, '2026-11', 2000)).toBe(3000);
  });
  it('splits 50/30/20', () => {
    const r = fiftyThirtyTwenty('2026-10', cats, [...txns, tx('2026-10-11', -20000, 'fun')], DEFAULT_SETTINGS.split503020);
    expect(r.buckets.map((b) => b.actual)).toEqual([130000, 20000, 150000]);
  });
});

describe('recurring', () => {
  const sub = ['2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03', '2026-11-03'].map((d, i) => tx(d, i < 4 ? -1599 : -1799, null, 'Streamflix'));
  const rent = ['2026-08-31', '2026-09-30', '2026-10-31'].map((d) => tx(d, -145000, 'rent', 'Riverside Apartments'));
  const oneOff = [tx('2026-09-01', -5000, null, 'Shop'), tx('2026-11-02', -7000, null, 'Shop')];
  const found = detectRecurring([...sub, ...rent, ...oneOff], '2026-11-16');
  it('finds monthly items and price rises', () => {
    const s = found.find((r) => r.payee === 'Streamflix')!;
    expect(s.cadence).toBe('monthly');
    expect(s.nextDate).toBe('2026-12-03');
    expect(s.priceChange).toEqual({ from: -1599, to: -1799, date: '2026-11-03' });
    expect(s.isSubscription).toBe(true);
    expect(found.find((r) => r.payee === 'Shop')).toBeUndefined();
  });
  it('handles month-end dates', () => {
    const r = found.find((x) => x.payee === 'Riverside Apartments')!;
    expect(r.nextDate).toBe('2026-11-30');
    expect(upcoming([r], '2026-11-16', '2027-03-01').map((o) => o.date)).toEqual(['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
  });
  it('clamps month arithmetic', () => {
    expect(addMonthsToDate('2027-01-31', 1)).toBe('2027-02-28');
  });
  it('forecasts cash including upcoming bills', () => {
    const acc: Account = { id: 'chk', name: 'C', kind: 'checking', currency: 'USD', openingBalance: 200000, archived: false, createdAt: '' };
    const f = cashForecast([acc], [...sub, ...rent], found, '2026-11-16', 30);
    expect(f.start).toBe(200000 - 1599 * 4 - 1799 - 145000 * 3);
    expect(f.series.find((d) => d.date === '2026-11-30')!.events[0].payee).toBe('Riverside Apartments');
    expect(f.lowest.balance).toBeLessThan(f.start);
  });
});

describe('debt payoff', () => {
  const debts = [
    { id: 'card', name: 'Card', balance: 300000, apr: 22, minPayment: 9000 },
    { id: 'car', name: 'Car', balance: 100000, apr: 6, minPayment: 20000 },
  ];
  it('avalanche pays less interest than snowball', () => {
    const a = simulatePayoff(debts, 20000, 'avalanche');
    const s = simulatePayoff(debts, 20000, 'snowball');
    expect(a.feasible && s.feasible).toBe(true);
    expect(a.totalInterest).toBeLessThan(s.totalInterest);
    expect(s.order[0].id).toBe('car');
    expect(a.order[a.order.length - 1].month).toBe(a.months);
  });
  it('flags payments that never cover interest', () => {
    expect(simulatePayoff([{ id: 'x', name: 'X', balance: 1000000, apr: 30, minPayment: 1000 }], 0, 'avalanche').feasible).toBe(false);
  });
});

describe('wealth', () => {
  const house: Account = { id: 'h', name: 'House', kind: 'property', currency: 'USD', openingBalance: 0, archived: false, createdAt: '' };
  const eur: Account = { id: 'e', name: 'EUR', kind: 'savings', currency: 'EUR', openingBalance: 10000, archived: false, createdAt: '' };
  const vals = [{ id: '1', accountId: 'h', date: '2026-01-01', value: 40000000 }, { id: '2', accountId: 'h', date: '2026-06-01', value: 42000000 }];
  it('uses the latest valuation', () => {
    expect(balanceOn(house, '2026-03-01', [], vals)).toBe(40000000);
    expect(balanceOn(house, '2026-11-01', [], vals)).toBe(42000000);
    expect(balanceOn(house, '2025-11-01', [], vals)).toBe(0);
  });
  it('converts currencies and reports missing rates', () => {
    expect(netWorthOn([house, eur], '2026-11-01', [], vals, { ...DEFAULT_SETTINGS, baseCurrency: 'USD' }).missingRates).toEqual(['EUR']);
    expect(netWorthOn([house, eur], '2026-11-01', [], vals, { ...DEFAULT_SETTINGS, baseCurrency: 'USD', exchangeRates: { EUR: 1.1 } }).net).toBe(42000000 + 11000);
  });
});

describe('retirement', () => {
  it('is deterministic and sensible', () => {
    const inp = { ...DEFAULT_SETTINGS.retirement };
    const a = projectRetirement(inp, 10000000, 300);
    const b = projectRetirement(inp, 10000000, 300);
    expect(a).toEqual(b);
    expect(a.p10[30]).toBeLessThanOrEqual(a.p50[30]);
    expect(a.p50[30]).toBeLessThanOrEqual(a.p90[30]);
    const rich = projectRetirement({ ...inp, monthlyContribution: 500000 }, 100000000, 300);
    expect(rich.successRate).toBeGreaterThan(a.successRate);
    expect(a.fiNumber).toBe(inp.annualSpending * 25);
  });
});

describe('recap, transfers and rules', () => {
  it('summarises a month against the previous one', () => {
    const txns = [tx('2026-10-02', -10000, 'food'), tx('2026-11-02', -25000, 'food'), tx('2026-11-01', 300000, 'salary'), tx('2026-11-03', -5000, 'xfer')];
    const r = monthlyRecap('2026-11', txns, cats, []);
    expect(r.current.spending).toBe(25000);
    expect(r.biggestIncrease).toEqual({ categoryId: 'food', change: 15000 });
    expect(r.savingsRate).toBeCloseTo(275000 / 300000);
  });
  it('pairs transfers between accounts', () => {
    const accts: Account[] = ['a', 'b'].map((id) => ({ id, name: id, kind: 'checking', currency: 'USD', openingBalance: 0, archived: false, createdAt: '' }));
    const pairs = findTransferPairs([tx('2026-11-01', -5000, null, 'x', 'a'), tx('2026-11-03', 5000, null, 'y', 'b'), tx('2026-11-03', 5000, null, 'z', 'a')], accts);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].in.accountId).toBe('b');
  });
  it('applies rules in order', () => {
    const t = tx('2026-11-01', -5000, null, 'Amazon Prime');
    const { txn } = applyRules(t, [
      { id: '1', name: 'a', enabled: true, order: 0, conditions: [{ field: 'payee', op: 'contains', value: 'amazon' }], setCategoryId: 'fun' },
      { id: '2', name: 'b', enabled: true, order: 1, conditions: [{ field: 'payee', op: 'contains', value: 'prime' }, { field: 'amount', op: 'lt', value: '100' }], setCategoryId: 'rent', setPayee: 'Prime' },
    ]);
    expect(txn).toMatchObject({ categoryId: 'rent', payee: 'Prime' });
  });
});

describe('twice-monthly pay and internal transfers', () => {
  const pay = ['2026-08-01', '2026-08-15', '2026-09-01', '2026-09-15', '2026-10-01', '2026-10-15', '2026-11-01', '2026-11-15'].map((d) => tx(d, 300000, 'salary', 'Payroll'));
  it('predicts the 1st and 15th, not every 14 days', () => {
    const r = detectRecurring(pay, '2026-11-16')[0];
    expect(r.cadence).toBe('twice-monthly');
    expect(upcoming([r], '2026-11-16', '2027-01-20').map((o) => o.date)).toEqual(['2026-12-01', '2026-12-15', '2027-01-01', '2027-01-15']);
  });
  it('drops transfers between cash accounts from the forecast', () => {
    const accts: Account[] = ['chk', 'sav'].map((id) => ({ id, name: id, kind: 'checking', currency: 'USD', openingBalance: 0, archived: false, createdAt: '' }));
    const xfers = ['2026-08-25', '2026-09-25', '2026-10-25'].flatMap((d) => [tx(d, -5000, 'xfer', 'To savings', 'chk'), tx(d, 5000, 'xfer', 'From checking', 'sav')]);
    const f = cashForecast(accts, xfers, detectRecurring(xfers, '2026-11-16'), '2026-11-16', 30);
    expect(f.series.flatMap((d) => d.events)).toEqual([]);
  });
});
