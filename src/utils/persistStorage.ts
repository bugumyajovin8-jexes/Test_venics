// Ask the browser not to evict our storage (localStorage/IndexedDB) under storage
// pressure. Chrome reliably grants this to installed PWAs, which keeps the Supabase
// session and offline Dexie cache from being wiped. Best-effort: iOS Safari does
// NOT honor it (that platform relies on the HttpOnly session cookie instead).
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      if (!already) {
        const granted = await navigator.storage.persist();
        console.log(`[persist] persistent storage ${granted ? 'granted' : 'denied'}`);
      }
    }
  } catch {
    /* ignore */
  }
}
