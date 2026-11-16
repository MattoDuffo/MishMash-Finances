/**
 * Encrypted on-device storage in IndexedDB.
 *
 * Each record is stored as { id, iv, ct }: only the random id is readable,
 * everything else (amounts, payees, account names) is AES-GCM ciphertext.
 * While unlocked, decrypted records are kept in memory for fast reads, and
 * every write is encrypted before it touches the disk.
 */
import { openDB, deleteDB, type IDBPDatabase } from 'idb';
import {
  createVault,
  unlockVault,
  changePassphrase as rewrap,
  encryptJson,
  decryptJson,
  type KeyEnvelope,
  type EncryptedBlob,
} from '../crypto/vault';
import { COLLECTIONS, type CollectionName, type Collections, type Id } from '../domain/types';
import { defaultCategories } from '../domain/defaults';

export const DB_NAME = 'mishmash';
const DB_VERSION = 2;
const ENVELOPE_KEY = 'keyEnvelope';

type StoredRecord = EncryptedBlob & { id: Id };

async function open(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Each version only adds stores, so creating whatever is missing works
      // for fresh installs and upgrades alike.
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      for (const c of COLLECTIONS) if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: 'id' });
    },
  });
}

export type VaultStatus = 'new' | 'locked';

export async function vaultStatus(): Promise<VaultStatus> {
  const db = await open();
  try {
    return (await db.get('meta', ENVELOPE_KEY)) ? 'locked' : 'new';
  } finally {
    db.close();
  }
}

/** Creates the vault with a passphrase and default categories, and unlocks it. */
export async function setupVault(passphrase: string, iterations?: number): Promise<Session> {
  const db = await open();
  if (await db.get('meta', ENVELOPE_KEY)) {
    db.close();
    throw new Error('A vault already exists on this device.');
  }
  const { envelope, dataKey } = await createVault(passphrase, iterations);
  await db.put('meta', envelope, ENVELOPE_KEY);
  const session = new Session(db, dataKey, emptyCache());
  for (const c of defaultCategories()) await session.put('categories', c);
  return session;
}

/** Unlocks an existing vault. Throws WrongPassphraseError on a bad passphrase. */
export async function unlock(passphrase: string): Promise<Session> {
  const envelope = await readMetaValue<KeyEnvelope>(ENVELOPE_KEY);
  if (!envelope) throw new Error('There is no vault on this device yet.');
  return openWithKey(await unlockVault(envelope, passphrase));
}

/** Reads an unencrypted meta value (key envelopes) before unlocking. */
export async function readMetaValue<T>(key: string): Promise<T | undefined> {
  const db = await open();
  try {
    return (await db.get('meta', key)) as T | undefined;
  } finally {
    db.close();
  }
}

/** Opens the vault with an already-unwrapped data key (e.g. from biometrics). */
export async function openWithKey(key: CryptoKey): Promise<Session> {
  const db = await open();
  const cache = emptyCache();
  try {
    for (const c of COLLECTIONS) {
      const rows = (await db.getAll(c)) as StoredRecord[];
      for (const row of rows) {
        const rec = await decryptJson<Collections[typeof c]>(key, row);
        (cache[c] as Map<Id, unknown>).set(row.id, rec);
      }
    }
  } catch (e) {
    db.close();
    throw e;
  }
  return new Session(db, key, cache);
}

/** Permanently deletes every record and the key from this device. */
export async function wipeDevice(): Promise<void> {
  await deleteDB(DB_NAME);
}

type Cache = { [K in CollectionName]: Map<Id, Collections[K]> };
const emptyCache = (): Cache => Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()])) as unknown as Cache;

export class Session {
  private listeners = new Set<() => void>();
  private locked = false;

  constructor(
    private db: IDBPDatabase,
    private key: CryptoKey,
    private cache: Cache,
  ) {}

  list<K extends CollectionName>(c: K): Collections[K][] {
    return [...this.cache[c].values()];
  }

