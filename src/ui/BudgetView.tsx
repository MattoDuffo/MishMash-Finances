import { useState } from 'react';
import type { Nav } from './App';
import { useSession, todayIso, toInput } from './session';
import { getSettings, updateSettings } from '../domain/settings';
import { computeBudget, fiftyThirtyTwenty, averageSpending, moveMoney, type CategoryBudget } from '../domain/budget';
import { addMonths, monthLabel, monthOf } from '../domain/dates';
import { formatMoney, parseAmount } from '../domain/money';
import { GROUP_LABELS } from '../domain/defaults';
import type { BudgetMethod, BudgetMonth, Category, CategoryGroup } from '../domain/types';

const METHODS: [BudgetMethod, string, string][] = [
  ['zero-based', 'Zero-based', 'Give every dollar of income a job. Leftovers roll over to next month.'],
  ['envelope', 'Envelopes', 'Fill an envelope per category each month and spend only what’s inside.'],
  ['50-30-20', '50/30/20', 'Split income between needs, wants and savings by percentage.'],
  ['tracking', 'Just track', 'No budget: see what you spend compared with your usual months.'],
];

export function BudgetView({ nav }: { nav: Nav }) {
  void nav;
  const s = useSession();
  const settings = getSettings(s);
  const [month, setMonth] = useState(monthOf(todayIso()));
  const method = settings.budgetMethod;

  return (
    <section className="stack">
      <div className="row">
        <button className="btn ghost" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">‹</button>
        <h1 className="grow center-text">Budget · {monthLabel(month, 'long')}</h1>
        <button className="btn ghost" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">›</button>
      </div>
      <div className="segmented four" role="radiogroup" aria-label="Budgeting method">
        {METHODS.map(([m, label]) => (
          <button key={m} type="button" role="radio" aria-checked={method === m} className={method === m ? 'on' : ''} onClick={() => updateSettings(s, { budgetMethod: m })}>
            {label}
          </button>
        ))}
      </div>
      <p className="muted small">{METHODS.find(([m]) => m === method)?.[2]} Switching method keeps all your data.</p>
      {method === 'zero-based' || method === 'envelope' ? <AssignBudget month={month} envelope={method === 'envelope'} /> : method === '50-30-20' ? <FiftyThirtyTwenty month={month} /> : <Tracking month={month} />}
    </section>
  );
}

function AssignBudget({ month, envelope }: { month: string; envelope: boolean }) {
  const s = useSession();
  const cur = getSettings(s).baseCurrency;
  const fmt = (v: number) => formatMoney(v, cur);
  const view = computeBudget(month, s.list('categories'), s.list('budgets'), s.list('transactions'));
  const record: BudgetMonth = s.get('budgets', month) ?? { id: month, assigned: {} };
  const [moving, setMoving] = useState<CategoryBudget | null>(null);
  const [targetFor, setTargetFor] = useState<Category | null>(null);
  const words = envelope
    ? { rta: 'Cash not in an envelope', assigned: 'Filled', available: 'In envelope' }
    : { rta: 'Ready to assign', assigned: 'Assigned', available: 'Available' };

  const setAssigned = async (catId: string, value: number) => {
    await s.put('budgets', { ...record, assigned: { ...record.assigned, [catId]: value } });
  };
  const fillTargets = async () => {
    const assigned = { ...record.assigned };
    for (const r of view.rows) if (r.suggested > 0 && !assigned[r.category.id]) assigned[r.category.id] = r.suggested;
    await s.put('budgets', { ...record, assigned });
  };
  const copyLast = async () => {
    const last = s.get('budgets', addMonths(month, -1));
    if (last) await s.put('budgets', { id: month, assigned: { ...last.assigned, ...record.assigned } });
  };
  const groups = (['bills', 'everyday', 'lifestyle', 'savings'] as CategoryGroup[]).map((g) => [g, view.rows.filter((r) => r.category.group === g)] as const);
  const anySuggested = view.rows.some((r) => r.suggested > 0 && !record.assigned[r.category.id]);

  return (
    <>
      <div className="summary">
        <div>
          <span className="label">{words.rta}</span>
          <span className={'figure ' + (view.readyToAssign < 0 ? 'neg' : view.readyToAssign > 0 ? 'pos' : '')}>{fmt(view.readyToAssign)}</span>
          <span className="meta">{view.readyToAssign < 0 ? 'You’ve assigned more than you have. Take some back.' : view.readyToAssign > 0 ? 'Assign this to categories below.' : 'Every dollar has a job.'}</span>
        </div>
        <div>
          <span className="label">Income this month</span>
          <span className="figure">{fmt(view.income)}</span>
        </div>
        <div>
          <span className="label">Spent this month</span>
          <span className="figure">{fmt(-view.totalActivity)}</span>
        </div>
      </div>
      {view.overspent.length > 0 && (
        <p className="notice danger">
          Overspent: {view.overspent.map((r) => `${r.category.name} (${fmt(r.available)})`).join(', ')}. Tap the amount to cover it from another category.
        </p>
      )}
      <div className="row">
        {anySuggested && <button className="btn" onClick={fillTargets}>Assign target amounts</button>}
        {s.get('budgets', addMonths(month, -1)) && <button className="btn" onClick={copyLast}>Copy last month</button>}
      </div>
      {moving && <MoveMoney from={moving} rows={view.rows} onDone={async (to, amount) => { if (to) await s.put('budgets', moveMoney(record, to, moving.category.id, amount)); setMoving(null); }} />}
      {targetFor && <TargetEditor category={targetFor} onDone={() => setTargetFor(null)} />}
      {groups.map(([g, rows]) =>
        rows.length === 0 ? null : (
          <div key={g} className="day">
            <div className="budget-row head">
              <span>{GROUP_LABELS[g]}</span>
              <span>{words.assigned}</span>
              <span>Spent</span>
              <span>{words.available}</span>
            </div>
            {rows.map((r) => (
              <div key={r.category.id} className="budget-row">
                <button className="btn link cat-name" onClick={() => setTargetFor(r.category)} title="Set a target">
                  {r.category.name}
                  {r.category.target && <span className="meta">{targetText(r.category, cur)}{r.suggested > 0 && r.assigned < r.suggested ? ` · ${fmt(r.suggested - r.assigned)} to go` : ''}</span>}
                </button>
                <MoneyInput id={`assign-${r.category.id}`} label={`${words.assigned} for ${r.category.name}`} value={r.assigned} currency={cur} onCommit={(v) => setAssigned(r.category.id, v)} />
                <span className="amount muted">{fmt(-r.activity)}</span>
                <button className={'pill ' + (r.available < 0 ? 'bad' : r.available > 0 ? 'good' : '')} onClick={() => setMoving(r)} title="Move money">
                  {fmt(r.available)}
                </button>
              </div>
            ))}
          </div>
        ),
      )}
    </>
  );
}

