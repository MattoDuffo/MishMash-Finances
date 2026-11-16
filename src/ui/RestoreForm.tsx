import { useState, type FormEvent } from 'react';
import { WrongPassphraseError } from '../crypto/vault';

export function RestoreForm({
  onRestore,
  onCancel,
}: {
  onRestore: (json: string, passphrase: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return setError('Choose a backup file first.');
    setBusy(true);
    setError('');
    try {
      await onRestore(await file.text(), pass);
    } catch (err) {
      setError(
        err instanceof WrongPassphraseError
          ? 'That passphrase doesn’t open this backup. Use the passphrase you had when the backup was made.'
          : (err as Error).message,
      );
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack">
      <p>This replaces everything currently on this device with the backup.</p>
      <label htmlFor="restore-file">Backup file</label>
      <input id="restore-file" type="file" accept=".json,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <label htmlFor="restore-pass">Backup passphrase</label>
      <input id="restore-pass" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy}>
          {busy ? 'Restoring…' : 'Restore'}
        </button>
      </div>
    </form>
  );
}
