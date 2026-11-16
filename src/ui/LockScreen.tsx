import { useState, type FormEvent } from 'react';
import { unlock, wipeDevice, restoreBackup, type Session } from '../db/store';
import { WrongPassphraseError } from '../crypto/vault';
import { RestoreForm } from './RestoreForm';

export function LockScreen({ onUnlock, onErased }: { onUnlock: (s: Session) => void; onErased: () => void }) {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'unlock' | 'erase' | 'restore'>('unlock');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onUnlock(await unlock(pass));
    } catch (err) {
      setError(err instanceof WrongPassphraseError ? 'That passphrase is not correct. Try again.' : (err as Error).message);
      setBusy(false);
      setPass('');
    }
  };

  if (mode === 'restore') {
    return (
      <div className="center-screen">
        <div className="panel narrow">
          <h1>Restore a backup</h1>
          <RestoreForm onRestore={(json, p) => restoreBackup(json, p).then(onUnlock)} onCancel={() => setMode('unlock')} />
        </div>
      </div>
    );
  }

  return (
    <div className="center-screen">
      <form className="panel narrow" onSubmit={submit}>
        <img src="/icon.svg" alt="" width={56} height={56} />
        <h1>MishMash is locked</h1>
        <label htmlFor="lock-pass">Passphrase</label>
        <input
          id="lock-pass"
          type="password"
          autoComplete="current-password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          autoFocus
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary block" disabled={busy || !pass}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>

        {mode === 'unlock' ? (
          <div className="row center">
            <button type="button" className="btn link" onClick={() => setMode('restore')}>
              Restore a backup
            </button>
            <button type="button" className="btn link danger" onClick={() => setMode('erase')}>
              Forgot passphrase?
            </button>
          </div>
        ) : (
          <div className="notice danger">
            <p>
              Without the passphrase the data can’t be decrypted. You can erase everything on this device and start
              again, or restore a backup.
            </p>
            <div className="row">
              <button type="button" className="btn" onClick={() => setMode('unlock')}>
                Keep my data
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={async () => {
                  await wipeDevice();
                  onErased();
                }}
              >
                Erase this device
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
