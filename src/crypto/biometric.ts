/**
 * Unlock with Face ID, Touch ID, Windows Hello or a fingerprint, using a
 * passkey with the WebAuthn PRF extension. The passkey produces a secret
 * that only this device's authenticator can recreate; it wraps a copy of
 * the data key. The passphrase keeps working and is still needed for
 * backups and if the passkey is removed.
 *
 * Browser support: Chrome/Edge/Android and Safari 18+ (iOS 18, macOS 15).
 */
import { fromBase64, toBase64, unwrapRaw, importDataKey, type KeyEnvelope } from './vault';
import type { Biometric } from '../domain/types';

const subtle = () => globalThis.crypto.subtle;
const rnd = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export async function biometricAvailable(): Promise<boolean> {
  try {
    return (
      typeof PublicKeyCredential !== 'undefined' &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

async function keyFromPrf(prf: ArrayBuffer): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', prf, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('mishmash-biometric-v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

async function evaluatePrf(credentialId: Uint8Array, salt: Uint8Array): Promise<ArrayBuffer> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: rnd(32),
      allowCredentials: [{ type: 'public-key', id: credentialId }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  const out = (cred?.getClientExtensionResults() as PrfResults)?.prf?.results?.first;
  if (!out) throw new Error('This device’s passkeys don’t support unlocking apps. Keep using your passphrase.');
  return out;
}

/** Creates a passkey and stores a biometric-wrapped copy of the data key. */
export async function enrollBiometric(envelope: KeyEnvelope, passphrase: string): Promise<Biometric> {
  const raw = await unwrapRaw(envelope, passphrase); // also verifies the passphrase
  try {
    const salt = rnd(32);
    const cred = (await navigator.credentials.create({
      publicKey: {
        rp: { name: 'MishMash Finances', id: location.hostname },
        user: { id: rnd(16), name: 'MishMash vault', displayName: 'MishMash vault' },
        challenge: rnd(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    if (!cred) throw new Error('Setting up the passkey was cancelled.');
    const ext = cred.getClientExtensionResults() as PrfResults;
    if (ext.prf?.enabled === false) throw new Error('This device’s passkeys don’t support unlocking apps. Keep using your passphrase.');
    const credentialId = new Uint8Array(cred.rawId);
    const prf = ext.prf?.results?.first ?? (await evaluatePrf(credentialId, salt));
    const key = await keyFromPrf(prf);
    const iv = rnd(12);
    const wrapped = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, raw));
    return { id: 'biometric', credentialId: toBase64(credentialId), salt: toBase64(salt), iv: toBase64(iv), wrappedKey: toBase64(wrapped), createdAt: new Date().toISOString() };
  } finally {
    raw.fill(0);
  }
}

/** Prompts for biometrics and returns the data key. */
export async function unlockWithBiometric(b: Biometric): Promise<CryptoKey> {
  const prf = await evaluatePrf(fromBase64(b.credentialId), fromBase64(b.salt));
  const key = await keyFromPrf(prf);
  const raw = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(b.iv) }, key, fromBase64(b.wrappedKey)));
  try {
    return await importDataKey(raw);
  } finally {
    raw.fill(0);
  }
}
