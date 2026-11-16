import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useSession } from './session';
import { parseCsv, detectDelimiter } from '../import/csv';
import { DATE_FORMATS, detectDateFormats } from '../import/dates';
import { guessMapping, headerSignature, type Mapping } from '../import/mapping';
import { extractRows, planImport, type PlanItem, type RawRow, type RowError } from '../import/pipeline';
import { parseOfx, parseQif, detectFileKind } from '../import/formats';
import { Categorizer } from '../domain/categorize';
import { getSettings } from '../domain/settings';
import { formatMoney } from '../domain/money';
import { newId, type Account, type CsvTemplate, type ImportBatch, type TransactionSource } from '../domain/types';

type Loaded =
  | { kind: 'csv'; name: string; rows: string[][]; delimiter: string }
  | { kind: 'ofx' | 'qif'; name: string; raw: RawRow[]; errors: RowError[]; accountHint?: string };

export function ImportView({ initialFile, onClose, onReview }: { initialFile?: File | null; onClose: () => void; onReview: () => void }) {
  const [file, setFile] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<ImportBatch | null>(null);

  const load = async (f: File) => {
    setError('');
    setDone(null);
    try {
      const text = await f.text();
      const kind = detectFileKind(f.name, text);
      if (kind === 'ofx') {
        const r = parseOfx(text);
        setFile({ kind, name: f.name, raw: r.rows, errors: r.errors, accountHint: r.accountId });
      } else if (kind === 'qif') {
        const r = parseQif(text);
        setFile({ kind, name: f.name, raw: r.rows, errors: r.errors });
      } else {
        const delimiter = detectDelimiter(text);
        const rows = parseCsv(text, delimiter);
        if (rows.length === 0) throw new Error('This file is empty.');
        if (rows[0].length < 2) throw new Error('This doesn’t look like a CSV file with columns. Check that you exported CSV from your bank.');
        setFile({ kind: 'csv', name: f.name, rows, delimiter });
      }
    } catch (e) {
      setError((e as Error).message || 'This file could not be read.');
    }
  };

  useEffect(() => {
    if (initialFile) load(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  return (
    <section className="stack">
      <div className="row">
        <h2 className="grow">Import a bank file</h2>
        <button className="btn ghost" onClick={onClose}>
          Close
        </button>
      </div>

      {done ? (
        <Done batch={done} onAnother={() => { setDone(null); setFile(null); }} onReview={onReview} />
      ) : !file ? (
        <>
          <DropZone onFile={load} />
          {error && <p className="error" role="alert">{error}</p>}
          <ImportHistory />
        </>
      ) : (
        <ImportWizard loaded={file} onCancel={() => setFile(null)} onDone={setDone} />
      )}
    </section>
  );
}

function DropZone({ onFile }: { onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };
  return (
    <label
      className={'dropzone ' + (over ? 'over' : '')}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      htmlFor="import-file"
    >
      <strong>Choose a CSV, OFX, QFX or QIF file</strong>
      <span className="muted">or drop it here. Export it from your bank’s website or app first.</span>
      <input
        id="import-file"
        type="file"
        accept=".csv,.txt,.tsv,.ofx,.qfx,.qif,text/csv"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        className="visually-hidden"
      />
      <span className="btn primary">Choose file</span>
    </label>
  );
}

function ImportWizard({ loaded, onCancel, onDone }: { loaded: Loaded; onCancel: () => void; onDone: (b: ImportBatch) => void }) {
  const s = useSession();
  const accounts = s.list('accounts').filter((a) => !a.archived);
  const templates = s.list('templates');

  const signature = loaded.kind === 'csv' ? headerSignature(loaded.rows[0]) : '';
  const template = loaded.kind === 'csv' ? templates.find((t) => t.signature === signature) : undefined;

  const [accountId, setAccountId] = useState<string>(
    (template?.accountId && s.get('accounts', template.accountId) ? template.accountId : null) ?? accounts[0]?.id ?? '__new',
  );
  const [newAccountName, setNewAccountName] = useState('');
  const account: Account | undefined = s.get('accounts', accountId);
  const currency = account?.currency ?? 'USD';

  const [mapping, setMapping] = useState<Mapping | null>(() =>
    loaded.kind !== 'csv' ? null : template ? { ...template } : guessMapping(loaded.rows, loaded.delimiter, navigator.language !== 'en-US'),
  );
  const [saveTemplate, setSaveTemplate] = useState(true);
  const [step, setStep] = useState<'map' | 'preview'>(loaded.kind === 'csv' && !template ? 'map' : 'preview');
  const [busy, setBusy] = useState(false);

  const extracted = useMemo(() => {
    if (loaded.kind !== 'csv') return { rows: loaded.raw, errors: loaded.errors };
    return mapping ? extractRows(loaded.rows, mapping, currency) : { rows: [], errors: [] };
  }, [loaded, mapping, currency]);

  const plan: PlanItem[] = useMemo(() => {
    if (!accountId) return [];
    const txns = s.list('transactions');
    return planImport({
      rows: extracted.rows,
      accountId,
      existing: txns,
      rules: s.list('rules'),
      categorizer: new Categorizer(txns),
      source: loaded.kind as TransactionSource,
    });
  }, [extracted, accountId, s, loaded.kind]);

  const fresh = plan.filter((p) => p.status === 'new');
  const dupes = plan.length - fresh.length;
  const catName = (id: string | null) => (id ? (s.get('categories', id)?.name ?? '') : '');

  const commit = async () => {
    setBusy(true);
    let accId = accountId;
    if (accountId === '__new') {
      const acc: Account = {
        id: newId(),
        name: newAccountName.trim() || loaded.name.replace(/\.\w+$/, ''),
        kind: 'checking',
        currency: getSettings(s).baseCurrency,
        openingBalance: 0,
        archived: false,
        createdAt: new Date().toISOString(),
      };
      await s.put('accounts', acc);
      accId = acc.id;
    }
    let templateId: string | null = template?.id ?? null;
    if (loaded.kind === 'csv' && mapping && saveTemplate) {
      const t: CsvTemplate = {
        ...mapping,
        id: template?.id ?? newId(),
        name: template?.name ?? (s.get('accounts', accId)?.name ?? 'Bank') + ' CSV',
        signature,
        accountId: accId,
      };
      await s.put('templates', t);
      templateId = t.id;
    }
    const batch: ImportBatch = {
      id: newId(),
      accountId: accId,
      fileName: loaded.name,
      importedAt: new Date().toISOString(),
      added: fresh.length,
      skipped: dupes,
      templateId,
    };
    await s.putMany(
      'transactions',
      fresh.map((p) => ({ ...p.txn, accountId: accId, importId: batch.id })),
    );
    await s.put('imports', batch);
    onDone(batch);
  };

  return (
    <div className="stack">
      <div className="panel stack">
        <p className="muted small">File: {loaded.name}</p>
        <div className="field">
          <label htmlFor="imp-account">Import into</label>
          <select id="imp-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
            ))}
            <option value="__new">New account…</option>
          </select>
        </div>
        {accountId === '__new' && (
          <div className="field">
            <label htmlFor="imp-new-account">New account name</label>
            <input id="imp-new-account" value={newAccountName} onChange={(e) => setNewAccountName(e.target.value)} placeholder="Everyday checking" />
          </div>
        )}
        {template && step === 'preview' && (
          <p className="notice ok">
            Recognised this file’s layout from a previous import ({template.name}).{' '}
            <button className="btn link" onClick={() => setStep('map')}>Change columns</button>
          </p>
        )}
      </div>

      {step === 'map' && loaded.kind === 'csv' && mapping && (
        <MappingEditor rows={loaded.rows} mapping={mapping} onChange={setMapping} errors={extracted.errors.length} total={loaded.rows.length - (mapping.hasHeader ? 1 : 0)} />
      )}

      {step === 'map' ? (
        <div className="row">
          <button className="btn" onClick={onCancel}>Back</button>
          <span className="grow" />
          <button className="btn primary" disabled={extracted.rows.length === 0} onClick={() => setStep('preview')}>
            Preview {extracted.rows.length} rows
          </button>
        </div>
      ) : (
        <>
          <div className="summary">
            <div><span className="label">New</span><span className="figure">{fresh.length}</span></div>
            <div><span className="label">Already imported</span><span className="figure muted">{dupes}</span></div>
            <div><span className="label">Couldn’t read</span><span className={'figure ' + (extracted.errors.length ? 'neg' : 'muted')}>{extracted.errors.length}</span></div>
          </div>
          {extracted.errors.length > 0 && (
            <details className="panel">
              <summary>Rows that couldn’t be read</summary>
              <ul className="small">
                {extracted.errors.slice(0, 50).map((e) => <li key={e.line}>Line {e.line}: {e.reason}</li>)}
              </ul>
            </details>
          )}
          {fresh.length > 0 && (
            <div className="day">
              {fresh.slice(0, 200).map((p) => (
                <div key={p.txn.id} className="txn static">
                  <span className="txn-main">
                    <span className="payee">{p.txn.payee}</span>
                    <span className="meta">
                      {p.txn.date}
                      {p.txn.categoryId && <> · <span className="chip">{catName(p.txn.categoryId)}</span>{p.suggestedBy === 'rule' ? 'rule' : 'suggested'}</>}
                    </span>
                  </span>
                  <span className={'amount ' + (p.txn.amount > 0 ? 'pos' : '')}>{formatMoney(p.txn.amount, currency)}</span>
                </div>
              ))}
              {fresh.length > 200 && <p className="muted small pad">…and {fresh.length - 200} more</p>}
            </div>
          )}
          {loaded.kind === 'csv' && (
            <label className="check">
              <input id="imp-save-template" type="checkbox" checked={saveTemplate} onChange={(e) => setSaveTemplate(e.target.checked)} />
              Remember this layout for next time
            </label>
          )}
          <div className="row">
            <button className="btn" onClick={() => (loaded.kind === 'csv' ? setStep('map') : onCancel())}>Back</button>
            <span className="grow" />
            <button className="btn primary" disabled={busy || fresh.length === 0 || !accountId} onClick={commit}>
              {busy ? 'Importing…' : fresh.length === 0 ? 'Nothing new to import' : `Import ${fresh.length} transactions`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function MappingEditor({ rows, mapping, onChange, errors, total }: { rows: string[][]; mapping: Mapping; onChange: (m: Mapping) => void; errors: number; total: number }) {
  const header = mapping.hasHeader ? rows[0] : rows[0].map((_, i) => `Column ${i + 1}`);
  const sample = rows.slice(mapping.hasHeader ? 1 : 0, (mapping.hasHeader ? 1 : 0) + 5);
  const set = (patch: Partial<Mapping>) => onChange({ ...mapping, ...patch });
  const colOptions = (allowNone: boolean) => (
    <>
      {allowNone && <option value="-1">None</option>}
      {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
    </>
  );
  const dateSamples = sample.map((r) => r[mapping.dateColumn] ?? '');
  const fitting = new Set(detectDateFormats(dateSamples));
  const num = (v: string) => (Number(v) < 0 ? null : Number(v));

  return (
    <div className="panel stack">
      <h3>Match the columns</h3>
      <p className="muted small">We guessed these from the file. Check them against the preview below.</p>
      <div className="table-scroll">
        <table className="preview">
          <thead><tr>{header.map((h, i) => <th key={i}>{h || `Column ${i + 1}`}</th>)}</tr></thead>
          <tbody>{sample.map((r, i) => <tr key={i}>{header.map((_, j) => <td key={j}>{r[j]}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <label className="check">
        <input id="map-header" type="checkbox" checked={mapping.hasHeader} onChange={(e) => set({ hasHeader: e.target.checked })} />
        First row is a header
      </label>
      <div className="grid2">
        <div className="field">
          <label htmlFor="map-date">Date column</label>
          <select id="map-date" value={mapping.dateColumn} onChange={(e) => set({ dateColumn: Number(e.target.value) })}>{colOptions(false)}</select>
        </div>
        <div className="field">
          <label htmlFor="map-datefmt">Date format</label>
          <select id="map-datefmt" value={mapping.dateFormat} onChange={(e) => set({ dateFormat: e.target.value })}>
            {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}{fitting.has(f) ? '' : ' (doesn’t fit)'}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="map-payee">Description / payee</label>
          <select id="map-payee" value={mapping.payeeColumn} onChange={(e) => set({ payeeColumn: Number(e.target.value) })}>{colOptions(false)}</select>
        </div>
        <div className="field">
          <label htmlFor="map-memo">Notes (optional)</label>
          <select id="map-memo" value={mapping.memoColumn ?? -1} onChange={(e) => set({ memoColumn: num(e.target.value) })}>{colOptions(true)}</select>
        </div>
      </div>
      <div className="segmented" role="radiogroup" aria-label="Amount layout">
        <button type="button" role="radio" aria-checked={mapping.amountMode === 'signed'} className={mapping.amountMode === 'signed' ? 'on' : ''} onClick={() => set({ amountMode: 'signed' })}>One amount column</button>
        <button type="button" role="radio" aria-checked={mapping.amountMode === 'debit-credit'} className={mapping.amountMode === 'debit-credit' ? 'on' : ''} onClick={() => set({ amountMode: 'debit-credit' })}>Money in / out columns</button>
      </div>
      {mapping.amountMode === 'signed' ? (
        <div className="field">
          <label htmlFor="map-amount">Amount column</label>
          <select id="map-amount" value={mapping.amountColumn ?? -1} onChange={(e) => set({ amountColumn: num(e.target.value) })}>{colOptions(true)}</select>
        </div>
      ) : (
        <div className="grid2">
          <div className="field">
            <label htmlFor="map-debit">Money out column</label>
            <select id="map-debit" value={mapping.debitColumn ?? -1} onChange={(e) => set({ debitColumn: num(e.target.value) })}>{colOptions(true)}</select>
          </div>
          <div className="field">
            <label htmlFor="map-credit">Money in column</label>
            <select id="map-credit" value={mapping.creditColumn ?? -1} onChange={(e) => set({ creditColumn: num(e.target.value) })}>{colOptions(true)}</select>
          </div>
        </div>
      )}
      <label className="check">
        <input id="map-invert" type="checkbox" checked={mapping.invertSign} onChange={(e) => set({ invertSign: e.target.checked })} />
        Flip signs (some credit card files show purchases as positive)
      </label>
      <p className={errors ? 'error small' : 'muted small'}>
        {errors ? `${errors} of ${total} rows can’t be read with these settings.` : `All ${total} rows can be read.`}
      </p>
    </div>
  );
}

function Done({ batch, onAnother, onReview }: { batch: ImportBatch; onAnother: () => void; onReview: () => void }) {
  const s = useSession();
  const unreviewed = s.list('transactions').filter((t) => t.importId === batch.id && t.reviewed === false).length;
  return (
    <div className="panel stack">
      <h3>Imported {batch.added} transactions</h3>
      <p>
        {batch.skipped > 0 && `${batch.skipped} rows were already in MishMash and were skipped. `}
        {unreviewed > 0 ? `${unreviewed} need a quick review.` : 'Everything was categorised automatically.'}
      </p>
      <div className="row">
        {unreviewed > 0 && <button className="btn primary" onClick={onReview}>Review now</button>}
        <button className="btn" onClick={onAnother}>Import another file</button>
      </div>
    </div>
  );
}

function ImportHistory() {
  const s = useSession();
  const [confirm, setConfirm] = useState<string | null>(null);
  const batches = s.list('imports').sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  if (batches.length === 0) return null;
  const undo = async (b: ImportBatch) => {
    const ids = s.list('transactions').filter((t) => t.importId === b.id).map((t) => t.id);
    await s.deleteMany('transactions', ids);
    await s.delete('imports', b.id);
    setConfirm(null);
  };
  return (
    <div className="stack">
      <h3>Previous imports</h3>
      <ul className="cards">
        {batches.slice(0, 20).map((b) => {
          const remaining = s.list('transactions').filter((t) => t.importId === b.id).length;
          return (
            <li key={b.id} className="panel row">
              <span className="grow">
                <span className="payee">{b.fileName}</span>
                <span className="meta">
                  {new Date(b.importedAt).toLocaleDateString()} · {s.get('accounts', b.accountId)?.name ?? 'Deleted account'} · {remaining} transactions
                </span>
              </span>
              {confirm === b.id ? (
                <>
                  <button className="btn" onClick={() => setConfirm(null)}>Keep</button>
                  <button className="btn danger" onClick={() => undo(b)}>Remove {remaining}</button>
                </>
              ) : (
                <button className="btn ghost danger" onClick={() => setConfirm(b.id)}>Undo import</button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
