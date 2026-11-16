import type { Rule, RuleCondition, Transaction } from './types';

function conditionMatches(c: RuleCondition, t: Transaction): boolean {
  if (c.field === 'amount') {
    const amt = Math.abs(t.amount) / 100;
    const v = Number(c.value);
    const v2 = Number(c.value2);
    switch (c.op) {
      case 'equals':
        return Math.abs(amt - v) < 0.005;
      case 'gt':
        return amt > v;
      case 'lt':
        return amt < v;
      case 'between':
        return amt >= Math.min(v, v2) && amt <= Math.max(v, v2);
      default:
        return false;
    }
  }
  if (c.field === 'account') return t.accountId === c.value;
  const text = (c.field === 'originalPayee' ? (t.originalPayee ?? t.payee) : t.payee).toLowerCase();
  const v = c.value.toLowerCase();
  switch (c.op) {
    case 'contains':
      return text.includes(v);
    case 'equals':
      return text === v;
    case 'starts-with':
      return text.startsWith(v);
    case 'regex':
      try {
        return new RegExp(c.value, 'i').test(c.field === 'originalPayee' ? (t.originalPayee ?? t.payee) : t.payee);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export function ruleMatches(rule: Rule, t: Transaction): boolean {
  return rule.enabled && rule.conditions.length > 0 && rule.conditions.every((c) => conditionMatches(c, t));
}

/** Applies enabled rules in order; later rules override earlier ones. */
export function applyRules(t: Transaction, rules: Rule[]): { txn: Transaction; matched: Rule[] } {
  let out = t;
  const matched: Rule[] = [];
  for (const r of [...rules].sort((a, b) => a.order - b.order)) {
    if (!ruleMatches(r, out)) continue;
    matched.push(r);
    out = {
      ...out,
      ...(r.setCategoryId !== undefined && !out.splits?.length ? { categoryId: r.setCategoryId } : {}),
      ...(r.setPayee ? { payee: r.setPayee } : {}),
      ...(r.markReviewed ? { reviewed: true } : {}),
    };
  }
  return { txn: out, matched };
}
