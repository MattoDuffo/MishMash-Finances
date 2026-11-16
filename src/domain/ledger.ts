import type { Category, Id, Minor, Transaction } from './types';

/** The (category, amount) lines of a transaction, honouring splits. */
export function categoryLines(t: Transaction): { categoryId: Id | null; amount: Minor }[] {
  if (t.splits && t.splits.length > 0) return t.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount }));
  return [{ categoryId: t.categoryId, amount: t.amount }];
}

/** Category ids that are transfers between your own accounts. */
export function transferCategoryIds(categories: Category[]): Set<Id> {
  return new Set(categories.filter((c) => c.group === 'transfer').map((c) => c.id));
}

/** True when a line is money moving between your own accounts. */
export function isTransferLine(t: Transaction, categoryId: Id | null, transferIds: Set<Id>): boolean {
  return Boolean(t.transferId) || (categoryId !== null && transferIds.has(categoryId));
}
