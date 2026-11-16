import { useState } from 'react';
import type { Nav } from './App';
import { useSession, todayIso, toInput, compactMoney } from './session';
import { getSettings, updateSettings } from '../domain/settings';
import { detectRecurring, expectedAmount, monthlyCost, upcoming, type Recurring } from '../domain/recurring';
import { cashForecast } from '../domain/forecast';
import { simulatePayoff, type Debt, type Strategy } from '../domain/debt';
import { balanceOn } from '../domain/wealth';
import { addDays, addMonths, daysBetween, monthLabel, monthOf, monthsBetween } from '../domain/dates';
import { formatMoney, parseAmount } from '../domain/money';
import { DEBT_KINDS, newId, type Goal } from '../domain/types';
import { LineChart } from './charts';
import { formatDate } from './TransactionsView';

const SECTIONS: [string, string][] = [
  ['bills', 'Bills'],
  ['forecast', 'Forecast'],
  ['goals', 'Goals'],
  ['debt', 'Debt'],
];

export function PlanView({ nav }: { nav: Nav }) {
  const sub = SECTIONS.some(([k]) => k === nav.sub) ? nav.sub! : 'bills';
  return (
    <section className="stack">
      <h1>Plan</h1>
      <div className="segmented four" role="tablist" aria-label="Plan sections">
        {SECTIONS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => nav.go('plan', k)}>{l}</button>
        ))}
      </div>
      {sub === 'bills' && <Bills />}
      {sub === 'forecast' && <Forecast />}
      {sub === 'goals' && <Goals />}
      {sub === 'debt' && <DebtPlanner nav={nav} />}
    </section>
  );
}

