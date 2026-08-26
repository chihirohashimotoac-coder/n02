/**
 * Releases the cache created by n02's previous hand-written service worker.
 *
 * That worker owned a cache named "n02-github-pages-v1" and precached the old hashed bundles. The
 * current build ships a Workbox-generated worker at the same ./sw.js URL, so the browser replaces
 * the old worker automatically - but Workbox's own cleanupOutdatedCaches only prunes Workbox
 * precaches, leaving the legacy one orphaned on disk forever. Deleting it here keeps upgrading
 * users from carrying a dead copy of the old app around.
 */
const LEGACY_CACHE = 'n02-github-pages-v1';

export async function purgeLegacyCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    if (await caches.has(LEGACY_CACHE)) await caches.delete(LEGACY_CACHE);
  } catch {
    // Cache access can be blocked (private mode, storage policy); the app works regardless.
  }
}
