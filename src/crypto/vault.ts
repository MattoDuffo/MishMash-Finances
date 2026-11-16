/**
 * Encryption for everything MishMash stores on the device.
 *
 * Scheme (envelope encryption):
 * - A random 256-bit AES-GCM data key encrypts every record.
 * - The data key is itself encrypted ("wrapped") with a key derived from the
 *   user's passphrase using PBKDF2-SHA-256.
 * - Only the salt, iteration count and wrapped data key are stored. The
 *   passphrase and the unwrapped data key exist only in memory while unlocked.
 *
 * Changing the passphrase re-wraps the data key without re-encrypting data.
 * There is no recovery: a forgotten passphrase means the data cannot be read.
 */

export const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface KeyEnvelope {
  version: 1;
  salt: string; // base64
  iterations: number;
  iv: string; // base64, IV used to wrap the data key
  wrappedKey: string; // base64
}

export interface EncryptedBlob {
  iv: string; // base64
  ct: string; // base64
}

const subtle = () => globalThis.crypto.subtle;
const randomBytes = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveWrappingKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Creates a new data key and wraps it with the passphrase. */
export async function createVault(
  passphrase: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<{ envelope: KeyEnvelope; dataKey: CryptoKey }> {
  const dataKeyRaw = randomBytes(32);
  const envelope = await wrapDataKey(dataKeyRaw, passphrase, iterations);
  const dataKey = await importDataKey(dataKeyRaw);
  dataKeyRaw.fill(0);
  return { envelope, dataKey };
}

async function wrapDataKey(dataKeyRaw: Uint8Array, passphrase: string, iterations: number): Promise<KeyEnvelope> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const kek = await deriveWrappingKey(passphrase, salt, iterations);
  const wrapped = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, kek, dataKeyRaw));
  return { version: 1, salt: toBase64(salt), iterations, iv: toBase64(iv), wrappedKey: toBase64(wrapped) };
}

export function importDataKey(raw: Uint8Array): Promise<CryptoKey> {
  // Non-extractable: once imported, the raw key bytes can't be read back out.
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('That passphrase is not correct.');
    this.name = 'WrongPassphraseError';
  }
}

export async function unwrapRaw(envelope: KeyEnvelope, passphrase: string): Promise<Uint8Array> {
  const kek = await deriveWrappingKey(passphrase, fromBase64(envelope.salt), envelope.iterations);
  try {
    return new Uint8Array(
      await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv) }, kek, fromBase64(envelope.wrappedKey)),
    );
  } catch {
    // AES-GCM authentication fails when the derived key is wrong.
    throw new WrongPassphraseError();
  }
}

/** Unlocks the vault. Throws WrongPassphraseError on a bad passphrase. */
export async function unlockVault(envelope: KeyEnvelope, passphrase: string): Promise<CryptoKey> {
  const raw = await unwrapRaw(envelope, passphrase);
  const key = await importDataKey(raw);
  raw.fill(0);
  return key;
}

/** Re-wraps the same data key under a new passphrase. */
export async function changePassphrase(
  envelope: KeyEnvelope,
  oldPassphrase: string,
  newPassphrase: string,
): Promise<KeyEnvelope> {
  const raw = await unwrapRaw(envelope, oldPassphrase);
  const next = await wrapDataKey(raw, newPassphrase, envelope.iterations);
  raw.fill(0);
  return next;
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncryptedBlob> {
  const iv = randomBytes(IV_BYTES);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, plain));
  return { iv: toBase64(iv), ct: toBase64(ct) };
}

export async function decryptJson<T>(key: CryptoKey, blob: EncryptedBlob): Promise<T> {
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(blob.iv) }, key, fromBase64(blob.ct));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