const CADENCE_LABEL = { weekly: 'Weekly', fortnightly: 'Every 2 weeks', 'twice-monthly': 'Twice a month', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

function Bills() {
  const s = useSession();
  const settings = getSettings(s);
  const cur = settings.baseCurrency;
  const fmt = (v: number, c = cur) => formatMoney(v, c);
  const today = todayIso();
  const all = detectRecurring(s.list('transactions'), today, s.list('categories'));
  const items = all.filter((r) => !settings.dismissedRecurring.includes(r.key));
  const subs = items.filter((r) => r.isSubscription);
  const bills = items.filter((r) => !r.isSubscription && !r.isIncome && !r.isTransfer);
  const income = items.filter((r) => r.isIncome && !r.isTransfer);
  const transfers = items.filter((r) => r.isTransfer && r.amount < 0);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const dismiss = (r: Recurring) => updateSettings(s, { dismissedRecurring: [...settings.dismissedRecurring, r.key] });
  const subTotal = subs.reduce((n, r) => n + monthlyCost(r), 0);
  // Possible duplicates: two subscriptions whose names share a first word.
  const firstWord = (p: string) => p.toLowerCase().split(' ')[0];
  const dupes = subs.filter((a, i) => subs.some((b, j) => j !== i && firstWord(a.payee) === firstWord(b.payee)));

  if (items.length === 0) {
    return (
      <div className="empty">
        <h2>No regular payments found yet</h2>
        <p className="muted">MishMash spots bills, subscriptions and pay once it has seen them at least three times (twice for yearly ones). Import a few months of history to see them here.</p>
      </div>
    );
  }

  const row = (r: Recurring) => (
    <li key={r.key} className="recurring">
      <span className="grow">
        <span className="payee">{r.payee}</span>
        <span className="meta">
          {CADENCE_LABEL[r.cadence]} · next {formatDate(r.nextDate)} · {s.get('accounts', r.accountId)?.name}
          {r.variable && ' · amount varies'}
        </span>
        {r.priceChange && <span className="pill bad small-pill">Went up from {fmt(-r.priceChange.from)} to {fmt(-r.priceChange.to)}</span>}
      </span>
      <span className={'amount ' + (r.isIncome ? 'pos' : '')}>{r.variable ? '≈ ' : ''}{fmt(expectedAmount(r), s.get('accounts', r.accountId)?.currency)}</span>
      <button className="btn ghost small" onClick={() => dismiss(r)} title="Not a regular payment">Hide</button>
    </li>
  );

  return (
    <>
      <div className="summary">
        <div><span className="label">Subscriptions</span><span className="figure">{fmt(-subTotal)}<small>/month</small></span><span className="meta">{fmt(-subTotal * 12)} a year</span></div>
        <div><span className="label">Bills</span><span className="figure">{fmt(-bills.reduce((n, r) => n + monthlyCost(r), 0))}<small>/month</small></span></div>
        <div><span className="label">Regular income</span><span className="figure">{fmt(income.reduce((n, r) => n + monthlyCost(r), 0))}<small>/month</small></span></div>
      </div>
      {dupes.length > 0 && <p className="notice warn">Possible duplicate subscriptions: {dupes.map((d) => d.payee).join(', ')}. Check whether you’re paying twice.</p>}
      <div className="segmented" role="radiogroup" aria-label="View">
        <button role="radio" aria-checked={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
        <button role="radio" aria-checked={view === 'calendar'} className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}>Calendar</button>
      </div>
      {view === 'calendar' ? (
        <BillCalendar items={items} />
      ) : (
        <>
          {subs.length > 0 && <div className="panel stack"><h2>Subscriptions</h2><ul className="plain">{subs.map(row)}</ul><p className="muted small">To cancel one, go to the provider’s website or app. MishMash never contacts anyone on your behalf.</p></div>}
          {bills.length > 0 && <div className="panel stack"><h2>Bills and regular payments</h2><ul className="plain">{bills.map(row)}</ul></div>}
          {income.length > 0 && <div className="panel stack"><h2>Regular income</h2><ul className="plain">{income.map(row)}</ul></div>}
          {transfers.length > 0 && <div className="panel stack"><h2>Regular transfers</h2><p className="muted small">Money you move between your own accounts, such as card payments and savings. Not counted as spending.</p><ul className="plain">{transfers.map(row)}</ul></div>}
        </>
      )}
      {settings.dismissedRecurring.length > 0 && (
        <button className="btn link small" onClick={() => updateSettings(s, { dismissedRecurring: [] })}>Show {settings.dismissedRecurring.length} hidden</button>
      )}
    </>
  );
}

function BillCalendar({ items }: { items: Recurring[] }) {
  const s = useSession();
  const cur = getSettings(s).baseCurrency;
  const [month, setMonth] = useState(monthOf(todayIso()));
  const first = `${month}-01`;
  const startDow = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday first
  const days = daysBetween(first, `${addMonths(month, 1)}-01`);
  const occ = upcoming(items, first, addDays(first, days - 1));
  const today = todayIso();
  return (
    <div className="panel stack">
      <div className="row">
        <button className="btn ghost" onClick={() => setMonth(addMonths(month, -1))} disabled={month <= monthOf(today)} aria-label="Previous month">‹</button>
        <h2 className="grow center-text">{monthLabel(month, 'long')}</h2>
        <button className="btn ghost" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">›</button>
      </div>
      <div className="calendar">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cal-head">{d}</div>)}
        {Array.from({ length: startDow }, (_, i) => <div key={'b' + i} />)}
        {Array.from({ length: days }, (_, i) => {
          const date = addDays(first, i);
          const todays = occ.filter((o) => o.date === date);
          return (
            <div key={date} className={'cal-day ' + (date === today ? 'today' : '') + (date < today ? ' past' : '')}>
              <span className="cal-num">{i + 1}</span>
              {todays.map((o) => (
                <span key={o.item.key} className={'cal-item ' + (o.item.isIncome ? 'in' : '')} title={`${o.item.payee}: ${formatMoney(expectedAmount(o.item), cur)}`}>
                  {o.item.payee}
                </span>
              ))}
            </div>
          );
        })}
      </div>
      <ul className="plain small">
        {occ.filter((o) => o.date >= today).map((o) => (
          <li key={o.item.key + o.date} className="row">
            <span className="grow">{o.date.slice(8)} · {o.item.payee}</span>
            <span className={'amount ' + (o.item.isIncome ? 'pos' : '')}>{formatMoney(expectedAmount(o.item), cur)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Forecast() {
  const s = useSession();
  const today = todayIso();
  const [days, setDays] = useState(60);
  const recurring = detectRecurring(s.list('transactions'), today, s.list('categories'));
  const f = cashForecast(s.list('accounts'), s.list('transactions'), recurring, today, days);
  const fmt = (v: number) => formatMoney(v, f.currency);
  const events = f.series.filter((d) => d.events.length > 0);
  return (
    <>
      <p className="muted">Your checking, savings and cash balances, projected forward using the regular bills and income MishMash has found.</p>
      <div className="summary">
        <div><span className="label">Now</span><span className="figure">{fmt(f.start)}</span></div>
        <div><span className="label">Lowest point</span><span className={'figure ' + (f.lowest.balance < 0 ? 'neg' : '')}>{fmt(f.lowest.balance)}</span><span className="meta">{formatDate(f.lowest.date)}</span></div>
        <div><span className="label">In {days} days</span><span className="figure">{fmt(f.end)}</span></div>
      </div>
      {f.lowest.balance < 0 && <p className="notice danger">You could be short by {fmt(-f.lowest.balance)} around {formatDate(f.lowest.date)}. Consider moving money or delaying a payment.</p>}
      <div className="panel stack">
        <div className="row">
          <h2 className="grow">Projected balance</h2>
          <select id="forecast-days" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Forecast length">
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
        <LineChart
          ariaLabel="Projected cash balance"
          markLowest
          format={fmt}
          compact={(v) => compactMoney(v, f.currency)}
          points={f.series.map((d) => ({ x: Date.parse(d.date), y: d.balance, label: new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) }))}
        />
      </div>
      <div className="panel stack">
        <h2>Expected</h2>
        {events.length === 0 ? <p className="muted">No regular payments expected in this period.</p> : (
          <ul className="plain">
            {events.flatMap((d) => d.events.map((e, i) => (
              <li key={d.date + i} className="row">
                <span className="grow">{e.payee} <span className="meta">· {formatDate(d.date)}</span></span>
                <span className={'amount ' + (e.amount > 0 ? 'pos' : '')}>{fmt(e.amount)}</span>
                <span className="amount muted">{fmt(d.balance)}</span>
              </li>
            )))}
          </ul>
        )}
      </div>
    </>
  );
}

function Goals() {
  const s = useSession();
  const cur = getSettings(s).baseCurrency;
  const fmt = (v: number) => formatMoney(v, cur);
  const goals = s.list('goals').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const [editing, setEditing] = useState<Goal | null>(null);
  const today = todayIso();
  const progressOf = (g: Goal) => (g.accountId && s.get('accounts', g.accountId) ? balanceOn(s.get('accounts', g.accountId)!, today, s.list('transactions'), s.list('valuations')) : g.saved);

  return (
    <>
      {editing ? <GoalForm initial={editing} onDone={() => setEditing(null)} /> : (
        <button className="btn primary" onClick={() => setEditing({ id: newId(), name: '', target: 0, targetDate: null, accountId: null, saved: 0, createdAt: new Date().toISOString() })}>New goal</button>
      )}
      {goals.length === 0 && !editing && <p className="muted">Set a goal like an emergency fund or a house deposit. Link it to a savings account and progress updates with each import.</p>}
      <ul className="cards">
        {goals.map((g) => {
          const have = progressOf(g);
          const pct = g.target > 0 ? Math.min(100, (have / g.target) * 100) : 0;
          const months = g.targetDate ? Math.max(1, monthsBetween(monthOf(today), monthOf(g.targetDate))) : null;
          const perMonth = months ? Math.max(0, Math.ceil((g.target - have) / months)) : null;
          return (
            <li key={g.id} className="panel stack">
              <div className="row">
                <strong className="grow">{g.name}</strong>
                <button className="btn" onClick={() => setEditing(g)}>Edit</button>
              </div>
              <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct}%` }} /></div>
              <span className="meta">
                {fmt(have)} of {fmt(g.target)} ({pct.toFixed(0)}%)
                {g.accountId && ` · from ${s.get('accounts', g.accountId)?.name ?? 'deleted account'}`}
              </span>
              {have >= g.target ? <span className="pill good">Reached</span> : perMonth !== null && <span className="meta">Save {fmt(perMonth)} a month to reach it by {formatDate(g.targetDate!)}.</span>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function GoalForm({ initial, onDone }: { initial: Goal; onDone: () => void }) {
  const s = useSession();
  const cur = getSettings(s).baseCurrency;
  const [g, setG] = useState(initial);
  const [target, setTarget] = useState(initial.target ? toInput(initial.target, cur) : '');
  const [saved, setSaved] = useState(initial.saved ? toInput(initial.saved, cur) : '');
  const [error, setError] = useState('');
  const exists = Boolean(s.get('goals', g.id));
  const save = async () => {
    const t = parseAmount(target, cur);
    if (!g.name.trim()) return setError('Give the goal a name.');
    if (!t || t <= 0) return setError('Enter the amount you want to reach.');
    await s.put('goals', { ...g, name: g.name.trim(), target: t, saved: parseAmount(saved || '0', cur) ?? 0 });
    onDone();
  };
  return (
    <div className="panel stack">
      <h2>{exists ? 'Edit goal' : 'New goal'}</h2>
      <div className="field"><label htmlFor="goal-name">Name</label><input id="goal-name" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="Emergency fund" /></div>
      <div className="grid2">
        <div className="field"><label htmlFor="goal-target">Target amount</label><input id="goal-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
        <div className="field"><label htmlFor="goal-date">Target date (optional)</label><input id="goal-date" type="date" value={g.targetDate ?? ''} onChange={(e) => setG({ ...g, targetDate: e.target.value || null })} /></div>
      </div>
      <div className="field">
        <label htmlFor="goal-account">Track progress with</label>
        <select id="goal-account" value={g.accountId ?? ''} onChange={(e) => setG({ ...g, accountId: e.target.value || null })}>
          <option value="">An amount I update by hand</option>
          {s.list('accounts').filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>Balance of {a.name}</option>)}
        </select>
      </div>
      {!g.accountId && <div className="field"><label htmlFor="goal-saved">Saved so far</label><input id="goal-saved" inputMode="decimal" value={saved} onChange={(e) => setSaved(e.target.value)} /></div>}
      {error && <p className="error">{error}</p>}
      <div className="row">
        {exists && <button className="btn ghost danger" onClick={async () => { await s.delete('goals', g.id); onDone(); }}>Delete</button>}
        <span className="grow" />
        <button className="btn" onClick={onDone}>Cancel</button>
        <button className="btn primary" onClick={save}>Save goal</button>
      </div>
    </div>
  );
}

function DebtPlanner({ nav }: { nav: Nav }) {
  const s = useSession();
  const today = todayIso();
  const cur = getSettings(s).baseCurrency;
  const fmt = (v: number) => formatMoney(v, cur);
  const [extra, setExtra] = useState('100');
  const accounts = s.list('accounts').filter((a) => !a.archived && DEBT_KINDS.includes(a.kind));
  const owed: Debt[] = accounts
    .map((a) => ({ id: a.id, name: a.name, balance: -balanceOn(a, today, s.list('transactions'), s.list('valuations')), apr: a.apr ?? 0, minPayment: a.minPayment ?? 0 }))
    .filter((d) => d.balance > 0);
  // A debt without a minimum payment can't be planned; leave it out and say so.
  const debts = owed.filter((d) => d.minPayment > 0);
  const missing = owed.filter((d) => !d.minPayment || !d.apr);
  if (owed.length === 0) {
    return (
      <div className="empty">
        <h2>No debts to plan</h2>
        <p className="muted">Credit cards, loans and other liabilities with a balance owed appear here. Add their interest rate and minimum payment in Wealth → Accounts.</p>
        <button className="btn" onClick={() => nav.go('wealth')}>Go to accounts</button>
      </div>
    );
  }
  if (debts.length === 0) return <p className="notice warn">Add a minimum monthly payment to at least one debt in Wealth → Accounts to see a payoff plan.</p>;
  const extraAmt = parseAmount(extra || '0', cur) ?? 0;
  const results = (['avalanche', 'snowball'] as Strategy[]).map((st) => ({ st, r: simulatePayoff(debts, extraAmt, st) }));
  const best = results[0].r.totalInterest <= results[1].r.totalInterest ? 'avalanche' : 'snowball';
  const monthName = (n: number) => monthLabel(addMonths(monthOf(today), n), 'long');
  return (
    <>
      {missing.length > 0 && (
        <p className="notice warn">
          Add the interest rate and minimum payment for {missing.map((a) => a.name).join(', ')} in Wealth → Accounts.
          {missing.some((d) => !d.minPayment) && ' Debts without a minimum payment are left out of the plan below.'}
        </p>
      )}
      <div className="panel stack">
        <h2>Your debts</h2>
        <ul className="plain">
          {owed.map((d) => (
            <li key={d.id} className="row">
              <span className="grow">{d.name} <span className="meta">· {d.apr}% APR · min {fmt(d.minPayment)}</span></span>
              <span className="amount neg">{fmt(d.balance)}</span>
            </li>
          ))}
        </ul>
        <div className="field">
          <label htmlFor="debt-extra">Extra to pay each month, on top of minimums</label>
          <input id="debt-extra" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} />
        </div>
      </div>
      <div className="compare">
        {results.map(({ st, r }) => (
          <div key={st} className={'panel stack ' + (st === best ? 'best' : '')}>
            <div className="row">
              <h3 className="grow">{st === 'avalanche' ? 'Avalanche' : 'Snowball'}</h3>
              {st === best && r.feasible && results.every((x) => x.r.feasible) && <span className="pill good">Saves most</span>}
            </div>
            <p className="muted small">{st === 'avalanche' ? 'Pay off the highest interest rate first. Costs the least.' : 'Pay off the smallest balance first. Quick wins keep you motivated.'}</p>
            {r.feasible ? (
              <>
                <p><strong>Debt-free in {r.months} months</strong> ({monthName(r.months)})</p>
                <p>Interest paid: <strong>{fmt(r.totalInterest)}</strong></p>
                <ol className="small">
                  {r.order.map((o) => <li key={o.id}>{o.name}: paid off {monthName(o.month)}</li>)}
                </ol>
              </>
            ) : (
              <p className="error">These payments don’t cover the interest. Increase the extra amount.</p>
            )}
          </div>
        ))}
      </div>
      {results[0].r.feasible && (
        <div className="panel stack">
          <h2>Total owed over time ({best})</h2>
          <LineChart
            ariaLabel="Total debt over time"
            format={fmt}
            compact={(v) => compactMoney(v, cur)}
            points={[debts.reduce((n, d) => n + d.balance, 0), ...results.find((x) => x.st === best)!.r.timeline].map((y, i) => ({ x: i, y, label: monthLabel(addMonths(monthOf(today), i)) + ' ' + addMonths(monthOf(today), i).slice(2, 4) }))}
          />
        </div>
      )}
    </>
  );
}
