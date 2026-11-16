/**
 * Files shared to the installed app (Android "Share" -> MishMash) arrive at
 * the service worker, which parks them in a cache until the vault is
 * unlocked. They are deleted as soon as they're read.
 */
const CACHE = 'mishmash-share';
const KEY = '/shared-file';

export async function takeSharedFile(): Promise<File | null> {
  if (!('caches' in window) || !new URLSearchParams(location.search).has('shared')) return null;
  try {
    const cache = await caches.open(CACHE);
    const res = await cache.match(KEY);
    await caches.delete(CACHE);
    history.replaceState(null, '', location.pathname + location.hash);
    if (!res) return null;
    const name = decodeURIComponent(res.headers.get('x-file-name') ?? 'shared.csv');
    return new File([await res.blob()], name);
  } catch {
    return null;
  }
}
