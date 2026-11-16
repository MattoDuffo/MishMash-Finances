/**
 * Core data model.
 *
 * Money is always stored as an integer number of minor units (cents, pence)
 * to avoid floating-point rounding. Dates are ISO calendar dates (YYYY-MM-DD)
 * because bank statements have no time of day.
 */

export type Id = string;
export type Minor = number; // integer minor units, e.g. 1234 = 12.34
export type IsoDate = string; // YYYY-MM-DD

export type AccountKind = 'checking' | 'savings' | 'credit' | 'cash' | 'investment' | 'loan' | 'other';

export interface Account {
  id: Id;
  name: string;
  kind: AccountKind;
  currency: string; // ISO 4217, e.g. "USD"
  openingBalance: Minor;
  archived: boolean;
  createdAt: string; // ISO timestamp
}

export type CategoryGroup = 'income' | 'bills' | 'everyday' | 'lifestyle' | 'savings' | 'transfer';

export interface Category {
  id: Id;
  name: string;
  group: CategoryGroup;
  archived: boolean;
}

export type TransactionSource = 'manual' | 'csv';

export interface Transaction {
  id: Id;
  accountId: Id;
  date: IsoDate;
  amount: Minor; // negative = money out, positive = money in
  payee: string;
  categoryId: Id | null;
  notes: string;
  source: TransactionSource;
  importId: Id | null; // set by the CSV importer (phase 1), so an import can be undone
  createdAt: string;
}

/** Maps each collection name to its record type. */
export interface Collections {
  accounts: Account;
  categories: Category;
  transactions: Transaction;
}

export type CollectionName = keyof Collections;
export const COLLECTIONS: CollectionName[] = ['accounts', 'categories', 'transactions'];

export function newId(): Id {
  return globalThis.crypto.randomUUID();
}
