import { useEffect, useState, type FormEvent } from 'react';
import { useSession, readPref, writePref, todayIso } from './session';
import { wipeDevice } from '../db/store';
import { WrongPassphraseError } from '../crypto/vault';
import { biometricAvailable, enrollBiometric } from '../crypto/biometric';
import { getSettings, updateSettings } from '../domain/settings';
import { GROUP_LABELS } from '../domain/defaults';
import { newId, type Biometric, type Category, type CategoryGroup } from '../domain/types';
import { downloadText } from './download';
import { CURRENCIES } from './WealthView';

export function SettingsView({ onErased, onHelp }: { onErased: () => void; onHelp: () => void }) {
  const s = useSession();
  const [autoLock, setAutoLock] = useState(readPref<number>('autoLockMinutes', 5));
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [backupNote, setBackupNote] = useState('');
  const [confirmErase, setConfirmErase] = useState(false);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  const exportBackup = async () => {
    downloadText(`mishmash-backup-${todayIso()}.json`, await s.exportBackup());
    writePref('lastBackup', new Date().toISOString());
    setBackupNote('Backup saved. Keep it somewhere safe, such as a computer or USB drive.');
  };
  const lastBackup = readPref<string | null>('lastBackup', null);

  return (
    <section className="stack">
      <h1>Settings</h1>
      <div className="panel stack">
        <h2>Security</h2>
        <div className="field">
          <label htmlFor="set-autolock">Lock automatically after</label>
          <select id="set-autolock" value={autoLock} onChange={(e) => { const v = Number(e.target.value); setAutoLock(v); writePref('autoLockMinutes', v); }}>
            <option value={1}>1 minute of inactivity</option>
            <option value={5}>5 minutes of inactivity</option>
            <option value={15}>15 minutes of inactivity</option>
            <option value={60}>1 hour of inactivity</option>
            <option value={0}>Never (not recommended)</option>
          </select>
          <span className="hint">Takes effect the next time you unlock.</span>
        </div>
        <BiometricSetting />
        <ChangePassphrase />
      </div>

      <div className="panel stack">
        <h2>Backups</h2>
        <p>Your data exists only in this browser. If you clear site data or lose this device without a backup, it’s gone. Backups are encrypted with your current passphrase.</p>
        <p className="muted">{lastBackup ? `Last backup: ${new Date(lastBackup).toLocaleString()}` : 'No backup made from this device yet.'}</p>
        <button className="btn primary" onClick={exportBackup}>Download encrypted backup</button>
        {backupNote && <p className="notice ok">{backupNote}</p>}
        <p className="muted small">To restore a backup, lock the app and choose “Restore a backup”. For a spreadsheet copy, use Export CSV on the Transactions screen.</p>
      </div>

      <CurrencySettings />
      <CategoryManager />
      <Templates />

      <div className="panel stack">
        <h2>Privacy</h2>
        <ul className="facts">
          <li>No bank connections. You import files you download yourself.</li>
          <li>No accounts, analytics or tracking. The app makes no network requests.</li>
          <li>Everything is encrypted with AES-256 before it’s stored.</li>
          <li>Storage protection: {persisted === null ? 'unknown in this browser' : persisted ? 'on (the browser won’t clear it to free space)' : 'off. Install the app to your home screen to turn it on.'}</li>
        </ul>
        <button className="btn link" onClick={onHelp}>Keyboard shortcuts</button>
      </div>

      <div className="panel stack">
        <h2>Erase</h2>
        <p>Permanently delete all accounts, transactions and your passphrase from this device.</p>
        {confirmErase ? (
          <div className="row">
            <button className="btn" onClick={() => setConfirmErase(false)}>Cancel</button>
            <button className="btn danger" onClick={async () => { s.lock(); await wipeDevice(); onErased(); }}>Yes, erase everything</button>
          </div>
        ) : (
          <button className="btn ghost danger" onClick={() => setConfirmErase(true)}>Erase this device</button>
        )}
      </div>
      <p className="muted small">MishMash Finances · v1.0</p>
    </section>
  );
}

