import { useState, type FormEvent } from 'react';
import type { Nav } from './App';
import { useSession, todayIso, toInput, compactMoney } from './session';
import { getSettings, updateSettings } from '../domain/settings';
import { balanceOn, netWorthHistory, netWorthOn, toBase } from '../domain/wealth';
import { projectRetirement } from '../domain/retirement';
import { formatMoney, parseAmount } from '../domain/money';
import { monthLabel } from '../domain/dates';
import { DEBT_KINDS, VALUED_KINDS, newId, type Account, type AccountKind, type RetirementInputs } from '../domain/types';
import { LineChart } from './charts';

const KINDS: [AccountKind, string][] = [
  ['checking', 'Checking / current'],
  ['savings', 'Savings'],
  ['credit', 'Credit card'],
  ['cash', 'Cash'],
  ['investment', 'Investments / CPF / SRS'],
  ['loan', 'Loan / mortgage'],
  ['property', 'Property'],
  ['vehicle', 'Vehicle'],
  ['asset', 'Other asset (crypto, collectibles…)'],
  ['liability', 'Other debt'],
  ['other', 'Other'],
];
export const CURRENCIES = ['SGD', 'USD', 'MYR', 'EUR', 'GBP', 'AUD', 'JPY', 'HKD', 'CNY', 'IDR', 'THB', 'INR', 'NZD', 'CAD', 'CHF', 'KRW', 'TWD', 'PHP', 'VND'];

const SECTIONS: [string, string][] = [
  ['accounts', 'Accounts'],
  ['networth', 'Net worth'],
  ['retirement', 'Retirement'],
];

export function WealthView({ nav }: { nav: Nav }) {
  const sub = SECTIONS.some(([k]) => k === nav.sub) ? nav.sub! : 'accounts';
  return (
    <section className="stack">
      <h1>Wealth</h1>
      <div className="segmented three" role="tablist" aria-label="Wealth sections">
        {SECTIONS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => nav.go('wealth', k)}>{l}</button>
        ))}
      </div>
      {sub === 'accounts' && <Accounts />}
      {sub === 'networth' && <NetWorth />}
      {sub === 'retirement' && <Retirement />}
    </section>
  );
}

