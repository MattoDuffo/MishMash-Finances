import { useState } from 'react';
import { useSession } from './session';
import { newId, type Rule, type RuleCondition, type RuleField, type RuleOp, type Transaction } from '../domain/types';
import { applyRules, ruleMatches } from '../domain/rules';
import { CategorySelect } from './CategorySelect';

export function ruleFromTransaction(t: Transaction, categoryId: string | null, order: number): Rule {
  return {
    id: newId(),
    name: `${t.payee} → ${categoryId ? 'category' : 'uncategorized'}`,
    enabled: true,
    order,
    conditions: [{ field: 'payee', op: 'contains', value: t.payee.toLowerCase() }],
    setCategoryId: categoryId,
    markReviewed: true,
  };
}

const FIELDS: [RuleField, string][] = [
  ['payee', 'Payee'],
  ['originalPayee', 'Bank description'],
  ['amount', 'Amount'],
  ['account', 'Account'],
];
const TEXT_OPS: [RuleOp, string][] = [
  ['contains', 'contains'],
  ['equals', 'is exactly'],
  ['starts-with', 'starts with'],
  ['regex', 'matches pattern'],
];
const AMOUNT_OPS: [RuleOp, string][] = [
  ['equals', 'equals'],
  ['gt', 'is more than'],
  ['lt', 'is less than'],
  ['between', 'is between'],
];

