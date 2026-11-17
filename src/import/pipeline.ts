/**
 * Turns parsed bank rows into transactions: extract, de-duplicate against
 * what's already stored, clean payees, apply rules and suggest categories.
 */
import type { CsvTemplate, Id, IsoDate, Minor, Rule, Transaction, TransactionSource } from '../domain/types';
import { newId } from '../domain/types';
import { parseAmount } from '../domain/money';
import { parseDate } from './dates';
import { cleanPayee, payeeKey } from '../domain/payee';
import { applyRules } from '../domain/rules';
import type { Categorizer } from '../domain/categorize';
import type { Mapping } from './mapping';

export interface RawRow {
  line: number;
  date: IsoDate;
  amount: Minor;
  payee: string;
  memo: string;
  /** Bank-provided unique id (OFX FITID), when the format has one. */
  externalId?: string;
}

export interface RowError {
  line: number;
  reason: string;
}

export function extractRows(
  rows: string[][],
  m: Mapping | CsvTemplate,
  currency: string,
): { rows: RawRow[]; errors: RowError[] } {
  const out: RawRow[] = [];
  const errors: RowError[] = [];
  const start = m.hasHeader ? 1 : 0;
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    // Footer lines (totals, balances, notes) have no date: skip them quietly.
    if (!/\d/.test(r[m.dateColumn] ?? '') || r.filter((c) => c).length < 2) continue;
    const date = parseDate(r[m.dateColumn] ?? '', m.dateFormat);
    if (!date) {
      errors.push({ line, reason: `Date “${r[m.dateColumn] ?? ''}” doesn’t match ${m.dateFormat}` });
      continue;
    }
    let amount: Minor | null;
    if (m.amountMode === 'signed') {
      amount = m.amountColumn === null ? null : parseAmount(r[m.amountColumn] ?? '', currency);
    } else {
      const debit = m.debitColumn === null ? 0 : (parseAmount(r[m.debitColumn] ?? '', currency) ?? 0);
      const credit = m.creditColumn === null ? 0 : (parseAmount(r[m.creditColumn] ?? '', currency) ?? 0);
      amount = Math.abs(credit) - Math.abs(debit);
      if (!r[m.debitColumn ?? -1] && !r[m.creditColumn ?? -1]) amount = null;
    }
    if (amount === null) {
      errors.push({ line, reason: 'No amount found' });
      continue;
    }
    if (m.invertSign) amount = -amount;
    const payee = r[m.payeeColumn] ?? '';
    const memo = m.memoColumn === null ? '' : (r[m.memoColumn] ?? '');
    out.push({ line, date, amount, payee: payee || memo, memo: payee ? memo : '' });
  }
  return { rows: out, errors };
}

export function fingerprint(row: { date: IsoDate; amount: Minor; payee: string; externalId?: string }): string {
  return row.externalId ? `id:${row.externalId}` : `${row.date}|${row.amount}|${payeeKey(row.payee)}`;
}

export type PlanStatus = 'new' | 'duplicate';
export interface PlanItem {
  row: RawRow;
  status: PlanStatus;
  txn: Transaction;
  suggestedBy: 'rule' | 'learned' | null;
}

/**
 * Builds the preview. A row is a duplicate if the account already holds a
 * transaction with the same fingerprint. Identical rows within one file
 * (two coffees, same price, same day) are kept apart by counting: the n-th
 * copy in the file is new only if the account has fewer than n copies.
 */
export function planImport(opts: {
  rows: RawRow[];
  accountId: Id;
  existing: Transaction[];
  rules: Rule[];
  categorizer: Categorizer | null;
  source: TransactionSource;
  autoAcceptConfidence?: number;
}): PlanItem[] {
  const { rows, accountId, existing, rules, categorizer, source } = opts;
  const threshold = opts.autoAcceptConfidence ?? 0.9;
  const have = new Map<string, number>();
  for (const t of existing) {
    if (t.accountId !== accountId) continue;
    const fp = t.fingerprint ?? fingerprint({ date: t.date, amount: t.amount, payee: t.originalPayee ?? t.payee });
    have.set(fp, (have.get(fp) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const now = new Date().toISOString();

  return rows.map((row) => {
    const fp = fingerprint(row);
    const n = (seen.get(fp) ?? 0) + 1;
    seen.set(fp, n);
    const status: PlanStatus = n <= (have.get(fp) ?? 0) ? 'duplicate' : 'new';

    let txn: Transaction = {
      id: newId(),
      accountId,
      date: row.date,
      amount: row.amount,
      payee: cleanPayee(row.payee),
      originalPayee: row.payee,
      categoryId: null,
      notes: row.memo,
      source,
      importId: null,
      createdAt: now,
      reviewed: false,
      transferId: null,
      fingerprint: fp,
    };
    let suggestedBy: PlanItem['suggestedBy'] = null;
    const ruled = applyRules(txn, rules);
    txn = ruled.txn;
    if (ruled.matched.some((r) => r.setCategoryId !== undefined)) {
      suggestedBy = 'rule';
    } else if (categorizer) {
      const s = categorizer.suggest(txn.payee, txn.amount);
      if (s) {
        txn.categoryId = s.categoryId;
        suggestedBy = 'learned';
        if (s.confidence >= threshold) txn.reviewed = true;
      }
    }
    return { row, status, txn, suggestedBy };
  });
}
