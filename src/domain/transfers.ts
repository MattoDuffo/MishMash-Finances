import type { Account, Transaction } from './types';

export interface TransferPair {
  out: Transaction;
  in: Transaction;
}

const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/**
 * Finds likely transfers: equal and opposite amounts in two different
 * accounts with the same currency, within 4 days of each other.
 */
export function findTransferPairs(txns: Transaction[], accounts: Account[]): TransferPair[] {
  const currency = new Map(accounts.map((a) => [a.id, a.currency]));
  const free = txns.filter((t) => !t.transferId);
  const outs = free.filter((t) => t.amount < 0).sort((a, b) => a.date.localeCompare(b.date));
  const ins = free.filter((t) => t.amount > 0);
  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const o of outs) {
    const match = ins
      .filter(
        (i) =>
          !used.has(i.id) &&
          i.accountId !== o.accountId &&
          i.amount === -o.amount &&
          currency.get(i.accountId) === currency.get(o.accountId) &&
          days(i.date, o.date) <= 4,
      )
      .sort((a, b) => days(a.date, o.date) - days(b.date, o.date))[0];
    if (match) {
      used.add(match.id);
      pairs.push({ out: o, in: match });
    }
  }
  return pairs;
}
