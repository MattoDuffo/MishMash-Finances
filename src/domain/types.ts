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
export type MonthKey = string; // YYYY-MM

export type AccountKind =
  | 'checking'
  | 'savings'
  | 'credit'
  | 'cash'
  | 'investment'
  | 'loan'
  | 'property'
  | 'vehicle'
  | 'asset'
  | 'liability'
  | 'other';

/** Kinds whose balance is set by valuations rather than transactions. */
export const VALUED_KINDS: AccountKind[] = ['investment', 'property', 'vehicle', 'asset', 'liability'];
/** Kinds that count as spendable cash for budgeting and forecasts. */
export const CASH_KINDS: AccountKind[] = ['checking', 'savings', 'cash'];
/** Kinds that are debts (balances are normally negative). */
export const DEBT_KINDS: AccountKind[] = ['credit', 'loan', 'liability'];

export interface Account {
  id: Id;
  name: string;
  kind: AccountKind;
  currency: string; // ISO 4217, e.g. "USD"
  openingBalance: Minor;
  archived: boolean;
  createdAt: string; // ISO timestamp
  /** Debts only: annual interest rate in percent, e.g. 19.99. */
  apr?: number;
  /** Debts only: minimum monthly payment. */
  minPayment?: Minor;
}

export type CategoryGroup = 'income' | 'bills' | 'everyday' | 'lifestyle' | 'savings' | 'transfer';

export type CategoryTarget =
  | { type: 'monthly'; amount: Minor }
  | { type: 'by-date'; amount: Minor; date: IsoDate };

export interface Category {
  id: Id;
  name: string;
  group: CategoryGroup;
  archived: boolean;
  target?: CategoryTarget;
}

export type TransactionSource = 'manual' | 'csv' | 'ofx' | 'qif';

export interface Split {
  categoryId: Id | null;
  amount: Minor;
  note: string;
}

export interface Transaction {
  id: Id;
  accountId: Id;
  date: IsoDate;
  amount: Minor; // negative = money out, positive = money in
  payee: string;
  /** The payee text exactly as it appeared in the bank file. */
  originalPayee?: string;
  categoryId: Id | null;
  notes: string;
  source: TransactionSource;
  importId: Id | null;
  createdAt: string;
  /** False for imported transactions until reviewed in the inbox. */
  reviewed?: boolean;
  /** Links the two halves of a transfer between accounts. */
  transferId?: Id | null;
  /** When present, the amounts add up to `amount` and replace `categoryId`. */
  splits?: Split[];
  /** Fingerprint used to recognise the same bank row on re-import. */
  fingerprint?: string;
}

export interface ImportBatch {
  id: Id;
  accountId: Id;
  fileName: string;
  importedAt: string;
  added: number;
  skipped: number;
  templateId: Id | null;
}

export type AmountMode = 'signed' | 'debit-credit';

export interface CsvTemplate {
  id: Id;
  name: string;
  /** Normalised header row, used to recognise the bank's file next time. */
  signature: string;
  accountId: Id | null;
  delimiter: string;
  hasHeader: boolean;
  dateColumn: number;
  dateFormat: string;
  payeeColumn: number;
  memoColumn: number | null;
  amountMode: AmountMode;
  amountColumn: number | null;
  debitColumn: number | null;
  creditColumn: number | null;
  invertSign: boolean;
}

export type RuleField = 'payee' | 'originalPayee' | 'amount' | 'account';
export type RuleOp = 'contains' | 'equals' | 'starts-with' | 'regex' | 'gt' | 'lt' | 'between' | 'is';

export interface RuleCondition {
  field: RuleField;
  op: RuleOp;
  value: string;
  value2?: string;
}

export interface Rule {
  id: Id;
  name: string;
  enabled: boolean;
  order: number;
  conditions: RuleCondition[];
  setCategoryId?: Id | null;
  setPayee?: string;
  markReviewed?: boolean;
}

export interface BudgetMonth {
  id: MonthKey; // "2026-11"
  assigned: Record<Id, Minor>;
}

export interface Goal {
  id: Id;
  name: string;
  target: Minor;
  targetDate: IsoDate | null;
  /** If set, progress is this account's balance; otherwise `saved`. */
  accountId: Id | null;
  saved: Minor;
  createdAt: string;
}

export interface Valuation {
  id: Id;
  accountId: Id;
  date: IsoDate;
  value: Minor;
}

export type BudgetMethod = 'zero-based' | 'envelope' | '50-30-20' | 'tracking';

export interface Settings {
  id: 'settings';
  budgetMethod: BudgetMethod;
  baseCurrency: string;
  /** Units of base currency per 1 unit of the key currency, entered by hand. */
  exchangeRates: Record<string, number>;
  split503020: { needs: number; wants: number; savings: number };
  retirement: RetirementInputs;
  dismissedRecurring: string[];
}

export interface RetirementInputs {
  currentAge: number;
  retireAge: number;
  endAge: number;
  monthlyContribution: Minor;
  annualSpending: Minor;
  expectedReturn: number; // percent per year, nominal
  volatility: number; // percent, standard deviation
  inflation: number; // percent
  /** Overrides the sum of investment accounts when set. */
  startingBalance: Minor | null;
}

export interface Biometric {
  id: 'biometric';
  credentialId: string; // base64
  salt: string; // base64
  iv: string; // base64
  wrappedKey: string; // base64
  createdAt: string;
}

/** Maps each collection name to its record type. */
export interface Collections {
  accounts: Account;
  categories: Category;
  transactions: Transaction;
  imports: ImportBatch;
  templates: CsvTemplate;
  rules: Rule;
  budgets: BudgetMonth;
  goals: Goal;
  valuations: Valuation;
  settings: Settings;
}

export type CollectionName = keyof Collections;
export const COLLECTIONS: CollectionName[] = [
  'accounts',
  'categories',
  'transactions',
  'imports',
  'templates',
  'rules',
  'budgets',
  'goals',
  'valuations',
  'settings',
];

export function newId(): Id {
  return globalThis.crypto.randomUUID();
}
