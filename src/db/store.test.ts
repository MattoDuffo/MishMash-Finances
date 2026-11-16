import { describe, it, expect, beforeEach } from 'vitest';
import { setupVault, unlock, vaultStatus, wipeDevice, restoreBackup, DB_NAME } from './store';
import { WrongPassphraseError } from '../crypto/vault';
import { newId, type Account } from '../domain/types';
import { openDB } from 'idb';

const FAST = 1000;

const account = (): Account => ({
  id: newId(),
  name: 'Everyday Checking',
  kind: 'checking',
  currency: 'USD',
  openingBalance: 50000,
  archived: false,
  createdAt: new Date().toISOString(),
});

beforeEach(async () => {
  await wipeDevice();
});

describe('store', () => {
  it('sets up, seeds categories, and persists across lock/unlock', async () => {
    expect(await vaultStatus()).toBe('new');
    const s = await setupVault('pass phrase', FAST);
    expect(s.list('categories').length).toBeGreaterThan(5);
    const a = account();
    await s.put('accounts', a);
    s.lock();
    expect(await vaultStatus()).toBe('locked');

    const s2 = await unlock('pass phrase');
    expect(s2.get('accounts', a.id)).toEqual(a);
    s2.lock();
  });

  it('stores only ciphertext on disk', async () => {
    const s = await setupVault('pass phrase', FAST);
    await s.put('accounts', account());
    s.lock();
    const db = await openDB(DB_NAME);
    const rows = await db.getAll('accounts');
    db.close();
    expect(JSON.stringify(rows)).not.toContain('Everyday Checking');
  });

  it('refuses a wrong passphrase', async () => {
    (await setupVault('pass phrase', FAST)).lock();
    await expect(unlock('nope')).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('refuses writes after lock', async () => {
    const s = await setupVault('pass phrase', FAST);
    s.lock();
    await expect(s.put('accounts', account())).rejects.toThrow('locked');
  });

  it('exports and restores an encrypted backup', async () => {
    const s = await setupVault('pass phrase', FAST);
    const a = account();
    await s.put('accounts', a);
    const backup = await s.exportBackup();
    expect(backup).not.toContain('Everyday Checking');
    s.lock();
    await wipeDevice();

    await expect(restoreBackup(backup, 'wrong')).rejects.toBeInstanceOf(WrongPassphraseError);
    const restored = await restoreBackup(backup, 'pass phrase');
    expect(restored.get('accounts', a.id)).toEqual(a);
    restored.lock();
  });
});