function Accounts() {
  const s = useSession();
  const today = todayIso();
  const settings = getSettings(s);
  const txns = s.list('transactions');
  const vals = s.list('valuations');
  const accounts = s.list('accounts').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const [editing, setEditing] = useState<Account | 'new' | null>(accounts.length === 0 ? 'new' : null);
  const nw = netWorthOn(accounts, today, txns, vals, settings);
  const fmt = (v: number, c = settings.baseCurrency) => formatMoney(v, c);

  return (
    <>
      {accounts.length > 0 && (
        <div className="summary">
          <div><span className="label">Net worth</span><span className={'figure ' + (nw.net < 0 ? 'neg' : '')}>{fmt(nw.net)}</span></div>
          <div><span className="label">Assets</span><span className="figure">{fmt(nw.assets)}</span></div>
          <div><span className="label">Debts</span><span className="figure">{fmt(-nw.liabilities)}</span></div>
        </div>
      )}
      {nw.missingRates.length > 0 && <p className="notice warn">Add exchange rates for {nw.missingRates.join(', ')} in Settings to include those accounts in totals.</p>}
      {editing ? <AccountForm initial={editing === 'new' ? null : editing} onDone={() => setEditing(null)} /> : <button className="btn primary" onClick={() => setEditing('new')}>Add account or asset</button>}
      {KINDS.map(([kind, label]) => {
        const list = accounts.filter((a) => a.kind === kind);
        if (list.length === 0) return null;
        return (
          <div key={kind} className="stack">
            <h3 className="label">{label}</h3>
            <ul className="cards">
              {list.map((a) => {
                const bal = balanceOn(a, today, txns, vals);
                const count = txns.filter((t) => t.accountId === a.id).length;
                const base = a.currency !== settings.baseCurrency ? toBase(bal, a.currency, settings) : null;
                return (
                  <li key={a.id}>
                    <button className={'account ' + (a.archived ? 'archived' : '')} onClick={() => setEditing(a)}>
                      <span>
                        <span className="payee">{a.name}</span>
                        <span className="meta">
                          {VALUED_KINDS.includes(a.kind) ? `${vals.filter((v) => v.accountId === a.id).length} valuations` : `${count} transactions`}
                          {a.apr ? ` · ${a.apr}% APR` : ''}
                          {a.archived ? ' · archived' : ''}
                          {base !== null ? ` · ≈ ${fmt(base)}` : ''}
                        </span>
                      </span>
                      <span className={'amount ' + (bal < 0 ? 'neg' : '')}>{fmt(bal, a.currency)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function AccountForm({ initial, onDone }: { initial: Account | null; onDone: () => void }) {
  const s = useSession();
  const settings = getSettings(s);
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<AccountKind>(initial?.kind ?? 'checking');
  const [currency, setCurrency] = useState(initial?.currency ?? settings.baseCurrency);
  const [opening, setOpening] = useState(initial ? toInput(initial.openingBalance, initial.currency) : '0');
  const [apr, setApr] = useState(initial?.apr ? String(initial.apr) : '');
  const [minPay, setMinPay] = useState(initial?.minPayment ? toInput(initial.minPayment, initial.currency) : '');
  const [valDate, setValDate] = useState(todayIso());
  const [valAmount, setValAmount] = useState('');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const valued = VALUED_KINDS.includes(kind);
  const isDebt = DEBT_KINDS.includes(kind);
  const valuations = initial ? s.list('valuations').filter((v) => v.accountId === initial.id).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const txCount = initial ? s.list('transactions').filter((t) => t.accountId === initial.id).length : 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Give the account a name, for example “Everyday checking”.');
    const minor = parseAmount(opening || '0', currency);
    if (minor === null) return setError('The starting balance must be a number, for example 1250.00 or -300.');
    const id = initial?.id ?? newId();
    await s.put('accounts', {
      id,
      name: name.trim(),
      kind,
      currency,
      openingBalance: minor,
      archived: initial?.archived ?? false,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
      apr: isDebt && apr ? Number(apr) : undefined,
      minPayment: isDebt && minPay ? (parseAmount(minPay, currency) ?? undefined) : undefined,
    });
    if (valued && valAmount) {
      const v = parseAmount(valAmount, currency);
      if (v !== null) await s.put('valuations', { id: newId(), accountId: id, date: valDate, value: kind === 'liability' ? -Math.abs(v) : v });
    }
    onDone();
  };

  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>{initial ? 'Edit account' : 'New account or asset'}</h2>
      <div className="field">
        <label htmlFor="acc-name">Name</label>
        <input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Everyday checking" autoFocus={!initial} />
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="acc-kind">Type</label>
          <select id="acc-kind" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
            {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="acc-currency">Currency</label>
          <select id="acc-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      {!valued && (
        <div className="field">
          <label htmlFor="acc-opening">Starting balance</label>
          <input id="acc-opening" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
          <span className="hint">The balance before the first transaction you’ll import. Use a minus sign for money owed (credit cards, loans).</span>
        </div>
      )}
      {isDebt && (
        <div className="grid2">
          <div className="field">
            <label htmlFor="acc-apr">Interest rate (APR %)</label>
            <input id="acc-apr" inputMode="decimal" value={apr} onChange={(e) => setApr(e.target.value)} placeholder="19.99" />
          </div>
          <div className="field">
            <label htmlFor="acc-min">Minimum monthly payment</label>
            <input id="acc-min" inputMode="decimal" value={minPay} onChange={(e) => setMinPay(e.target.value)} />
          </div>
        </div>
      )}
      {valued && (
        <div className="stack">
          <h3>{initial ? 'Add a new value' : 'Current value'}</h3>
          <p className="muted small">Enter what it’s worth today. Update it whenever you check, for example from a statement or valuation site.</p>
          <div className="grid2">
            <div className="field"><label htmlFor="val-amount">Value</label><input id="val-amount" inputMode="decimal" value={valAmount} onChange={(e) => setValAmount(e.target.value)} /></div>
            <div className="field"><label htmlFor="val-date">As of</label><input id="val-date" type="date" value={valDate} onChange={(e) => setValDate(e.target.value)} /></div>
          </div>
          {valuations.length > 0 && (
            <ul className="plain small">
              {valuations.slice(0, 12).map((v) => (
                <li key={v.id} className="row">
                  <span className="grow">{v.date}</span>
                  <span className="amount">{formatMoney(v.value, currency)}</span>
                  <button type="button" className="btn ghost small" aria-label={`Delete value from ${v.date}`} onClick={() => s.delete('valuations', v.id)}>×</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        {initial && (
          <button type="button" className="btn ghost" onClick={async () => { await s.put('accounts', { ...initial, archived: !initial.archived }); onDone(); }}>
            {initial.archived ? 'Unarchive' : 'Archive'}
          </button>
        )}
        {initial &&
          (confirmDelete ? (
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                await s.deleteMany('transactions', s.list('transactions').filter((t) => t.accountId === initial.id).map((t) => t.id));
                await s.deleteMany('valuations', valuations.map((v) => v.id));
                await s.delete('accounts', initial.id);
                onDone();
              }}
            >
              Delete with {txCount} transactions
            </button>
          ) : (
            <button type="button" className="btn ghost danger" onClick={() => setConfirmDelete(true)}>Delete</button>
          ))}
        <span className="grow" />
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button className="btn primary">Save</button>
      </div>
    </form>
  );
}

function NetWorth() {
  const s = useSession();
  const today = todayIso();
  const settings = getSettings(s);
  const cur = settings.baseCurrency;
  const fmt = (v: number) => formatMoney(v, cur);
  const [months, setMonths] = useState(24);
  const history = netWorthHistory(s.list('accounts'), s.list('transactions'), s.list('valuations'), settings, today, months);
  const first = history[0];
  const last = history[history.length - 1];
  const change = last && first ? last.net - first.net : 0;
  return (
    <>
      <div className="summary">
        <div><span className="label">Net worth today</span><span className={'figure ' + ((last?.net ?? 0) < 0 ? 'neg' : '')}>{fmt(last?.net ?? 0)}</span></div>
        <div><span className="label">Change since {first ? monthLabel(first.month, 'long') : '—'}</span><span className={'figure ' + (change < 0 ? 'neg' : 'pos')}>{change >= 0 ? '+' : ''}{fmt(change)}</span></div>
      </div>
      <div className="panel stack">
        <div className="row">
          <h2 className="grow">Net worth over time</h2>
          <select id="nw-range" value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Time range">
            <option value={12}>1 year</option>
            <option value={24}>2 years</option>
            <option value={60}>5 years</option>
          </select>
        </div>
        <LineChart
          ariaLabel="Net worth by month"
          format={fmt}
          compact={(v) => compactMoney(v, cur)}
          points={history.map((h, i) => ({ x: i, y: h.net, label: monthLabel(h.month) + ' ' + h.month.slice(2, 4) }))}
        />
        <p className="muted small">Calculated from your transactions and the values you’ve entered for assets. Month-end figures, in {cur}.</p>
      </div>
    </>
  );
}

function Retirement() {
  const s = useSession();
  const today = todayIso();
  const settings = getSettings(s);
  const cur = settings.baseCurrency;
  const fmt = (v: number) => formatMoney(v, cur);
  const inp = settings.retirement;
  const investments = s.list('accounts').filter((a) => !a.archived && a.kind === 'investment');
  const invested = investments.reduce((n, a) => n + (toBase(balanceOn(a, today, s.list('transactions'), s.list('valuations')), a.currency, settings) ?? 0), 0);
  const start = inp.startingBalance ?? invested;
  const p = projectRetirement(inp, start, 1000);
  const set = (patch: Partial<RetirementInputs>) => updateSettings(s, { retirement: { ...inp, ...patch } });
  const pct = Math.round(p.successRate * 100);

  const num = (id: string, label: string, value: number, onChange: (v: number) => void, suffix?: string) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <NumberField id={id} value={value} onChange={onChange} suffix={suffix} />
    </div>
  );
  const money = (id: string, label: string, value: number, onChange: (v: number) => void) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <NumberField id={id} value={value / 100} onChange={(v) => onChange(Math.round(v * 100))} />
    </div>
  );

  return (
    <>
      <div className="summary">
        <div>
          <span className="label">Chance your money lasts to {inp.endAge}</span>
          <span className={'figure ' + (pct >= 85 ? 'pos' : pct < 60 ? 'neg' : '')}>{pct}%</span>
          <span className="meta">{pct >= 85 ? 'On track' : pct >= 60 ? 'Could be tight' : 'At risk'}</span>
        </div>
        <div><span className="label">Likely pot at {inp.retireAge}</span><span className="figure">{compactMoney(p.medianAtRetirement, cur)}</span><span className="meta">in today’s money</span></div>
        <div><span className="label">Financial independence number</span><span className="figure">{compactMoney(p.fiNumber, cur)}</span><span className="meta">25× yearly spending</span></div>
      </div>
      <div className="panel stack">
        <h2>Projected savings by age</h2>
        <LineChart
          ariaLabel="Projected retirement savings with a range from unlucky to lucky markets"
          format={fmt}
          compact={(v) => compactMoney(v, cur)}
          points={p.ages.map((age, i) => ({ x: age, y: p.p50[i], lo: p.p10[i], hi: p.p90[i], label: `Age ${age}` }))}
        />
        <p className="muted small">
          The line is the middle outcome of 1,000 simulated markets; the shaded range covers 80% of them (10th–90th percentile). All figures are in today’s money, after {inp.inflation}% inflation.
          {p.depletionAgeMedian && ` In the middle outcome, money runs out at about ${p.depletionAgeMedian}.`}
        </p>
      </div>
      <div className="panel stack">
        <h2>Your assumptions</h2>
        <div className="grid3">
          {num('ret-age', 'Current age', inp.currentAge, (v) => set({ currentAge: v }))}
          {num('ret-retire', 'Retire at', inp.retireAge, (v) => set({ retireAge: v }))}
          {num('ret-end', 'Plan until age', inp.endAge, (v) => set({ endAge: v }))}
        </div>
        <div className="grid2">
          {money('ret-contrib', 'Saving per month', inp.monthlyContribution, (v) => set({ monthlyContribution: v }))}
          {money('ret-spend', 'Yearly spending in retirement', inp.annualSpending, (v) => set({ annualSpending: v }))}
        </div>
        <div className="grid3">
          {num('ret-return', 'Expected return', inp.expectedReturn, (v) => set({ expectedReturn: v }), '%')}
          {num('ret-vol', 'Yearly ups and downs', inp.volatility, (v) => set({ volatility: v }), '%')}
          {num('ret-infl', 'Inflation', inp.inflation, (v) => set({ inflation: v }), '%')}
        </div>
        <div className="field">
          <label htmlFor="ret-start">Invested today</label>
          <NumberField id="ret-start" value={start / 100} onChange={(v) => set({ startingBalance: Math.round(v * 100) })} />
          <span className="hint">
            {inp.startingBalance === null ? `From your investment accounts (${fmt(invested)}).` : <>Entered by hand. <button className="btn link small" onClick={() => set({ startingBalance: null })}>Use investment accounts ({fmt(invested)})</button></>}
          </span>
        </div>
        <p className="muted small">This is an estimate to help you plan, not financial advice. Real returns vary and past performance doesn’t predict the future.</p>
      </div>
    </>
  );
}

function NumberField({ id, value, onChange, suffix }: { id: string; value: number; onChange: (v: number) => void; suffix?: string }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const v = Number(text.replace(/[^\d.-]/g, ''));
    if (Number.isFinite(v)) onChange(v);
    setText(null);
  };
  return (
    <span className="suffixed">
      <input id={id} inputMode="decimal" value={text ?? String(Math.round(value * 100) / 100)} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      {suffix && <span>{suffix}</span>}
    </span>
  );
}