function targetText(c: Category, cur: string): string {
  if (!c.target) return '';
  return c.target.type === 'monthly' ? `Target ${formatMoney(c.target.amount, cur)}/month` : `Save ${formatMoney(c.target.amount, cur)} by ${c.target.date}`;
}

function MoneyInput({ id, label, value, currency, onCommit }: { id: string; label: string; value: number; currency: string; onCommit: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const v = parseAmount(text || '0', currency);
    if (v !== null && v !== value) onCommit(v);
    setText(null);
  };
  return (
    <input
      id={id}
      aria-label={label}
      className="money-input"
      inputMode="decimal"
      value={text ?? (value ? toInput(value, currency) : '')}
      placeholder="0.00"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function MoveMoney({ from, rows, onDone }: { from: CategoryBudget; rows: CategoryBudget[]; onDone: (fromCat: string | null, amount: number) => void }) {
  const s = useSession();
  const cur = getSettings(s).baseCurrency;
  const covering = from.available < 0;
  const [other, setOther] = useState(rows.find((r) => r.category.id !== from.category.id && r.available > 0)?.category.id ?? '');
  const [amount, setAmount] = useState(toInput(Math.abs(from.available), cur));
  const amt = parseAmount(amount, cur) ?? 0;
  return (
    <div className="panel stack">
      <h3>{covering ? `Cover ${from.category.name}` : `Move money from ${from.category.name}`}</h3>
      <div className="grid2">
        <div className="field">
          <label htmlFor="move-amount">Amount</label>
          <input id="move-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="move-other">{covering ? 'Take it from' : 'Move it to'}</label>
          <select id="move-other" value={other} onChange={(e) => setOther(e.target.value)}>
            {rows.filter((r) => r.category.id !== from.category.id).map((r) => (
              <option key={r.category.id} value={r.category.id}>{r.category.name} ({formatMoney(r.available, cur)})</option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <span className="grow" />
        <button className="btn" onClick={() => onDone(null, 0)}>Cancel</button>
        <button
          className="btn primary"
          disabled={!other || amt <= 0}
          onClick={() => {
            // Positive moves go other -> this category; negative the other way.
            if (covering) onDone(other, amt);
            else onDone(other, -amt);
          }}
        >
          Move {formatMoney(amt, cur)}
        </button>
      </div>
    </div>
  );
}

function TargetEditor({ category, onDone }: { category: Category; onDone: () => void }) {
  const s = useSession();
  const cur = getSettings(s).baseCurrency;
  const t = category.target;
  const [type, setType] = useState<'none' | 'monthly' | 'by-date'>(t?.type ?? 'none');
  const [amount, setAmount] = useState(t ? toInput(t.amount, cur) : '');
  const [date, setDate] = useState(t?.type === 'by-date' ? t.date : '');
  const save = async () => {
    const amt = parseAmount(amount, cur);
    const target = type === 'none' || amt === null ? undefined : type === 'monthly' ? { type, amount: Math.abs(amt) } : { type, amount: Math.abs(amt), date: date || todayIso() };
    await s.put('categories', { ...category, target: target as Category['target'] });
    onDone();
  };
  return (
    <div className="panel stack">
      <h3>Target for {category.name}</h3>
      <div className="segmented three" role="radiogroup" aria-label="Target type">
        {([['none', 'No target'], ['monthly', 'Every month'], ['by-date', 'Save by a date']] as const).map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={type === v} className={type === v ? 'on' : ''} onClick={() => setType(v)}>{l}</button>
        ))}
      </div>
      {type !== 'none' && (
        <div className="grid2">
          <div className="field">
            <label htmlFor="target-amount">{type === 'monthly' ? 'Amount each month' : 'Total to save'}</label>
            <input id="target-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          {type === 'by-date' && (
            <div className="field">
              <label htmlFor="target-date">By</label>
              <input id="target-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          )}
        </div>
      )}
      {type === 'by-date' && <p className="muted small">Use this for irregular costs like insurance, holidays or car repairs. MishMash works out how much to set aside each month.</p>}
      <div className="row">
        <span className="grow" />
        <button className="btn" onClick={onDone}>Cancel</button>
        <button className="btn primary" onClick={save}>Save target</button>
      </div>
    </div>
  );
}

function FiftyThirtyTwenty({ month }: { month: string }) {
  const s = useSession();
  const settings = getSettings(s);
  const cur = settings.baseCurrency;
  const fmt = (v: number) => formatMoney(v, cur);
  const { income, buckets } = fiftyThirtyTwenty(month, s.list('categories'), s.list('transactions'), settings.split503020);
  const [edit, setEdit] = useState(false);
  const [split, setSplit] = useState(settings.split503020);
  const total = split.needs + split.wants + split.savings;
  return (
    <>
      <div className="summary">
        <div><span className="label">Income</span><span className="figure">{fmt(income)}</span></div>
      </div>
      {income <= 0 && <p className="notice warn">No income recorded this month. Categorise your pay as Salary or Other income to use 50/30/20.</p>}
      <div className="panel stack">
        {buckets.map((b) => {
          const pct = income > 0 ? (b.actual / income) * 100 : 0;
          const over = b.key === 'savings' ? b.actual < b.target : b.actual > b.target;
          return (
            <div key={b.key} className="bucket">
              <div className="row">
                <strong className="grow">{b.label}</strong>
                <span className={'pill ' + (over ? 'bad' : 'good')}>{over ? (b.key === 'savings' ? 'Below target' : 'Over target') : 'On track'}</span>
              </div>
              <div className="bucket-track">
                <div className="bucket-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                <div className="bucket-target" style={{ left: `${b.targetPct}%` }} title={`Target ${b.targetPct}%`} />
              </div>
              <span className="meta">
                {fmt(b.actual)} ({pct.toFixed(0)}% of income) · target {b.targetPct}% = {fmt(b.target)}
              </span>
            </div>
          );
        })}
        <p className="muted small">Needs are Bills and Everyday categories, Wants are Lifestyle and uncategorised spending, Savings is what’s left of income.</p>
        {edit ? (
          <div className="stack">
            <div className="grid3">
              {(['needs', 'wants', 'savings'] as const).map((k) => (
                <div className="field" key={k}>
                  <label htmlFor={`split-${k}`}>{k[0].toUpperCase() + k.slice(1)} %</label>
                  <input id={`split-${k}`} inputMode="numeric" value={split[k]} onChange={(e) => setSplit({ ...split, [k]: Number(e.target.value) || 0 })} />
                </div>
              ))}
            </div>
            {total !== 100 && <p className="error small">These add up to {total}%. They need to add up to 100%.</p>}
            <div className="row">
              <button className="btn" onClick={() => setEdit(false)}>Cancel</button>
              <button className="btn primary" disabled={total !== 100} onClick={async () => { await updateSettings(s, { split503020: split }); setEdit(false); }}>Save</button>
            </div>
          </div>
        ) : (
          <button className="btn link" onClick={() => setEdit(true)}>Change percentages</button>
        )}
      </div>
    </>
  );
}

function Tracking({ month }: { month: string }) {
  const s = useSession();
  const cur = getSettings(s).baseCurrency;
  const fmt = (v: number) => formatMoney(v, cur);
  const cats = s.list('categories');
  const view = computeBudget(month, cats, [], s.list('transactions'));
  const avg = averageSpending(month, cats, s.list('transactions'));
  const rows = view.rows.filter((r) => r.activity !== 0 || (avg.get(r.category.id) ?? 0) !== 0).sort((a, b) => a.activity - b.activity);
  return (
    <div className="day">
      <div className="budget-row head">
        <span>Category</span>
        <span>This month</span>
        <span>Usual</span>
        <span>Difference</span>
      </div>
      {rows.length === 0 && <p className="muted pad">No spending this month yet.</p>}
      {rows.map((r) => {
        const usual = -(avg.get(r.category.id) ?? 0);
        const spent = -r.activity;
        const diff = spent - usual;
        return (
          <div key={r.category.id} className="budget-row">
            <span>{r.category.name}</span>
            <span className="amount">{fmt(spent)}</span>
            <span className="amount muted">{fmt(usual)}</span>
            <span className={'pill ' + (usual > 0 && diff > usual * 0.1 ? 'bad' : 'good')}>{diff > 0 ? '+' : ''}{fmt(diff)}</span>
          </div>
        );
      })}
      <p className="muted small pad">“Usual” is your average over the previous 3 months.</p>
    </div>
  );
}
