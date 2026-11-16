import { useState } from 'react';
import type { Nav } from './App';
import { useSession, todayIso, readPref, compactMoney } from './session';
import { getSettings } from '../domain/settings';
import { monthlyRecap, summarizeMonth } from '../domain/recap';
import { detectRecurring, expectedAmount, upcoming } from '../domain/recurring';
import { addDays, addMonths, monthLabel, monthOf } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { BarList, PairedColumns } from './charts';
import { addExampleData } from './sample';

export function HomeView({ nav }: { nav: Nav }) {
  const s = useSession();
  const today = todayIso();
  const settings = getSettings(s);
  const cur = settings.baseCurrency;
  const txns = s.list('transactions');
  const categories = s.list('categories');
  const latestMonth = txns.length ? monthOf(txns.map((t) => t.date).sort().pop()!) : monthOf(today);
  const [month, setMonth] = useState(latestMonth > monthOf(today) ? monthOf(today) : latestMonth);
  const fmt = (v: number) => formatMoney(v, cur);

  if (s.list('accounts').length === 0) {
    return (
      <section className="empty">
        <h1>Welcome to MishMash</h1>
        <p>Import a CSV, OFX or QIF file from your bank to get started. Everything stays on this device.</p>
        <div className="row center">
          <button className="btn primary" onClick={() => nav.go('transactions', 'import')}>Import a bank file</button>
          <button className="btn" onClick={() => nav.go('wealth')}>Add an account by hand</button>
          <button className="btn" onClick={() => addExampleData(s)}>Try it with example data</button>
        </div>
      </section>
    );
  }

  const recurring = detectRecurring(txns, today, categories);
  const recap = monthlyRecap(month, txns, categories, recurring);
  const catName = (id: string | null) => (id ? (s.get('categories', id)?.name ?? 'Unknown') : 'Uncategorized');
  const inbox = txns.filter((t) => t.reviewed === false).length;
  const bills = upcoming(recurring.filter((r) => !r.isIncome && !r.isTransfer), today, addDays(today, 7));
  const priceRises = recurring.filter((r) => r.priceChange && r.priceChange.date >= addDays(today, -45));
  const lastBackup = readPref<string | null>('lastBackup', null);
  const backupDue = txns.length > 0 && (!lastBackup || Date.now() - Date.parse(lastBackup) > 30 * 86_400_000);

  const trend = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5)).map((m) => {
    const sm = summarizeMonth(m, txns, categories);
    return { label: monthLabel(m), a: sm.income, b: sm.spending };
  });
  const change = (now: number, before: number) => {
    if (!before) return null;
    const pct = ((now - before) / before) * 100;
    return `${pct > 0 ? '+' : ''}${pct.toFixed(0)}% vs ${monthLabel(addMonths(month, -1))}`;
  };

  return (
    <section className="stack">
      {(inbox > 0 || backupDue || priceRises.length > 0) && (
        <div className="stack">
          {inbox > 0 && (
            <button className="notice ok action" onClick={() => nav.go('transactions', 'inbox')}>
              <strong>{inbox} transaction{inbox === 1 ? '' : 's'} to review</strong>
              <span>Check the categories of your latest import.</span>
            </button>
          )}
          {priceRises.map((r) => (
            <button key={r.key} className="notice warn action" onClick={() => nav.go('plan', 'bills')}>
              <strong>{r.payee} went up</strong>
              <span>From {fmt(-r.priceChange!.from)} to {fmt(-r.priceChange!.to)} on {r.priceChange!.date}.</span>
            </button>
          ))}
          {backupDue && (
            <button className="notice warn action" onClick={() => nav.go('settings')}>
              <strong>{lastBackup ? 'Time for a new backup' : 'You haven’t made a backup yet'}</strong>
              <span>Your data only exists in this browser. Download an encrypted backup.</span>
            </button>
          )}
        </div>
      )}

      <div className="row">
        <button className="btn ghost" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">‹</button>
        <h1 className="grow center-text">{monthLabel(month, 'long')}</h1>
        <button className="btn ghost" onClick={() => setMonth(addMonths(month, 1))} disabled={month >= monthOf(today)} aria-label="Next month">›</button>
      </div>

      <div className="summary">
        <div>
          <span className="label">Income</span>
          <span className="figure">{fmt(recap.current.income)}</span>
          <span className="meta">{change(recap.current.income, recap.previous.income)}</span>
        </div>
        <div>
          <span className="label">Spending</span>
          <span className="figure">{fmt(recap.current.spending)}</span>
          <span className="meta">{change(recap.current.spending, recap.previous.spending)}</span>
        </div>
        <div>
          <span className="label">Saved</span>
          <span className={'figure ' + (recap.current.net < 0 ? 'neg' : 'pos')}>{fmt(recap.current.net)}</span>
          <span className="meta">{recap.savingsRate !== null ? `${Math.round(recap.savingsRate * 100)}% of income` : ' '}</span>
        </div>
      </div>

      {recap.current.count > 0 && (
        <div className="panel stack">
          <h2>Month in review</h2>
          <ul className="facts">
            <li>{recap.current.count} transactions.</li>
            {recap.topCategories[0] && <li>Most spent on <strong>{catName(recap.topCategories[0].categoryId)}</strong>: {fmt(recap.topCategories[0].amount)}.</li>}
            {recap.biggestIncrease && <li>Biggest increase: <strong>{catName(recap.biggestIncrease.categoryId)}</strong>, up {fmt(recap.biggestIncrease.change)} on last month.</li>}
            {recap.topPayees[0] && <li>Top payee: <strong>{recap.topPayees[0].payee}</strong> ({fmt(recap.topPayees[0].amount)}).</li>}
            {recap.current.largest && <li>Largest purchase: {recap.current.largest.payee}, {fmt(-recap.current.largest.amount)} on {recap.current.largest.date}.</li>}
            {recap.newRecurring.map((r) => <li key={r.key}>New regular payment: <strong>{r.payee}</strong>, {fmt(-r.typicalAmount)} {r.cadence}.</li>)}
          </ul>
        </div>
      )}

      <div className="panel stack">
        <h2>Spending by category</h2>
        {recap.topCategories.length === 0 ? (
          <p className="muted">No spending recorded in {monthLabel(month, 'long')}.</p>
        ) : (
          <BarList
            format={fmt}
            rows={recap.topCategories.slice(0, 8).map((c) => ({
              label: catName(c.categoryId),
              value: c.amount,
              sub: c.change !== 0 && recap.previous.spending > 0 ? `${c.change > 0 ? 'up' : 'down'} ${fmt(Math.abs(c.change))} on last month` : undefined,
            }))}
          />
        )}
        <button className="btn link" onClick={() => nav.go('budget')}>See the budget</button>
      </div>

      <div className="panel stack">
        <h2>Income and spending, last 6 months</h2>
        <PairedColumns data={trend} labels={['Income', 'Spending']} format={fmt} compact={(v) => compactMoney(v, cur)} />
      </div>

      <div className="panel stack">
        <h2>Due in the next 7 days</h2>
        {bills.length === 0 ? (
          <p className="muted">Nothing regular is due. Bills appear here once MishMash has seen them a few times.</p>
        ) : (
          <ul className="plain">
            {bills.map((b) => (
              <li key={b.item.key + b.date} className="row">
                <span className="grow">{b.item.payee} <span className="meta">· {b.date}</span></span>
                <span className="amount">{fmt(expectedAmount(b.item))}</span>
              </li>
            ))}
          </ul>
        )}
        <button className="btn link" onClick={() => nav.go('plan', 'bills')}>All bills and subscriptions</button>
      </div>
    </section>
  );
}