function BiometricSetting() {
  const s = useSession();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [enrolled, setEnrolled] = useState<Biometric | null>(null);
  const [pass, setPass] = useState('');
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    biometricAvailable().then(setAvailable);
    s.readMeta<Biometric>('biometric').then((b) => setEnrolled(b ?? null));
  }, [s]);

  if (available === false && !enrolled) return <p className="muted small">Face ID / fingerprint unlock isn’t available in this browser.</p>;
  if (available === null) return null;

  if (enrolled)
    return (
      <div className="row">
        <span className="grow">Face ID / fingerprint unlock is <strong>on</strong> (since {new Date(enrolled.createdAt).toLocaleDateString()}).</span>
        <button className="btn ghost danger" onClick={async () => { await s.writeMeta('biometric', undefined); setEnrolled(null); setMsg({ ok: true, text: 'Biometric unlock turned off. You can also delete the “MishMash vault” passkey in your device settings.' }); }}>Turn off</button>
        {msg && <p className="notice ok">{msg.text}</p>}
      </div>
    );

  const enroll = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const b = await enrollBiometric(await s.envelope(), pass);
      await s.writeMeta('biometric', b);
      setEnrolled(b);
      setOpen(false);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof WrongPassphraseError ? 'That passphrase is not correct.' : (err as Error).name === 'NotAllowedError' ? 'Setup was cancelled.' : (err as Error).message });
    }
    setPass('');
    setBusy(false);
  };

  return open ? (
    <form className="stack" onSubmit={enroll}>
      <p className="small">Confirm your passphrase, then follow your device’s prompt. Your passphrase keeps working as a fallback.</p>
      <div className="field">
        <label htmlFor="bio-pass">Passphrase</label>
        <input id="bio-pass" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
      </div>
      {msg && <p className="error">{msg.text}</p>}
      <div className="row">
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn primary" disabled={busy || !pass}>{busy ? 'Waiting for device…' : 'Turn on'}</button>
      </div>
    </form>
  ) : (
    <button className="btn" onClick={() => setOpen(true)}>Unlock with Face ID / fingerprint</button>
  );
}

function ChangePassphrase() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return setMsg({ ok: false, text: 'Use at least 8 characters.' });
    setBusy(true);
    try {
      await s.changePassphrase(current, next);
      setMsg({ ok: true, text: 'Passphrase changed. Older backups still need the old passphrase.' });
      setCurrent('');
      setNext('');
      setOpen(false);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof WrongPassphraseError ? 'The current passphrase is not correct.' : (err as Error).message });
    }
    setBusy(false);
  };

  if (!open)
    return (
      <>
        <button className="btn" onClick={() => setOpen(true)}>Change passphrase</button>
        {msg && <p className={'notice ' + (msg.ok ? 'ok' : 'danger')}>{msg.text}</p>}
      </>
    );

  return (
    <form className="stack" onSubmit={submit}>
      <div className="field"><label htmlFor="cp-current">Current passphrase</label><input id="cp-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
      <div className="field"><label htmlFor="cp-next">New passphrase</label><input id="cp-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
      {msg && !msg.ok && <p className="error">{msg.text}</p>}
      <div className="row">
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save new passphrase'}</button>
      </div>
    </form>
  );
}

