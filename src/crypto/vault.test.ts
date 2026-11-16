import { describe, it, expect } from 'vitest';
import { createVault, unlockVault, changePassphrase, encryptJson, decryptJson, WrongPassphraseError } from './vault';

const FAST = 1000; // low iteration count keeps tests quick

describe('vault', () => {
  it('round-trips data with the right passphrase', async () => {
    const { envelope, dataKey } = await createVault('correct horse', FAST);
    const blob = await encryptJson(dataKey, { payee: 'Grocer', amount: -1234 });
    expect(blob.ct).not.toContain('Grocer');
    const key = await unlockVault(envelope, 'correct horse');
    expect(await decryptJson(key, blob)).toEqual({ payee: 'Grocer', amount: -1234 });
  });

  it('rejects a wrong passphrase', async () => {
    const { envelope } = await createVault('correct horse', FAST);
    await expect(unlockVault(envelope, 'wrong')).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('changes passphrase without re-encrypting data', async () => {
    const { envelope, dataKey } = await createVault('old pass', FAST);
    const blob = await encryptJson(dataKey, [1, 2, 3]);
    const next = await changePassphrase(envelope, 'old pass', 'new pass');
    await expect(unlockVault(next, 'old pass')).rejects.toBeInstanceOf(WrongPassphraseError);
    expect(await decryptJson(await unlockVault(next, 'new pass'), blob)).toEqual([1, 2, 3]);
  });

  it('uses a fresh IV per encryption', async () => {
    const { dataKey } = await createVault('p', FAST);
    const a = await encryptJson(dataKey, 'same');
    const b = await encryptJson(dataKey, 'same');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });
});
