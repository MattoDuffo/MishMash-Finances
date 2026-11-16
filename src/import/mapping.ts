import type { CsvTemplate } from '../domain/types';
import { detectDateFormats } from './dates';
import { parseAmount } from '../domain/money';

export type Mapping = Omit<CsvTemplate, 'id' | 'name' | 'signature' | 'accountId'>;

export function headerSignature(header: string[]): string {
  return header.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, '')).join('|');
}

const FIND = {
  date: /^(transaction |trans\.? |posted |posting |value |booking )?date$|^date|datum|fecha/i,
  payee: /description|payee|merchant|name|narrative|details|beneficiary|counterparty|transaction$/i,
  memo: /memo|reference|notes?$|additional|particulars/i,
  amount: /^amount$|^amount \(|^value$|^transaction amount|betrag|importe|montant|^amt$/i,
  debit: /debit|withdrawal|money out|paid out|outflow|^out$/i,
  credit: /credit|deposit|money in|paid in|inflow|^in$/i,
};

const looksLikeHeader = (row: string[]) =>
  row.filter((c) => c && parseAmount(c) === null && detectDateFormats([c]).length === 0).length >= Math.ceil(row.length / 2);

/** Guesses which column holds what, from the header and the data. */
export function guessMapping(rows: string[][], delimiter: string, preferDayFirst = false): Mapping {
  const hasHeader = rows.length > 1 && looksLikeHeader(rows[0]);
  const header = hasHeader ? rows[0] : rows[0].map(() => '');
  const data = rows.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + 50);
  const cols = header.length;
  const col = (i: number) => data.map((r) => r[i] ?? '');
  const find = (re: RegExp, exclude: number[] = []) => header.findIndex((h, i) => !exclude.includes(i) && re.test(h));

  // Date: header match that parses, else first column that parses as dates.
  let dateColumn = find(FIND.date);
  if (dateColumn < 0 || detectDateFormats(col(dateColumn)).length === 0) {
    dateColumn = [...Array(cols).keys()].find((i) => detectDateFormats(col(i)).length > 0) ?? 0;
  }
  const dateFormat = detectDateFormats(col(dateColumn), preferDayFirst)[0] ?? 'YYYY-MM-DD';

  const numeric = (i: number) => {
    const vals = col(i).filter(Boolean);
    return vals.length > 0 && vals.every((v) => parseAmount(v) !== null);
  };

  let amountColumn = find(FIND.amount, [dateColumn]);
  let debitColumn = find(FIND.debit, [dateColumn]);
  let creditColumn = find(FIND.credit, [dateColumn, debitColumn]);
  let amountMode: Mapping['amountMode'] = 'signed';
  if (amountColumn < 0 && debitColumn >= 0 && creditColumn >= 0) {
    amountMode = 'debit-credit';
  } else if (amountColumn < 0) {
    // No header help: first numeric column that isn't a running balance.
    const balanceIdx = header.findIndex((h) => /balance/i.test(h));
    amountColumn = [...Array(cols).keys()].find((i) => i !== dateColumn && i !== balanceIdx && numeric(i)) ?? -1;
  }
  if (amountMode === 'signed') {
    debitColumn = -1;
    creditColumn = -1;
  }

  const used = [dateColumn, amountColumn, debitColumn, creditColumn].filter((i) => i >= 0);
  let payeeColumn = find(FIND.payee, used);
  if (payeeColumn < 0) {
    // The text column with the most distinct values.
    let best = -1;
    let bestDistinct = -1;
    for (let i = 0; i < cols; i++) {
      if (used.includes(i) || numeric(i)) continue;
      const distinct = new Set(col(i)).size;
      if (distinct > bestDistinct) {
        best = i;
        bestDistinct = distinct;
      }
    }
    payeeColumn = best < 0 ? 0 : best;
  }
  const memoColumn = find(FIND.memo, [...used, payeeColumn]);

  return {
    delimiter,
    hasHeader,
    dateColumn,
    dateFormat,
    payeeColumn,
    memoColumn: memoColumn >= 0 ? memoColumn : null,
    amountMode,
    amountColumn: amountColumn >= 0 ? amountColumn : null,
    debitColumn: debitColumn >= 0 ? debitColumn : null,
    creditColumn: creditColumn >= 0 ? creditColumn : null,
    invertSign: false,
  };
}
