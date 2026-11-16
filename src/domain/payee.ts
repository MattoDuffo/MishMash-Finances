/**
 * Turns raw bank descriptions into readable payee names, for example
 * "SQ *BLUE BOTTLE COFFEE 1234 SAN FRANCISCO CA" -> "Blue Bottle Coffee".
 */

const PREFIXES = [
  /^(sq|sqr|tst|sp|pp|paypal|py|ext|dd|so|bp|fpi|fpo|bgc|pos|vis|visa|dbt|chk|ach|ckcd|purchase|debit card purchase|card purchase|recurring payment|preauthorized debit|pos purchase|pos debit|contactless|cnp)\s*[*#:-]?\s*/i,
];
const NOISE = [
  /\b(x{2,}|\*{2,})\d{2,}\b/gi, // masked card numbers
  /\b\d{4,}\b/g, // long numbers: store ids, references
  /\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/g, // dates
  /\b(ref|reference|id|auth|trace|card)\s*[:#]?\s*\w*\d\w*\b/gi,
  /\s+[A-Z]{2}\s*$/, // trailing state/country code
  /\bwww\.|\.com\b|\.co\.uk\b/gi,
];
const KEEP_UPPER = new Set(['ATM', 'ACH', 'USA', 'UK', 'BP', 'IKEA', 'H&M', 'TJ', 'CVS', 'AT&T', 'KFC', 'HMRC', 'EE', 'O2', 'LLC']);

export function cleanPayee(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  // Strip processor prefixes, repeatedly ("POS PURCHASE ...").
  for (let prev = ''; prev !== s; ) {
    prev = s;
    for (const p of PREFIXES) s = s.replace(p, '');
  }
  // "AMAZON.COM*2K4L59 ..." -> keep what comes before the star.
  const star = s.indexOf('*');
  if (star > 2) s = s.slice(0, star);
  // A store number usually ends the name; what follows is the location.
  const storeNo = s.match(/^(.*?[A-Za-z].*?)\s+#?\d{3,}\b/);
  if (storeNo) s = storeNo[1];
  for (const n of NOISE) s = s.replace(n, ' ');
  s = s
    .split(' ')
    .filter((w) => !(w.length >= 5 && /\d/.test(w) && /[a-z]/i.test(w))) // reference codes
    .join(' ')
    .replace(/[*#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = s.split(' ');
  if (words.length > 4) s = words.slice(0, 4).join(' ');
  if (!s) return raw.trim();
  const isAllCaps = s === s.toUpperCase();
  return s
    .split(' ')
    .map((w) => {
      if (KEEP_UPPER.has(w.toUpperCase())) return w.toUpperCase();
      if (!isAllCaps) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/** A stable key for grouping payees: lower case, letters only. */
export function payeeKey(payee: string): string {
  return cleanPayee(payee)
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
}