export function RulesView({ onClose }: { onClose: () => void }) {
  const s = useSession();
  const rules = s.list('rules').sort((a, b) => a.order - b.order);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [note, setNote] = useState('');

  const runOnExisting = async (onlyUncategorised: boolean) => {
    const changed: Transaction[] = [];
    for (const t of s.list('transactions')) {
      if (t.transferId || (onlyUncategorised && (t.categoryId || t.splits?.length))) continue;
      const { txn, matched } = applyRules(t, rules);
      if (matched.length && (txn.categoryId !== t.categoryId || txn.payee !== t.payee || txn.reviewed !== t.reviewed)) changed.push(txn);
    }
    await s.putMany('transactions', changed);
    setNote(`Updated ${changed.length} transaction${changed.length === 1 ? '' : 's'}.`);
  };

  const move = async (r: Rule, dir: -1 | 1) => {
    const i = rules.indexOf(r);
    const other = rules[i + dir];
    if (!other) return;
    await s.putMany('rules', [{ ...r, order: other.order }, { ...other, order: r.order }]);
  };

  return (
    <section className="stack">
      <div className="row">
        <h1 className="grow">Rules</h1>
        <button className="btn ghost" onClick={onClose}>Done</button>
      </div>
      <p className="muted">Rules run on every import, top to bottom. A later rule overrides an earlier one.</p>
      {editing ? (
        <RuleForm initial={editing} onDone={() => setEditing(null)} />
      ) : (
        <div className="row">
          <button className="btn primary" onClick={() => setEditing({ id: newId(), name: '', enabled: true, order: rules.length, conditions: [{ field: 'payee', op: 'contains', value: '' }], setCategoryId: undefined, markReviewed: true })}>
            New rule
          </button>
          {rules.length > 0 && (
            <>
              <button className="btn" onClick={() => runOnExisting(true)}>Apply to uncategorized</button>
              <button className="btn" onClick={() => runOnExisting(false)}>Apply to all</button>
            </>
          )}
        </div>
      )}
      {note && <p className="notice ok">{note}</p>}
      {rules.length === 0 ? (
        <p className="muted">No rules yet. You can also create one from the review inbox with “Always use this category”.</p>
      ) : (
        <ul className="cards">
          {rules.map((r, i) => {
            const count = s.list('transactions').filter((t) => ruleMatches({ ...r, enabled: true }, t)).length;
            return (
              <li key={r.id} className={'panel row ' + (r.enabled ? '' : 'archived')}>
                <span className="grow">
                  <span className="payee">{r.name || 'Untitled rule'}</span>
                  <span className="meta">
                    {describe(r, s.get('categories', r.setCategoryId ?? '')?.name)} · matches {count}
                  </span>
                </span>
                <button className="btn ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(r, -1)}>↑</button>
                <button className="btn ghost" aria-label="Move down" disabled={i === rules.length - 1} onClick={() => move(r, 1)}>↓</button>
                <button className="btn" onClick={() => setEditing(r)}>Edit</button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function describe(r: Rule, catName?: string): string {
  const conds = r.conditions.map((c) => `${FIELDS.find(([f]) => f === c.field)?.[1]} ${[...TEXT_OPS, ...AMOUNT_OPS].find(([o]) => o === c.op)?.[1] ?? c.op} “${c.value}”${c.op === 'between' ? ` and “${c.value2}”` : ''}`).join(' and ');
  const acts = [r.setCategoryId !== undefined ? `category: ${catName ?? 'Uncategorized'}` : '', r.setPayee ? `rename to ${r.setPayee}` : ''].filter(Boolean).join(', ');
  return `If ${conds} → ${acts || 'nothing'}${r.enabled ? '' : ' (off)'}`;
}

function RuleForm({ initial, onDone }: { initial: Rule; onDone: () => void }) {
  const s = useSession();
  const [r, setR] = useState<Rule>(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const exists = Boolean(s.get('rules', initial.id));
  const setCond = (i: number, patch: Partial<RuleCondition>) => setR({ ...r, conditions: r.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const preview = s.list('transactions').filter((t) => ruleMatches({ ...r, enabled: true }, t));
  const valid = r.conditions.every((c) => c.value.trim() !== '') && (r.setCategoryId !== undefined || r.setPayee);

  return (
    <div className="panel stack">
      <h2>{exists ? 'Edit rule' : 'New rule'}</h2>
      <div className="field">
        <label htmlFor="rule-name">Name</label>
        <input id="rule-name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="Coffee shops" />
      </div>
      <h3>When all of these match</h3>
      {r.conditions.map((c, i) => (
        <div key={i} className="cond-row">
          <select id={`rule-field-${i}`} aria-label="Field" value={c.field} onChange={(e) => setCond(i, { field: e.target.value as RuleField, op: e.target.value === 'amount' ? 'equals' : e.target.value === 'account' ? 'is' : 'contains', value: '' })}>
            {FIELDS.map(([f, l]) => <option key={f} value={f}>{l}</option>)}
          </select>
          {c.field === 'account' ? (
            <select id={`rule-value-${i}`} aria-label="Account" value={c.value} onChange={(e) => setCond(i, { value: e.target.value })}>
              <option value="">Choose…</option>
              {s.list('accounts').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          ) : (
            <>
              <select id={`rule-op-${i}`} aria-label="Comparison" value={c.op} onChange={(e) => setCond(i, { op: e.target.value as RuleOp })}>
                {(c.field === 'amount' ? AMOUNT_OPS : TEXT_OPS).map(([o, l]) => <option key={o} value={o}>{l}</option>)}
              </select>
              <input id={`rule-value-${i}`} aria-label="Value" value={c.value} inputMode={c.field === 'amount' ? 'decimal' : undefined} onChange={(e) => setCond(i, { value: e.target.value })} />
              {c.op === 'between' && <input id={`rule-value2-${i}`} aria-label="Upper value" inputMode="decimal" value={c.value2 ?? ''} onChange={(e) => setCond(i, { value2: e.target.value })} />}
            </>
          )}
          {r.conditions.length > 1 && <button className="btn ghost" aria-label="Remove condition" onClick={() => setR({ ...r, conditions: r.conditions.filter((_, j) => j !== i) })}>×</button>}
        </div>
      ))}
      <button className="btn link small" onClick={() => setR({ ...r, conditions: [...r.conditions, { field: 'payee', op: 'contains', value: '' }] })}>Add condition</button>
      <h3>Then</h3>
      <label className="check">
        <input id="rule-set-cat" type="checkbox" checked={r.setCategoryId !== undefined} onChange={(e) => setR({ ...r, setCategoryId: e.target.checked ? null : undefined })} />
        Set the category
      </label>
      {r.setCategoryId !== undefined && <CategorySelect id="rule-category" value={r.setCategoryId} onChange={(v) => setR({ ...r, setCategoryId: v })} />}
      <div className="field">
        <label htmlFor="rule-payee">Rename payee to (optional)</label>
        <input id="rule-payee" value={r.setPayee ?? ''} onChange={(e) => setR({ ...r, setPayee: e.target.value || undefined })} />
      </div>
      <label className="check">
        <input id="rule-reviewed" type="checkbox" checked={Boolean(r.markReviewed)} onChange={(e) => setR({ ...r, markReviewed: e.target.checked })} />
        Skip the review inbox for these
      </label>
      <label className="check">
        <input id="rule-enabled" type="checkbox" checked={r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} />
        Rule is on
      </label>
      <p className="muted small">Matches {preview.length} existing transaction{preview.length === 1 ? '' : 's'}{preview.length ? `, e.g. ${preview.slice(0, 3).map((t) => t.payee).join(', ')}` : ''}.</p>
      <div className="row">
        {exists &&
          (confirmDelete ? (
            <button className="btn danger" onClick={async () => { await s.delete('rules', r.id); onDone(); }}>Confirm delete</button>
          ) : (
            <button className="btn ghost danger" onClick={() => setConfirmDelete(true)}>Delete</button>
          ))}
        <span className="grow" />
        <button className="btn" onClick={onDone}>Cancel</button>
        <button className="btn primary" disabled={!valid} onClick={async () => { await s.put('rules', { ...r, name: r.name.trim() || r.conditions[0].value }); onDone(); }}>Save rule</button>
      </div>
    </div>
  );
}
