/**
 * Budget engine. One set of data (monthly assignments per category) drives
 * every method: zero-based and envelope share the "assign income, carry
 * leftovers forward" mechanics; 50/30/20 and tracking only read actuals.
 */
import type { BudgetMonth, Category, CategoryGroup, Id, Minor, MonthKey, Settings, Transaction } from './types';
import { categoryLines, isTransferLine, transferCategoryIds } from './ledger';
import { addMonths, monthOf, monthsBetween } from './dates';

export interface CategoryBudget {
  category: Category;
  assigned: Minor;
  activity: Minor; // spending is negative
  available: Minor; // carried over + assigned + activity
  carriedIn: Minor;
  suggested: Minor; // from the category's target
}

export interface BudgetView {
  month: MonthKey;
  income: Minor;
  readyToAssign: Minor;
  rows: CategoryBudget[];
  totalAssigned: Minor;
  totalActivity: Minor;
  overspent: CategoryBudget[];
}

const BUDGETED_GROUPS: CategoryGroup[] = ['bills', 'everyday', 'lifestyle', 'savings'];

/** Sums category activity per month, skipping transfers. */
export function activityByMonth(txns: Transaction[], categories: Category[]): Map<MonthKey, Map<Id | null, Minor>> {
  const transferIds = transferCategoryIds(categories);
  const out = new Map<MonthKey, Map<Id | null, Minor>>();
  for (const t of txns) {
    const m = monthOf(t.date);
    for (const line of categoryLines(t)) {
      if (isTransferLine(t, line.categoryId, transferIds)) continue;
      const mm = out.get(m) ?? new Map<Id | null, Minor>();
      mm.set(line.categoryId, (mm.get(line.categoryId) ?? 0) + line.amount);
      out.set(m, mm);
    }
  }
  return out;
}

export function computeBudget(
  month: MonthKey,
  categories: Category[],
  budgets: BudgetMonth[],
  txns: Transaction[],
): BudgetView {
  const activity = activityByMonth(txns, categories);
  const assignedBy = new Map(budgets.map((b) => [b.id, b.assigned]));
  const months = [...activity.keys(), ...assignedBy.keys(), month].sort();
  const first = months[0];
  const incomeIds = new Set(categories.filter((c) => c.group === 'income').map((c) => c.id));
  const budgeted = categories.filter((c) => BUDGETED_GROUPS.includes(c.group) && (!c.archived || (assignedBy.get(month)?.[c.id] ?? 0) !== 0));

  // Walk month by month, carrying each category's leftover forward.
  const carry = new Map<Id, Minor>();
  let incomeToDate = 0;
  let assignedToDate = 0;
  let rows: CategoryBudget[] = [];
  let incomeThisMonth = 0;
  for (let m = first; m <= month; m = addMonths(m, 1)) {
    const act = activity.get(m) ?? new Map();
    const asg = assignedBy.get(m) ?? {};
    let inc = 0;
    for (const [cat, amt] of act) if (cat && incomeIds.has(cat)) inc += amt;
    incomeToDate += inc;
    for (const v of Object.values(asg)) assignedToDate += v;
    rows = budgeted.map((c) => {
      const carriedIn = carry.get(c.id) ?? 0;
      const assigned = asg[c.id] ?? 0;
      const a = act.get(c.id) ?? 0;
      const available = carriedIn + assigned + a;
      carry.set(c.id, available);
      return { category: c, assigned, activity: a, available, carriedIn, suggested: 0 };
    });
    if (m === month) incomeThisMonth = inc;
  }
  for (const r of rows) r.suggested = suggestedAssignment(r.category, month, r.carriedIn);
  return {
    month,
    income: incomeThisMonth,
    readyToAssign: incomeToDate - assignedToDate,
    rows,
    totalAssigned: rows.reduce((n, r) => n + r.assigned, 0),
    totalActivity: rows.reduce((n, r) => n + r.activity, 0),
    overspent: rows.filter((r) => r.available < 0),
  };
}

/** What to assign this month to stay on track for the category's target. */
export function suggestedAssignment(c: Category, month: MonthKey, carriedIn: Minor): Minor {
  const t = c.target;
  if (!t) return 0;
  if (t.type === 'monthly') return Math.max(0, t.amount - Math.max(0, carriedIn));
  const remainingMonths = Math.max(1, monthsBetween(month, monthOf(t.date)) + 1);
  return Math.max(0, Math.ceil((t.amount - carriedIn) / remainingMonths));
}

/** Moves `amount` of this month's assignment from one category to another. */
export function moveMoney(b: BudgetMonth, from: Id, to: Id, amount: Minor): BudgetMonth {
  const assigned = { ...b.assigned };
  assigned[from] = (assigned[from] ?? 0) - amount;
  assigned[to] = (assigned[to] ?? 0) + amount;
  return { ...b, assigned };
}

export interface BucketView {
  key: 'needs' | 'wants' | 'savings';
  label: string;
  targetPct: number;
  target: Minor;
  actual: Minor; // positive = spent or saved
}

/** 50/30/20: needs are bills + everyday, wants are lifestyle, savings is what's left. */
export function fiftyThirtyTwenty(month: MonthKey, categories: Category[], txns: Transaction[], split: Settings['split503020']) {
  const act = activityByMonth(txns, categories).get(month) ?? new Map();
  const group = new Map(categories.map((c) => [c.id, c.group]));
  let income = 0;
  let needs = 0;
  let wants = 0;
  for (const [cat, amt] of act) {
    const g = cat ? group.get(cat) : undefined;
    if (g === 'income') income += amt;
    else if (g === 'bills' || g === 'everyday') needs -= amt;
    else if (g === 'lifestyle' || (g === undefined && amt < 0)) wants -= amt; // uncategorised spending counts as wants
    // Savings categories aren't spending: whatever isn't spent is saved.
  }
  const savings = income - needs - wants;
  const buckets: BucketView[] = [
    { key: 'needs', label: 'Needs', targetPct: split.needs, target: Math.round((income * split.needs) / 100), actual: needs },
    { key: 'wants', label: 'Wants', targetPct: split.wants, target: Math.round((income * split.wants) / 100), actual: wants },
    { key: 'savings', label: 'Savings', targetPct: split.savings, target: Math.round((income * split.savings) / 100), actual: savings },
  ];
  return { income, buckets };
}

/** Average monthly spending per category over the previous `n` full months. */
export function averageSpending(month: MonthKey, categories: Category[], txns: Transaction[], n = 3): Map<Id | null, Minor> {
  const act = activityByMonth(txns, categories);
  const out = new Map<Id | null, Minor>();
  for (let i = 1; i <= n; i++) {
    for (const [cat, amt] of act.get(addMonths(month, -i)) ?? []) out.set(cat, (out.get(cat) ?? 0) + amt / n);
  }
  for (const [k, v] of out) out.set(k, Math.round(v));
  return out;
}
