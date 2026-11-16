/** OFX/QFX and QIF statement parsing into the same rows the CSV path produces. */
import type { RawRow, RowError } from './pipeline';
import { parseAmount } from '../domain/money';
import { detectDateFormats, parseDate } from './dates';

export function detectFileKind(name: string, text: string): 'csv' | 'ofx' | 'qif' {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'ofx' || ext === 'qfx' || /<OFX>/i.test(text.slice(0, 4000))) return 'ofx';
  if (ext === 'qif' || /^!Type:/im.test(text.slice(0, 200))) return 'qif';
  return 'csv';
}

/** OFX 1.x (SGML, unclosed tags) and 2.x (XML) both work with tag scanning. */
export function parseOfx(text: string): { rows: RawRow[]; errors: RowError[]; accountId?: string } {
  const tag = (block: string, name: string) => {
    const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
    return m ? m[1].trim() : '';
  };
  const rows: RawRow[] = [];
  const errors: RowError[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  blocks.forEach((raw, i) => {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const dt = tag(block, 'DTPOSTED').slice(0, 8);
    const date = parseDate(dt, 'YYYYMMDD');
    const amount = parseAmount(tag(block, 'TRNAMT'));
    if (!date || amount === null) {
      errors.push({ line: i + 1, reason: 'Missing date or amount' });
      return;
    }
    const name = tag(block, 'NAME') || tag(block, 'PAYEE');
    const memo = tag(block, 'MEMO');
    rows.push({ line: i + 1, date, amount, payee: name || memo, memo: name ? memo : '', externalId: tag(block, 'FITID') || undefined });
  });
  return { rows, errors, accountId: tag(text, 'ACCTID') || undefined };
}

export function parseQif(text: string): { rows: RawRow[]; errors: RowError[] } {
  const records = text.split(/^\^\s*$/m);
  const parsed = records
    .map((rec) => {
      const f: Record<string, string> = {};
      for (const line of rec.split(/\r?\n/)) {
        if (!line || line.startsWith('!')) continue;
        f[line[0]] ??= line.slice(1).trim();
      }
      return f;
    })
    .filter((f) => f.D && (f.T || f.U));
  // QIF dates vary by exporter: 11/03/2026, 11/3'26, 2026-11-03.
  const dates = parsed.map((f) => f.D.replace(/'\s*/, '/').replace(/\s/g, ''));
  const fmt = detectDateFormats(dates)[0];
  const rows: RawRow[] = [];
  const errors: RowError[] = [];
  parsed.forEach((f, i) => {
    const date = fmt ? parseDate(dates[i], fmt) : null;
    const amount = parseAmount(f.T ?? f.U);
    if (!date || amount === null) {
      errors.push({ line: i + 1, reason: 'Missing date or amount' });
      return;
    }
    rows.push({ line: i + 1, date, amount, payee: f.P || f.M || '', memo: f.P ? (f.M ?? '') : '' });
  });
  return { rows, errors };
}
