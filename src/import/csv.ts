/** RFC 4180 CSV parsing with delimiter detection. */

const CANDIDATES = [',', ';', '\t', '|'];

/** Picks the delimiter that gives the most consistent column count. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ',';
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = lines.map((l) => parseCsv(l, d)[0]?.length ?? 0);
    if (counts.length === 0 || counts[0] < 2) continue;
    const mode = counts.sort((a, b) => counts.filter((x) => x === b).length - counts.filter((x) => x === a).length)[0];
    const consistent = counts.filter((c) => c === mode).length;
    const score = consistent * 100 + mode;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // byte-order mark
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      field = '';
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ''));
}

/**
 * Finds where the transaction table starts. Bank exports (DBS/POSB, OCBC,
 * UOB and others) often begin with account details, a statement period or
 * blank lines before the real header row.
 */
export function findTableStart(rows: string[][]): number {
  const dateLike = /^(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}|\d{1,2}[ -][A-Za-z]{3}[ -]\d{2,4}|\d{8})$/;
  const isDataRow = (r: string[]) => r.filter((c) => c).length >= 2 && r.some((c) => dateLike.test(c.trim()));
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const next = rows.slice(i + 1, i + 4);
    if (next.length === 0) break;
    const width = rows[i].length;
    const looksLikeHeader = width >= 3 && !isDataRow(rows[i]) && rows[i].some((c) => /date/i.test(c));
    if (looksLikeHeader && next.every((r) => r.length >= width - 1) && next.some(isDataRow)) return i;
    // No header at all: the first of several data rows of the same width.
    if (width >= 3 && isDataRow(rows[i]) && next.length >= 2 && next.every((r) => r.length === width && isDataRow(r))) return i;
  }
  return 0;
}

/** Escapes one row for CSV export. */
export function toCsvRow(fields: (string | number)[]): string {
  return fields
    .map((f) => {
      const s = String(f);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}
