import { useEffect, useState, type FormEvent } from 'react';
import { useSession, readPref, writePref, todayIso } from './session';
import { wipeDevice } from '../db/store';
import { WrongPassphraseError } from '../crypto/vault';

export function SettingsView({ onErased }: { onErased: () => void }) {
  const s = useSession();
  const [autoLock, setAutoLock] = useState(readPref<number>('autoLockMinutes', 5));
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [backupNote, setBackupNote] = useState('');
  const [confirmErase, setConfirmErase] = useState(false);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  const exportBackup = async () => {
    const json = await s.exportBackup();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `mishmash-backup-${todayIso()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    writePref('lastBackup', new Date().toISOString());
    setBackupNote('Backup saved. Keep it somewhere safe, such as a computer or USB drive.');
  };

  const lastBackup = readPref<string | null>('lastBackup', null);

  return (
    <section className="stack">
      <div className="panel stack">
        <h2>Security</h2>
        <div className="field">
          <label htmlFor="set-autolock">Lock automatically after</label>
          <select
            id="set-autolock"
            value={autoLock}
            onChange={(e) => {
              const v = Number(e.target.value);
              setAutoLock(v);
              writePref('autoLockMinutes', v);
            }}
          >
            <option value={1}>1 minute of inactivity</option>
            <option value={5}>5 minutes of inactivity</option>
            <option value={15}>15 minutes of inactivity</option>
            <option value={60}>1 hour of inactivity</option>
            <option value={0}>Never (not recommended)</option>
          </select>
          <span className="hint">Takes effect the next time you unlock.</span>
        </div>
        <ChangePassphrase />
      </div>

      <div className="panel stack">
        <h2>Backups</h2>
        <p>
          Your data exists only in this browser. If you clear site data or lose this device without a backup, it’s gone.
          Backups are encrypted with your current passphrase.
        </p>
        <p className="muted">{lastBackup ? `Last backup: ${new Date(lastBackup).toLocaleString()}` : 'No backup made from this device yet.'}</p>
        <button className="btn primary" onClick={exportBackup}>
          Download encrypted backup
        </button>
        {backupNote && <p className="notice ok">{backupNote}</p>}
      </div>

      <div className="panel stack">
        <h2>Privacy</h2>
        <ul className="facts">
          <li>No bank connections. You add data yourself.</li>
          <li>No accounts, analytics or tracking. The app makes no network requests.</li>
          <li>Everything is encrypted with AES-256 before it’s stored.</li>
          <li>
            Storage protection:{' '}
            {persisted === null
              ? 'unknown in this browser'
              : persisted
                ? 'on (the browser won’t clear it to free space)'
                : 'off. Install the app to your home screen to turn it on.'}
          </li>
        </ul>
      </div>

      <div className="panel stack">
        <h2>Erase</h2>
        <p>Permanently delete all accounts, transactions and your passphrase from this device.</p>
        {confirmErase ? (
          <div className="row">
            <button className="btn" onClick={() => setConfirmErase(false)}>
              Cancel
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                s.lock();
                await wipeDevice();
                onErased();
              }}
            >
              Yes, erase everything
            </button>
          </div>
        ) : (
          <button className="btn ghost danger" onClick={() => setConfirmErase(true)}>
            Erase this device
          </button>
        )}
      </div>
      <p className="muted small">MishMash Finances · prototype v0.1</p>
    </section>
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
        <button className="btn" onClick={() => setOpen(true)}>
          Change passphrase
        </button>
        {msg && <p className={'notice ' + (msg.ok ? 'ok' : 'danger')}>{msg.text}</p>}
      </>
    );

  return (
    <form className="stack" onSubmit={submit}>
      <div className="field">
        <label htmlFor="cp-current">Current passphrase</label>
        <input id="cp-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cp-next">New passphrase</label>
        <input id="cp-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      {msg && !msg.ok && <p className="error">{msg.text}</p>}
      <div className="row">
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save new passphrase'}
        </button>
      </div>
    </form>
  );
}
