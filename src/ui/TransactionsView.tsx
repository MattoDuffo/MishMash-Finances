import { useEffect, useState, type FormEvent } from 'react';
import type { Nav } from './App';
import { useSession, todayIso, toInput } from './session';
import { formatMoney, parseAmount } from '../domain/money';
import { newId, type Split, type Transaction } from '../domain/types';
import { findTransferPairs } from '../domain/transfers';
import { Categorizer } from '../domain/categorize';
import { toCsvRow } from '../import/csv';
import { ImportView } from './ImportView';
import { RulesView, ruleFromTransaction } from './RulesView';
import { CategorySelect } from './CategorySelect';
import { downloadText } from './download';

export function TransactionsView({ nav, sharedFile, clearShared }: { nav: Nav; sharedFile: File | null; clearShared: () => void }) {
  const s = useSession();
  const [editing, setEditing] = useState<Transaction | 'new' | null>(nav.sub === 'new' ? 'new' : null);
  const [query, setQuery] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [limit, setLimit] = useState(150);

  useEffect(() => {
    if (nav.sub === 'new') setEditing('new');
  }, [nav.sub]);

  if (nav.sub === 'import')
    return <ImportView initialFile={sharedFile} onClose={() => { clearShared(); nav.go('transactions'); }} onReview={() => nav.go('transactions', 'inbox')} />;
  if (nav.sub === 'inbox') return <Inbox onClose={() => nav.go('transactions')} />;
  if (nav.sub === 'rules') return <RulesView onClose={() => nav.go('transactions')} />;

  const accounts = s.list('accounts');
  const all = s.list('transactions');
  const inboxCount = all.filter((t) => t.reviewed === false).length;
  const q = query.trim().toLowerCase();
  const txns = all
    .filter((t) => !q || t.payee.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q) || (t.originalPayee ?? '').toLowerCase().includes(q) || toInput(Math.abs(t.amount)).startsWith(q))
    .filter((t) => !accountFilter || t.accountId === accountFilter)
    .filter((t) => !categoryFilter || (categoryFilter === '__none' ? !t.categoryId && !t.splits?.length : t.categoryId === categoryFilter || t.splits?.some((x) => x.categoryId === categoryFilter)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  const pairs = findTransferPairs(all, accounts);
  const byDate = new Map<string, Transaction[]>();
  for (const t of txns.slice(0, limit)) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
  const catName = (t: Transaction) =>
    t.transferId ? 'Transfer' : t.splits?.length ? `Split (${t.splits.length})` : t.categoryId ? (s.get('categories', t.categoryId)?.name ?? '?') : 'Uncategorized';
  const cur = (id: string) => s.get('accounts', id)?.currency ?? 'USD';

  const exportCsv = () => {
    const lines = [toCsvRow(['Date', 'Account', 'Payee', 'Category', 'Amount', 'Currency', 'Notes', 'Original description'])];
    for (const t of txns) {
      const lines2 = t.splits?.length ? t.splits.map((x) => ({ cat: x.categoryId, amount: x.amount, note: x.note || t.notes })) : [{ cat: t.categoryId, amount: t.amount, note: t.notes }];
      for (const l of lines2)
        lines.push(toCsvRow([t.date, s.get('accounts', t.accountId)?.name ?? '', t.payee, l.cat ? (s.get('categories', l.cat)?.name ?? '') : t.transferId ? 'Transfer' : '', toInput(l.amount, cur(t.accountId)), cur(t.accountId), l.note, t.originalPayee ?? '']));
    }
    downloadText(`mishmash-transactions-${todayIso()}.csv`, lines.join('\n'), 'text/csv');
  };

  const linkPairs = async () => {
    const xferCat = s.list('categories').find((c) => c.group === 'transfer')?.id ?? null;
    const updates: Transaction[] = [];
    for (const p of pairs) {
      const id = newId();
      updates.push({ ...p.out, transferId: id, categoryId: xferCat, splits: undefined, reviewed: true }, { ...p.in, transferId: id, categoryId: xferCat, splits: undefined, reviewed: true });
    }
    await s.putMany('transactions', updates);
  };

  return (
    <section className="stack">
      <div className="row">
        <h1 className="grow">Transactions</h1>
        <button className="btn primary" onClick={() => nav.go('transactions', 'import')}>Import</button>
        <button className="btn" onClick={() => setEditing('new')}>Add</button>
      </div>

      {inboxCount > 0 && (
        <button className="notice ok action" onClick={() => nav.go('transactions', 'inbox')}>
          <strong>Review inbox: {inboxCount} to check</strong>
          <span>Confirm categories for newly imported transactions.</span>
        </button>
      )}
      {pairs.length > 0 && (
        <div className="notice warn">
          <span>
            <strong>{pairs.length} possible transfer{pairs.length === 1 ? '' : 's'} between your accounts</strong>, for example {pairs[0].out.payee} → {s.get('accounts', pairs[0].in.accountId)?.name}. Linking them keeps them out of spending totals.
          </span>
          <div className="row">
            <button className="btn" onClick={linkPairs}>Link as transfers</button>
          </div>
        </div>
      )}

      {editing && <TransactionForm initial={editing === 'new' ? null : editing} onDone={() => { setEditing(null); if (nav.sub === 'new') nav.go('transactions'); }} />}

      <div className="filters">
        <input id="txn-search" type="search" placeholder="Search payee, notes or amount" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search transactions" />
        <select id="txn-filter-account" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} aria-label="Account">
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select id="txn-filter-category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          <option value="__none">Uncategorized</option>
          {s.list('categories').sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="row small">
        <span className="muted grow">{txns.length} transactions</span>
        <button className="btn link" onClick={() => nav.go('transactions', 'rules')}>Rules</button>
        <button className="btn link" onClick={exportCsv} disabled={txns.length === 0}>Export CSV</button>
      </div>

      {txns.length === 0 ? (
        <p className="muted">{all.length ? 'No transactions match these filters.' : 'No transactions yet. Import a file from your bank to get started.'}</p>
      ) : (
        <div className="ledger">
          {[...byDate.entries()].map(([date, items]) => (
            <div key={date} className="day">
              <h3 className="day-head">{formatDate(date)}</h3>
              {items.map((t) => (
                <button key={t.id} className="txn" onClick={() => setEditing(t)}>
                  <span className="txn-main">
                    <span className="payee">{t.payee || 'No payee'}{t.reviewed === false && <span className="dot-new" title="Not reviewed yet" />}</span>
                    <span className="meta">
                      <span className="chip">{catName(t)}</span> {s.get('accounts', t.accountId)?.name ?? '—'}
                    </span>
                  </span>
                  <span className={'amount ' + (t.amount > 0 ? 'pos' : '')}>{formatMoney(t.amount, cur(t.accountId))}</span>
                </button>
              ))}
            </div>
          ))}
          {txns.length > limit && <button className="btn" onClick={() => setLimit(limit + 300)}>Show more</button>}
        </div>
      )}
    </section>
  );
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function Inbox({ onClose }: { onClose: () => void }) {
  const s = useSession();
  const all = s.list('transactions');
  const items = all.filter((t) => t.reviewed === false).sort((a, b) => b.date.localeCompare(a.date));
  const [made, setMade] = useState<string | null>(null);
  const categorizer = new Categorizer(all);

  const accept = (t: Transaction, categoryId: string | null) => s.put('transactions', { ...t, categoryId, reviewed: true });
  const acceptAll = () => s.putMany('transactions', items.filter((t) => t.categoryId).map((t) => ({ ...t, reviewed: true })));

  return (
    <section className="stack">
      <div className="row">
        <h1 className="grow">Review inbox</h1>
        <button className="btn ghost" onClick={onClose}>Done</button>
      </div>
      {items.length === 0 ? (
        <div className="empty"><h2>All caught up</h2><p className="muted">Every transaction has been reviewed.</p></div>
      ) : (
        <>
          <div className="row">
            <p className="muted grow">{items.length} to review. Each one you confirm teaches MishMash for next time.</p>
            {items.some((t) => t.categoryId) && <button className="btn" onClick={acceptAll}>Accept all with a category</button>}
          </div>
          {made && <p className="notice ok">{made}</p>}
          <ul className="cards">
            {items.slice(0, 100).map((t) => {
              const sug = t.categoryId ? null : categorizer.suggest(t.payee, t.amount);
              return (
                <li key={t.id} className="panel inbox-item">
                  <div className="row">
                    <span className="grow">
                      <span className="payee">{t.payee}</span>
                      <span className="meta">{t.date} · {s.get('accounts', t.accountId)?.name}{t.originalPayee && t.originalPayee !== t.payee ? ` · ${t.originalPayee}` : ''}</span>
                    </span>
                    <span className={'amount ' + (t.amount > 0 ? 'pos' : '')}>{formatMoney(t.amount, s.get('accounts', t.accountId)?.currency)}</span>
                  </div>
                  <div className="row">
                    <div className="grow">
                      <CategorySelect id={`inbox-cat-${t.id}`} label={`Category for ${t.payee}`} value={t.categoryId ?? sug?.categoryId ?? null} onChange={(v) => s.put('transactions', { ...t, categoryId: v })} />
                    </div>
                    <button className="btn primary" onClick={() => accept(t, t.categoryId ?? sug?.categoryId ?? null)}>OK</button>
                  </div>
                  <button
                    className="btn link small"
                    disabled={!(t.categoryId ?? sug?.categoryId)}
                    onClick={async () => {
                      const rule = ruleFromTransaction(t, t.categoryId ?? sug?.categoryId ?? null, s.list('rules').length);
                      await s.put('rules', rule);
                      // Apply the new rule to everything else waiting in the inbox.
                      const matches = items.filter((x) => x.id !== t.id && x.payee.toLowerCase().includes(rule.conditions[0].value));
                      await s.putMany('transactions', [{ ...t, categoryId: rule.setCategoryId ?? null, reviewed: true }, ...matches.map((x) => ({ ...x, categoryId: rule.setCategoryId ?? null, reviewed: true }))]);
                      setMade(`Rule created: “${rule.name}”. ${matches.length ? `Also applied to ${matches.length} more.` : ''}`);
                    }}
                  >
                    Always use this category for “{t.payee}”
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function TransactionForm({ initial, onDone }: { initial: Transaction | null; onDone: () => void }) {
  const s = useSession();
  const accounts = s.list('accounts').filter((a) => !a.archived || a.id === initial?.accountId);
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? '');
  const currency = s.get('accounts', accountId)?.currency ?? 'USD';
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const [payee, setPayee] = useState(initial?.payee ?? '');
  const [direction, setDirection] = useState<'out' | 'in'>(initial && initial.amount > 0 ? 'in' : 'out');
  const [amount, setAmount] = useState(initial ? toInput(Math.abs(initial.amount), currency) : '');
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [splits, setSplits] = useState<{ categoryId: string | null; amount: string; note: string }[]>(
    initial?.splits?.map((x) => ({ categoryId: x.categoryId, amount: toInput(Math.abs(x.amount), currency), note: x.note })) ?? [],
  );
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (accounts.length === 0) {
    return <p className="notice warn">Add an account first (Wealth → Accounts), or import a bank file.</p>;
  }

  const sign = direction === 'out' ? -1 : 1;
  const total = parseAmount(amount, currency);
  const splitSum = splits.reduce((n, x) => n + (parseAmount(x.amount, currency) ?? 0), 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (total === null || total === 0) return setError('Enter an amount, for example 12.50.');
    if (!date) return setError('Choose a date.');
    let finalSplits: Split[] | undefined;
    if (splits.length > 0) {
      if (splitSum !== Math.abs(total)) return setError(`The split amounts add up to ${formatMoney(splitSum, currency)}, but the transaction is ${formatMoney(Math.abs(total), currency)}.`);
      finalSplits = splits.map((x) => ({ categoryId: x.categoryId, amount: sign * (parseAmount(x.amount, currency) ?? 0), note: x.note.trim() }));
    }
    let transferId = initial?.transferId ?? null;
    // Changing the amount breaks a transfer link; unlink both halves.
    if (transferId && initial && sign * Math.abs(total) !== initial.amount) {
      const other = s.list('transactions').find((x) => x.transferId === transferId && x.id !== initial.id);
      if (other) await s.put('transactions', { ...other, transferId: null });
      transferId = null;
    }
    await s.put('transactions', {
      ...(initial ?? {}),
      id: initial?.id ?? newId(),
      accountId,
      date,
      amount: sign * Math.abs(total),
      payee: payee.trim(),
      categoryId: finalSplits ? null : categoryId,
      notes: notes.trim(),
      source: initial?.source ?? 'manual',
      importId: initial?.importId ?? null,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
      reviewed: true,
      splits: finalSplits,
      transferId,
    });
    onDone();
  };

  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>{initial ? 'Edit transaction' : 'New transaction'}</h2>
      {initial?.originalPayee && initial.originalPayee !== initial.payee && <p className="muted small">Bank description: {initial.originalPayee}</p>}
      {initial?.transferId && <p className="notice ok">This is one half of a transfer between your accounts.</p>}
      <div className="segmented" role="radiogroup" aria-label="Direction">
        <button type="button" role="radio" aria-checked={direction === 'out'} className={direction === 'out' ? 'on' : ''} onClick={() => setDirection('out')}>Money out</button>
        <button type="button" role="radio" aria-checked={direction === 'in'} className={direction === 'in' ? 'on' : ''} onClick={() => setDirection('in')}>Money in</button>
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="txn-amount">Amount ({currency})</label>
          <input id="txn-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus={!initial} />
        </div>
        <div className="field">
          <label htmlFor="txn-date">Date</label>
          <input id="txn-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="txn-payee">Payee</label>
        <input id="txn-payee" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Who was it paid to or from?" />
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="txn-account">Account</label>
          <select id="txn-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        {splits.length === 0 && (
          <div className="field">
            <label htmlFor="txn-category">Category</label>
            <CategorySelect id="txn-category" value={categoryId} onChange={setCategoryId} />
          </div>
        )}
      </div>

      {splits.length > 0 && (
        <div className="stack splits">
          <h3>Split between categories</h3>
          {splits.map((x, i) => (
            <div key={i} className="split-row">
              <CategorySelect id={`split-cat-${i}`} label={`Split ${i + 1} category`} value={x.categoryId} onChange={(v) => setSplits(splits.map((y, j) => (j === i ? { ...y, categoryId: v } : y)))} />
              <input id={`split-amt-${i}`} aria-label={`Split ${i + 1} amount`} inputMode="decimal" value={x.amount} onChange={(e) => setSplits(splits.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} placeholder="0.00" />
              <button type="button" className="btn ghost" aria-label={`Remove split ${i + 1}`} onClick={() => setSplits(splits.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <p className={'small ' + (total !== null && splitSum !== Math.abs(total) ? 'error' : 'muted')}>
            {total !== null ? `${formatMoney(Math.abs(total) - splitSum, currency)} left to split` : ''}
          </p>
        </div>
      )}
      <button
        type="button"
        className="btn link small"
        onClick={() => {
          const rest = total !== null ? Math.abs(total) - splitSum : 0;
          setSplits(splits.length === 0 ? [{ categoryId, amount: amount.replace('-', ''), note: '' }, { categoryId: null, amount: '', note: '' }] : [...splits, { categoryId: null, amount: rest > 0 ? toInput(rest, currency) : '', note: '' }]);
        }}
      >
        {splits.length ? 'Add another split' : 'Split between categories'}
      </button>

      <div className="field">
        <label htmlFor="txn-notes">Notes</label>
        <input id="txn-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        {initial &&
          (confirmDelete ? (
            <button type="button" className="btn danger" onClick={async () => { await s.delete('transactions', initial.id); onDone(); }}>Confirm delete</button>
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
