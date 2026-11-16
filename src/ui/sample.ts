import type { Session } from '../db/store';
import { newId, type Account, type Transaction } from '../domain/types';

/** Adds clearly labelled example data so the app can be tried out. */
export async function addExampleData(s: Session): Promise<void> {
  const now = new Date().toISOString();
  const checking: Account = {
    id: newId(),
    name: 'Example checking',
    kind: 'checking',
    currency: 'USD',
    openingBalance: 245000,
    archived: false,
    createdAt: now,
  };
  const card: Account = { ...checking, id: newId(), name: 'Example credit card', kind: 'credit', openingBalance: 0 };
  await s.put('accounts', checking);
  await s.put('accounts', card);

  const cat = (name: string) => s.list('categories').find((c) => c.name === name)?.id ?? null;
  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  const rows: [number, string, number, string, Account][] = [
    [0, 'Corner Grocer', -6412, 'Groceries', card],
    [1, 'City Transit', -275, 'Transport', card],
    [2, 'Payroll — example employer', 320000, 'Salary', checking],
    [3, 'Streamflix', -1599, 'Subscriptions', card],
    [4, 'Blue Door Café', -1150, 'Eating out', card],
    [6, 'Riverside Apartments', -145000, 'Rent / mortgage', checking],
    [8, 'Power & Light Co.', -8833, 'Utilities', checking],
    [9, 'Corner Grocer', -4127, 'Groceries', card],
    [12, 'Card payment', -9000, 'Transfer', checking],
    [12, 'Card payment', 9000, 'Transfer', card],
  ];
  for (const [offset, payee, amount, category, account] of rows) {
    const t: Transaction = {
      id: newId(),
      accountId: account.id,
      date: day(offset),
      amount,
      payee,
      categoryId: cat(category),
      notes: '',
      source: 'manual',
      importId: null,
      createdAt: now,
    };
    await s.put('transactions', t);
  }
}