function CurrencySettings() {
  const s = useSession();
  const settings = getSettings(s);
  const used = [...new Set(s.list('accounts').map((a) => a.currency))].filter((c) => c !== settings.baseCurrency);
  const [rates, setRates] = useState<Record<string, string>>(Object.fromEntries(Object.entries(settings.exchangeRates).map(([k, v]) => [k, String(v)])));
  return (
    <div className="panel stack">
      <h2>Currency</h2>
      <div className="field">
        <label htmlFor="set-base">Main currency</label>
        <select id="set-base" value={settings.baseCurrency} onChange={(e) => updateSettings(s, { baseCurrency: e.target.value })}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <span className="hint">Totals, budgets and net worth are shown in this currency.</span>
      </div>
      {used.length > 0 && (
        <>
          <h3>Exchange rates</h3>
          <p className="muted small">MishMash doesn’t go online, so enter rates yourself and update them now and then.</p>
          {used.map((c) => (
            <div className="field" key={c}>
              <label htmlFor={`rate-${c}`}>1 {c} = ? {settings.baseCurrency}</label>
              <input
                id={`rate-${c}`}
                inputMode="decimal"
                value={rates[c] ?? ''}
                onChange={(e) => setRates({ ...rates, [c]: e.target.value })}
                onBlur={() => {
                  const v = Number(rates[c]);
                  const next = { ...settings.exchangeRates };
                  if (v > 0) next[c] = v;
                  else delete next[c];
                  updateSettings(s, { exchangeRates: next });
                }}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function CategoryManager() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [group, setGroup] = useState<CategoryGroup>('everyday');
  const cats = s.list('categories');
  const usage = new Map<string, number>();
  for (const t of s.list('transactions')) if (t.categoryId) usage.set(t.categoryId, (usage.get(t.categoryId) ?? 0) + 1);
  const save = (c: Category) => s.put('categories', c);

  return (
    <div className="panel stack">
      <div className="row">
        <h2 className="grow">Categories</h2>
        <button className="btn" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Edit categories'}</button>
      </div>
      {open && (
        <>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await save({ id: newId(), name: name.trim(), group, archived: false }); setName(''); }}>
            <input id="cat-new-name" className="grow" aria-label="New category name" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
            <select id="cat-new-group" aria-label="Group" value={group} onChange={(e) => setGroup(e.target.value as CategoryGroup)}>
              {(Object.keys(GROUP_LABELS) as CategoryGroup[]).map((g) => <option key={g} value={g}>{GROUP_LABELS[g]}</option>)}
            </select>
            <button className="btn primary">Add</button>
          </form>
          {(Object.keys(GROUP_LABELS) as CategoryGroup[]).map((g) => (
            <div key={g} className="stack">
              <h3 className="label">{GROUP_LABELS[g]}</h3>
              {cats.filter((c) => c.group === g).sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                <div key={c.id} className={'cat-edit ' + (c.archived ? 'archived' : '')}>
                  <input id={`cat-name-${c.id}`} aria-label="Category name" defaultValue={c.name} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && save({ ...c, name: e.target.value.trim() })} />
                  <select id={`cat-group-${c.id}`} aria-label="Group" value={c.group} onChange={(e) => save({ ...c, group: e.target.value as CategoryGroup })}>
                    {(Object.keys(GROUP_LABELS) as CategoryGroup[]).map((x) => <option key={x} value={x}>{GROUP_LABELS[x]}</option>)}
                  </select>
                  <span className="meta">{usage.get(c.id) ?? 0} used</span>
                  <button className="btn ghost small" onClick={() => save({ ...c, archived: !c.archived })}>{c.archived ? 'Restore' : 'Hide'}</button>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Templates() {
  const s = useSession();
  const templates = s.list('templates');
  if (templates.length === 0) return null;
  return (
    <div className="panel stack">
      <h2>Saved bank file layouts</h2>
      <p className="muted small">MishMash remembers how each bank’s CSV is laid out, so the next import takes one tap.</p>
      <ul className="plain">
        {templates.map((t) => (
          <li key={t.id} className="row">
            <span className="grow">{t.name} <span className="meta">· {t.dateFormat} · {s.get('accounts', t.accountId ?? '')?.name ?? 'no default account'}</span></span>
            <button className="btn ghost danger small" onClick={() => s.delete('templates', t.id)}>Forget</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