  get<K extends CollectionName>(c: K, id: Id): Collections[K] | undefined {
    return this.cache[c].get(id);
  }

  async put<K extends CollectionName>(c: K, record: Collections[K]): Promise<void> {
    this.assertOpen();
    const blob = await encryptJson(this.key, record);
    await this.db.put(c, { id: record.id, ...blob } satisfies StoredRecord);
    this.cache[c].set(record.id, record);
    this.emit();
  }

  /** Writes many records in one IndexedDB transaction (used by imports). */
  async putMany<K extends CollectionName>(c: K, records: Collections[K][]): Promise<void> {
    this.assertOpen();
    const blobs = await Promise.all(records.map(async (r) => ({ id: r.id, ...(await encryptJson(this.key, r)) })));
    const tx = this.db.transaction(c, 'readwrite');
    await Promise.all([...blobs.map((b) => tx.store.put(b)), tx.done]);
    for (const r of records) this.cache[c].set(r.id, r);
    this.emit();
  }

  async deleteMany(c: CollectionName, ids: Id[]): Promise<void> {
    this.assertOpen();
    const tx = this.db.transaction(c, 'readwrite');
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
    for (const id of ids) this.cache[c].delete(id);
    this.emit();
  }

  /** The current data key wrapped differently, e.g. for biometric unlock. */
  async readMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.get('meta', key)) as T | undefined;
  }

  async writeMeta(key: string, value: unknown): Promise<void> {
    this.assertOpen();
    if (value === undefined) await this.db.delete('meta', key);
    else await this.db.put('meta', value, key);
  }

  async delete(c: CollectionName, id: Id): Promise<void> {
    this.assertOpen();
    await this.db.delete(c, id);
    this.cache[c].delete(id);
    this.emit();
  }

  async envelope(): Promise<KeyEnvelope> {
    return (await this.db.get('meta', ENVELOPE_KEY)) as KeyEnvelope;
  }

  async changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<void> {
    this.assertOpen();
    const envelope = await this.envelope();
    await this.db.put('meta', await rewrap(envelope, oldPassphrase, newPassphrase), ENVELOPE_KEY);
  }

  /**
   * An encrypted backup: the wrapped key plus ciphertext exactly as stored.
   * It can only be restored with the passphrase that was current at export.
   */
  async exportBackup(): Promise<string> {
    this.assertOpen();
    const envelope = await this.db.get('meta', ENVELOPE_KEY);
    const data: Record<string, StoredRecord[]> = {};
    for (const c of COLLECTIONS) data[c] = (await this.db.getAll(c)) as StoredRecord[];
    return JSON.stringify({ format: 'mishmash-backup', version: 1, exportedAt: new Date().toISOString(), envelope, data });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Drops the key and decrypted data from memory. */
  lock(): void {
    this.locked = true;
    for (const c of COLLECTIONS) this.cache[c].clear();
    this.db.close();
    this.listeners.clear();
  }

  private assertOpen() {
    if (this.locked) throw new Error('The vault is locked.');
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

/**
 * Replaces everything on this device with a backup file. The backup's
 * passphrase is checked first, so a bad file or wrong passphrase changes nothing.
 */
export async function restoreBackup(json: string, passphrase: string): Promise<Session> {
  let parsed: { format?: string; envelope?: KeyEnvelope; data?: Record<string, StoredRecord[]> };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('This file is not a MishMash backup.');
  }
  if (parsed.format !== 'mishmash-backup' || !parsed.envelope || !parsed.data) {
    throw new Error('This file is not a MishMash backup.');
  }
  await unlockVault(parsed.envelope, passphrase); // throws WrongPassphraseError
  await wipeDevice();
  const db = await open();
  await db.put('meta', parsed.envelope, ENVELOPE_KEY);
  for (const c of COLLECTIONS) for (const row of parsed.data[c] ?? []) await db.put(c, row);
  db.close();
  return unlock(passphrase);
}
