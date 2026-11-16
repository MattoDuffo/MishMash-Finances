import { describe, it, expect } from 'vitest';
import { parseCsv, detectDelimiter, toCsvRow } from './csv';
import { parseDate, detectDateFormats } from './dates';
import { guessMapping } from './mapping';
import { extractRows, planImport } from './pipeline';
import { cleanPayee } from '../domain/payee';
import { Categorizer } from '../domain/categorize';
import type { Transaction } from '../domain/types';

describe('csv', () => {
  it('handles quotes, escaped quotes, newlines in fields and BOM', () => {
    const text = '﻿a,b\n"x, y","he said ""hi"""\n"multi\nline",2\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['multi\nline', '2'],
    ]);
  });
  it('detects semicolons and tabs', () => {
    expect(detectDelimiter('Datum;Betrag;Text\n01.02.2026;-12,50;Bäcker\n')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3\n')).toBe('\t');
  });
  it('escapes export fields', () => {
    expect(toCsvRow(['a,b', 'say "x"', 3])).toBe('"a,b","say ""x""",3');
  });
});

describe('dates', () => {
  it('parses formats and rejects impossible dates', () => {
    expect(parseDate('03/04/2026', 'MM/DD/YYYY')).toBe('2026-03-04');
    expect(parseDate('03/04/2026', 'DD/MM/YYYY')).toBe('2026-04-03');
    expect(parseDate('31/02/2026', 'DD/MM/YYYY')).toBeNull();
    expect(parseDate('5 Mar 2026', 'D MMM YYYY')).toBe('2026-03-05');
    expect(parseDate('Mar 5, 2026', 'MMM D, YYYY')).toBe('2026-03-05');
    expect(parseDate('2026-03-05T10:00:00', 'YYYY-MM-DD')).toBe('2026-03-05');
  });
  it('uses a day above 12 to settle day/month order', () => {
    expect(detectDateFormats(['03/04/2026', '25/04/2026'])[0]).toBe('DD/MM/YYYY');
    expect(detectDateFormats(['04/25/2026'])[0]).toBe('MM/DD/YYYY');
  });
});

describe('mapping and pipeline', () => {
  const us = `Date,Description,Amount,Balance
11/02/2026,SQ *BLUE BOTTLE COFFEE 1234 SAN FRANCISCO CA,-4.50,995.50
11/03/2026,PAYROLL ACME INC,2000.00,2995.50
11/03/2026,SQ *BLUE BOTTLE COFFEE 1234 SAN FRANCISCO CA,-4.50,2991.00
11/03/2026,SQ *BLUE BOTTLE COFFEE 1234 SAN FRANCISCO CA,-4.50,2986.50`;

  it('guesses a signed-amount layout', () => {
    const rows = parseCsv(us, detectDelimiter(us));
    const m = guessMapping(rows, ',');
    expect(m).toMatchObject({ hasHeader: true, dateColumn: 0, payeeColumn: 1, amountMode: 'signed', amountColumn: 2 });
    expect(m.dateFormat).toBe('MM/DD/YYYY');
  });

  it('guesses debit/credit columns', () => {
    const uk = 'Date,Transaction Description,Debit Amount,Credit Amount\n25/10/2026,TESCO STORES,12.30,\n26/10/2026,SALARY,,1500.00\n';
    const rows = parseCsv(uk);
    const m = guessMapping(rows, ',');
    expect(m.amountMode).toBe('debit-credit');
    const { rows: out } = extractRows(rows, m, 'GBP');
    expect(out.map((r) => [r.date, r.amount])).toEqual([
      ['2026-10-25', -1230],
      ['2026-10-26', 150000],
    ]);
  });

  it('skips rows already imported but keeps genuine repeats', () => {
    const rows = parseCsv(us);
    const m = guessMapping(rows, ',');
    const { rows: raw } = extractRows(rows, m, 'USD');
    const first = planImport({ rows: raw.slice(0, 3), accountId: 'a', existing: [], rules: [], categorizer: null, source: 'csv' });
    expect(first.every((p) => p.status === 'new')).toBe(true);
    const stored = first.map((p) => p.txn);
    // Re-import the full file: the first three are duplicates, the 2nd coffee on 11/03 is new.
    const second = planImport({ rows: raw, accountId: 'a', existing: stored, rules: [], categorizer: null, source: 'csv' });
    expect(second.map((p) => p.status)).toEqual(['duplicate', 'duplicate', 'duplicate', 'new']);
  });

  it('cleans payees and applies rules before learned suggestions', () => {
    const rows = parseCsv(us);
    const { rows: raw } = extractRows(rows, guessMapping(rows, ','), 'USD');
    const plan = planImport({
      rows: raw,
      accountId: 'a',
      existing: [],
      rules: [{ id: 'r', name: 'Payroll', enabled: true, order: 0, conditions: [{ field: 'payee', op: 'contains', value: 'payroll' }], setCategoryId: 'salary' }],
      categorizer: null,
      source: 'csv',
    });
    expect(plan[0].txn.payee).toBe('Blue Bottle Coffee');
    expect(plan[1].txn.categoryId).toBe('salary');
    expect(plan[1].suggestedBy).toBe('rule');
  });
});

