import { useState, type FormEvent } from 'react';
import { useSession, accountBalance } from './session';
import { formatMoney, parseAmount, currencyExponent } from '../domain/money';
import { newId, type Account, type AccountKind } from '../domain/types';

const KINDS: [AccountKind, string][] = [
  ['checking', 'Checking / current'],
  ['savings', 'Savings'],
  ['credit', 'Credit card'],
  ['cash', 'Cash'],
  ['investment', 'Investment'],
  ['loan', 'Loan / mortgage'],
  ['other', 'Other'],
];
const CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NZD', 'CHF', 'JPY'];

export function AccountsView() {
  const s = useSession();
  const txns = s.list('transactions');
  const accounts = s.list('accounts').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const [adding, setAdding] = useState(accounts.length === 0);
  const [editing, setEditing] = useState<Account | null>(null);

  const active = accounts.filter((a) => !a.archived);
  const byCurrency = new Map<string, number>();
  for (const a of active) byCurrency.set(a.currency, (byCurrency.get(a.currency) ?? 0) + accountBalance(a, txns));

  return (
    <section className="stack">
      {active.length > 0 && (
        <div className="summary">
          {[...byCurrency.entries()].map(([cur, total]) => (
            <div key={cur}>
              <span className="label">Net worth{byCurrency.size > 1 ? ` (${cur})` : ''}</span>
              <span className={'figure ' + (total < 0 ? 'neg' : '')}>{formatMoney(total, cur)}</span>
            </div>
          ))}
        </div>
      )}

      {adding || editing ? (
        <AccountForm
          initial={editing}
          onDone={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      ) : (
        <button className="btn primary" onClick={() => setAdding(true)}>
          Add account
        </button>
      )}

      <ul className="cards">
        {accounts.map((a) => {
          const bal = accountBalance(a, txns);
          const count = txns.filter((t) => t.accountId === a.id).length;
          return (
            <li key={a.id}>
              <button className={'account ' + (a.archived ? 'archived' : '')} onClick={() => setEditing(a)}>
                <span>
                  <span className="payee">{a.name}</span>
                  <span className="meta">
                    {KINDS.find(([k]) => k === a.kind)?.[1]} · {count} transaction{count === 1 ? '' : 's'}
                    {a.archived ? ' · archived' : ''}
                  </span>
                </span>
                <span className={'amount ' + (bal < 0 ? 'neg' : '')}>{formatMoney(bal, a.currency)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AccountForm({ initial, onDone }: { initial: Account | null; onDone: () => void }) {
  const s = useSession();
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<AccountKind>(initial?.kind ?? 'checking');
  const [currency, setCurrency] = useState(initial?.currency ?? 'USD');
  const [opening, setOpening] = useState(
    initial ? (initial.openingBalance / 10 ** currencyExponent(initial.currency)).toFixed(currencyExponent(initial.currency)) : '0',
  );
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Give the account a name, for example “Everyday checking”.');
    const minor = parseAmount(opening || '0', currency);
    if (minor === null) return setError('The opening balance must be a number, for example 1250.00 or -300.');
    await s.put('accounts', {
      id: initial?.id ?? newId(),
      name: name.trim(),
      kind,
      currency,
      openingBalance: minor,
      archived: initial?.archived ?? false,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    });
    onDone();
  };

  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>{initial ? 'Edit account' : 'New account'}</h2>
      <div className="field">
        <label htmlFor="acc-name">Name</label>
        <input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Everyday checking" autoFocus />
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="acc-kind">Type</label>
          <select id="acc-kind" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
            {KINDS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="acc-currency">Currency</label>
          <select id="acc-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="acc-opening">Opening balance</label>
        <input id="acc-opening" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
        <span className="hint">The balance before the first transaction you’ll record. Use a minus sign for money owed.</span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        {initial && (
          <button
            type="button"
            className="btn ghost"
            onClick={async () => {
              await s.put('accounts', { ...initial, archived: !initial.archived });
              onDone();
            }}
          >
            {initial.archived ? 'Unarchive' : 'Archive'}
          </button>
        )}
        <span className="grow" />
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary">Save</button>
      </div>
    </form>
  );
}
