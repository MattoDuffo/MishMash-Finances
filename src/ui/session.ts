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