describe('payee cleanup', () => {
  it.each([
    ['SQ *BLUE BOTTLE COFFEE 1234 SAN FRANCISCO CA', 'Blue Bottle Coffee'],
    ['POS PURCHASE TESCO STORES 3297', 'Tesco Stores'],
    ['AMAZON.COM*2K4L59 AMZN.COM/BILL WA', 'Amazon'],
    ['Netflix', 'Netflix'],
  ])('%s -> %s', (raw, clean) => {
    expect(cleanPayee(raw)).toBe(clean);
  });
});

describe('categorizer', () => {
  const t = (payee: string, categoryId: string, amount = -500): Transaction => ({
    id: payee + categoryId + Math.random(),
    accountId: 'a',
    date: '2026-01-01',
    amount,
    payee,
    categoryId,
    notes: '',
    source: 'manual',
    importId: null,
    createdAt: '',
  });
  const c = new Categorizer([
    t('Tesco Stores', 'groceries'),
    t('Tesco Stores', 'groceries'),
    t('Shell Fuel', 'fuel'),
    t('Shell Garage', 'fuel'),
    t('Pizza Palace', 'eating'),
  ]);
  it('suggests from exact payee history with high confidence', () => {
    const s = c.suggest('TESCO STORES', -900)!;
    expect(s.categoryId).toBe('groceries');
    expect(s.confidence).toBeGreaterThan(0.9);
  });
  it('falls back to word matching for unseen payees', () => {
    expect(c.suggest('Shell Express', -900)?.categoryId).toBe('fuel');
    expect(c.suggest('Unknown Thing', -900)).toBeNull();
  });
});

import { parseOfx, parseQif, detectFileKind } from './formats';

describe('ofx and qif', () => {
  it('parses SGML OFX with FITIDs', () => {
    const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>12345
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261102120000[-5:EST]<TRNAMT>-4.50<FITID>A1<NAME>BLUE BOTTLE<MEMO>Coffee
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261103<TRNAMT>2000.00<FITID>A2<NAME>PAYROLL
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    expect(detectFileKind('x.qfx', ofx)).toBe('ofx');
    const r = parseOfx(ofx);
    expect(r.accountId).toBe('12345');
    expect(r.rows).toMatchObject([
      { date: '2026-11-02', amount: -450, payee: 'BLUE BOTTLE', memo: 'Coffee', externalId: 'A1' },
      { date: '2026-11-03', amount: 200000, payee: 'PAYROLL', externalId: 'A2' },
    ]);
  });
  it('parses QIF', () => {
    const qif = `!Type:Bank\nD11/02/2026\nT-4.50\nPBlue Bottle\n^\nD11/03/2026\nT2,000.00\nPPayroll\nMNovember\n^\n`;
    expect(detectFileKind('x.qif', qif)).toBe('qif');
    expect(parseQif(qif).rows).toMatchObject([
      { date: '2026-11-02', amount: -450, payee: 'Blue Bottle' },
      { date: '2026-11-03', amount: 200000, payee: 'Payroll', memo: 'November' },
    ]);
  });
});
