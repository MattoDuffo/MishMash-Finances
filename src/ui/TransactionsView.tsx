import { useState, type FormEvent } from 'react';
import { useSession, todayIso } from './session';
import { formatMoney, parseAmount, currencyExponent } from '../domain/money';
import { GROUP_LABELS } from '../domain/defaults';
import { newId, type Transaction, type CategoryGroup } from '../domain/types';
import { addExampleData } from './sample';

export function TransactionsView({ onGoToAccounts }: { onGoToAccounts: () => void }) {
  const s = useSession();
  const accounts = s.list('accounts').filter((a) => !a.archived);
  const categories = s.list('categories');
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const txns = s
    .list('transactions')
    .filter((t) => !q || t.payee.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  const month = todayIso().slice(0, 7);
  const transferIds = new Set(categories.filter((c) => c.group === 'transfer').map((c) => c.id));
  const thisMonth = s.list('transactions').filter((t) => t.date.startsWith(month) && !transferIds.has(t.categoryId ?? ''));
  const moneyIn = thisMonth.filter((t) => t.amount > 0).reduce((n, t) => n + t.amount, 0);
  const moneyOut = thisMonth.filter((t) => t.amount < 0).reduce((n, t) => n + t.amount, 0);
  const currency = accounts[0]?.currency ?? 'USD';

  if (accounts.length === 0) {
    return (
      <section className="empty">
        <h2>Start with an account</h2>
        <p>Add the bank accounts and cards you want to track. In the next version you’ll import their CSV statements.</p>
        <div className="row center">
          <button className="btn primary" onClick={onGoToAccounts}>
            Add an account
          </button>
          <button className="btn" onClick={() => addExampleData(s)}>
            Try it with example data
          </button>
        </div>
      </section>
    );
  }

  const byDate = new Map<string, Transaction[]>();
  for (const t of txns) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'Uncategorized';
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? s.get('accounts', id)?.name ?? '—';

  return (
    <section className="stack">
      <div className="summary">
        <div>
          <span className="label">In this month</span>
          <span className="figure pos">{formatMoney(moneyIn, currency)}</span>
        </div>
        <div>
          <span className="label">Out this month</span>
          <span className="figure">{formatMoney(-moneyOut, currency)}</span>
        </div>
        <div>
          <span className="label">Net</span>
          <span className={'figure ' + (moneyIn + moneyOut >= 0 ? 'pos' : 'neg')}>
            {formatMoney(moneyIn + moneyOut, currency)}
          </span>
        </div>
      </div>

      <div className="row">
        <input
          id="txn-search"
          className="grow"
          type="search"
          placeholder="Search payees and notes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search transactions"
        />
        <button className="btn primary" onClick={() => setEditing('new')}>
          Add
        </button>
      </div>

      {editing && (
        <TransactionForm
          initial={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
          groupLabels={GROUP_LABELS}
        />
      )}

      {txns.length === 0 ? (
        <p className="muted">{query ? 'No transactions match that search.' : 'No transactions yet.'}</p>
      ) : (
        <div className="ledger">
          {[...byDate.entries()].map(([date, items]) => (
            <div key={date} className="day">
              <h3 className="day-head">{formatDate(date)}</h3>
              {items.map((t) => (
                <button key={t.id} className="txn" onClick={() => setEditing(t)}>
                  <span className="txn-main">
                    <span className="payee">{t.payee || 'No payee'}</span>
                    <span className="meta">
                      <span className="chip">{catName(t.categoryId)}</span> {accName(t.accountId)}
                    </span>
                  </span>
                  <span className={'amount ' + (t.amount > 0 ? 'pos' : '')}>
                    {formatMoney(t.amount, s.get('accounts', t.accountId)?.currency ?? currency)}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function TransactionForm({
  initial,
  onDone,
  groupLabels,
}: {
  initial: Transaction | null;
  onDone: () => void;
  groupLabels: Record<CategoryGroup, string>;
}) {
  const s = useSession();
  const accounts = s.list('accounts').filter((a) => !a.archived || a.id === initial?.accountId);
  const categories = s.list('categories').filter((c) => !c.archived);
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? '');
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const [payee, setPayee] = useState(initial?.payee ?? '');
  const [direction, setDirection] = useState<'out' | 'in'>(initial && initial.amount > 0 ? 'in' : 'out');
  const currency = s.get('accounts', accountId)?.currency ?? 'USD';
  const [amount, setAmount] = useState(
    initial ? (Math.abs(initial.amount) / 10 ** currencyExponent(currency)).toFixed(currencyExponent(currency)) : '',
  );
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const minor = parseAmount(amount, currency);
    if (minor === null || minor === 0) return setError('Enter an amount, for example 12.50.');
    if (!date) return setError('Choose a date.');
    const t: Transaction = {
      id: initial?.id ?? newId(),
      accountId,
      date,
      amount: direction === 'out' ? -Math.abs(minor) : Math.abs(minor),
      payee: payee.trim(),
      categoryId: categoryId || null,
      notes: notes.trim(),
      source: initial?.source ?? 'manual',
      importId: initial?.importId ?? null,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    };
    await s.put('transactions', t);
    onDone();
  };

  const groups = Object.keys(groupLabels) as CategoryGroup[];

  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>{initial ? 'Edit transaction' : 'New transaction'}</h2>
      <div className="segmented" role="radiogroup" aria-label="Direction">
        <button type="button" role="radio" aria-checked={direction === 'out'} className={direction === 'out' ? 'on' : ''} onClick={() => setDirection('out')}>
          Money out
        </button>
        <button type="button" role="radio" aria-checked={direction === 'in'} className={direction === 'in' ? 'on' : ''} onClick={() => setDirection('in')}>
          Money in
        </button>
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="txn-amount">Amount ({currency})</label>
          <input id="txn-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus />
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
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="txn-category">Category</label>
          <select id="txn-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Uncategorized</option>
            {groups.map((g) => (
              <optgroup key={g} label={groupLabels[g]}>
                {categories
                  .filter((c) => c.group === g)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="txn-notes">Notes</label>
        <input id="txn-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        {initial &&
          (confirmDelete ? (
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                await s.delete('transactions', initial.id);
                onDone();
              }}
            >
              Confirm delete
            </button>
          ) : (
            <button type="button" className="btn ghost danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          ))}
        <span className="grow" />
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary">Save</button>
      </div>
    </form>
  );
}
