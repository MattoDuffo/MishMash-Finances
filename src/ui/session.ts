import { createContext, useContext, useEffect, useReducer } from 'react';
import type { Session } from '../db/store';
import type { Account, Transaction } from '../domain/types';

export const SessionContext = createContext<Session | null>(null);

/** Returns the unlocked session and re-renders whenever its data changes. */
export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside an unlocked vault');
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => s.subscribe(bump), [s]);
  return s;
}

export function accountBalance(account: Account, txns: Transaction[]): number {
  return txns.reduce((sum, t) => (t.accountId === account.id ? sum + t.amount : sum), account.openingBalance);
}

export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Non-sensitive preferences live in localStorage. */
export function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`mishmash.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`mishmash.${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

import { formatMoney, currencyExponent } from '../domain/money';

/** Compact axis labels: $1.2k, $35k, $1.4M. */
export function compactMoney(amount: number, currency = 'USD'): string {
  const v = amount / 10 ** currencyExponent(currency);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(v);
  } catch {
    return formatMoney(amount, currency);
  }
}

/** Converts a typed amount ("12.50") to minor units for a currency, or null. */
export { parseAmount } from '../domain/money';

/** Shows minor units as an editable decimal string. */
export function toInput(amount: number, currency = 'USD'): string {
  const e = currencyExponent(currency);
  return (amount / 10 ** e).toFixed(e);
}
