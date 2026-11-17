import { useState, type FormEvent } from 'react';
import { setupVault, restoreBackup, type Session } from '../db/store';
import { RestoreForm } from './RestoreForm';

const MIN_LENGTH = 8;

export function SetupScreen({ onReady }: { onReady: (s: Session) => void }) {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (pass.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`);
    if (pass !== confirm) return setError('The two passphrases don’t match.');
    if (!understood) return setError('Tick the box to confirm you’ve stored your passphrase safely.');
    setBusy(true);
    try {
      onReady(await setupVault(pass));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (restoring) {
    return (
      <div className="center-screen">
        <div className="panel narrow">
          <h1>Restore a backup</h1>
          <RestoreForm onRestore={(json, p) => restoreBackup(json, p).then(onReady)} onCancel={() => setRestoring(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="center-screen">
      <form className="panel narrow" onSubmit={submit}>
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={56} height={56} />
        <h1>Welcome to MishMash</h1>
        <p className="lede">
          Your finances stay on this device. Nothing is uploaded, and there’s no account to sign up for.
        </p>
        <p>Choose a passphrase. It encrypts everything you store here.</p>

        <label htmlFor="setup-pass">Passphrase</label>
        <input
          id="setup-pass"
          type="password"
          autoComplete="new-password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          autoFocus
        />
        <label htmlFor="setup-confirm">Type it again</label>
        <input
          id="setup-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />

        <div className="notice warn">
          <strong>There is no way to recover a forgotten passphrase.</strong> Nobody, including us, can unlock your
          data without it. Write it down or keep it in a password manager.
        </div>
        <label className="check">
          <input id="setup-understood" type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          I’ve stored my passphrase somewhere safe
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Encrypting…' : 'Create my vault'}
        </button>
        <button type="button" className="btn link" onClick={() => setRestoring(true)}>
          Restore from a backup file instead
        </button>
      </form>
    </div>
  );
}
