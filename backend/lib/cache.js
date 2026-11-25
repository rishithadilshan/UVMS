// Tiny in-process TTL cache for read-mostly reference data (dropdown lookups).
// NEVER use it for booking availability, conflict checks or anything that authorises an action.
const store = new Map(); // key -> { value, exp } | { pending }

async function cached(key, ttlMs, loader) {
  const hit = store.get(key);
  if (hit && hit.value !== undefined && hit.exp > Date.now()) return hit.value;
  if (hit && hit.pending) return hit.pending;            // share one in-flight load
  const pending = loader().then((value) => { if (store.get(key)?.pending === pending) store.set(key, { value, exp: Date.now() + ttlMs }); return value; })
    .catch((e) => { if (store.get(key)?.pending === pending) store.delete(key); throw e; });
  store.set(key, { pending });
  return pending;
}
/** Drops every key that starts with prefix (call after any write that changes the cached data). */
const invalidate = (prefix = '') => { for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k); };

module.exports = { cached, invalidate };
