/**
 * Learns categories from transactions the user has already categorised.
 * Two signals: an exact match on the cleaned payee (strongest), and a
 * naive Bayes model over payee words for payees it hasn't seen before.
 * Runs entirely on the device.
 */
import type { Id, Transaction } from './types';
import { payeeKey } from './payee';

export interface Suggestion {
  categoryId: Id;
  confidence: number; // 0..1
}

const tokens = (payee: string) => payeeKey(payee).split(' ').filter((w) => w.length > 1);

export class Categorizer {
  private exact = new Map<string, Map<Id, number>>();
  private tokenCounts = new Map<Id, Map<string, number>>();
  private catTotals = new Map<Id, number>();
  private vocab = new Set<string>();
  private docs = 0;

  constructor(history: Transaction[]) {
    for (const t of history) {
      if (!t.categoryId || t.reviewed === false || t.splits?.length) continue;
      const key = payeeKey(t.payee) + (t.amount > 0 ? '+' : '-');
      const m = this.exact.get(key) ?? new Map<Id, number>();
      m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + 1);
      this.exact.set(key, m);

      const tc = this.tokenCounts.get(t.categoryId) ?? new Map<string, number>();
      for (const w of tokens(t.payee)) {
        tc.set(w, (tc.get(w) ?? 0) + 1);
        this.vocab.add(w);
      }
      this.tokenCounts.set(t.categoryId, tc);
      this.catTotals.set(t.categoryId, (this.catTotals.get(t.categoryId) ?? 0) + 1);
      this.docs++;
    }
  }

  suggest(payee: string, amount: number): Suggestion | null {
    const exact = this.exact.get(payeeKey(payee) + (amount > 0 ? '+' : '-'));
    if (exact) {
      const total = [...exact.values()].reduce((a, b) => a + b, 0);
      const [cat, n] = [...exact.entries()].sort((a, b) => b[1] - a[1])[0];
      return { categoryId: cat, confidence: Math.min(0.99, (n / total) * (total >= 2 ? 1 : 0.85)) };
    }
    const words = tokens(payee).filter((w) => this.vocab.has(w));
    if (words.length === 0 || this.docs === 0) return null;
    const V = this.vocab.size;
    const scores: [Id, number][] = [];
    for (const [cat, docs] of this.catTotals) {
      const tc = this.tokenCounts.get(cat)!;
      const totalTokens = [...tc.values()].reduce((a, b) => a + b, 0);
      let score = Math.log(docs / this.docs);
      for (const w of words) score += Math.log(((tc.get(w) ?? 0) + 1) / (totalTokens + V));
      scores.push([cat, score]);
    }
    scores.sort((a, b) => b[1] - a[1]);
    const max = scores[0][1];
    const sum = scores.reduce((a, [, s]) => a + Math.exp(s - max), 0);
    const p = 1 / sum;
    // Without an exact match, cap confidence so these always get a human look.
    return { categoryId: scores[0][0], confidence: Math.min(0.8, p) };
  }
}
