/** Shares short-lived reads; invalidation also detaches older in-flight reads. */
export function createExpiringRequestCache<T>({ ttlMs, now = Date.now }: {
  ttlMs: number;
  now?: () => number;
}) {
  type Entry = { pending?: Promise<T>; value?: { result: T; expiresAt: number } };
  const entries = new Map<string, Entry>();

  function peek(key: string): T | null {
    const entry = entries.get(key);
    if (!entry?.value) return null;
    if (entry.value.expiresAt <= now()) {
      entries.delete(key);
      return null;
    }
    return entry.value.result;
  }

  function get(key: string, load: () => Promise<T>, force = false): Promise<T> {
    const existing = entries.get(key);
    if (existing?.pending) return existing.pending;
    const fresh = peek(key);
    if (!force && fresh !== null) return Promise.resolve(fresh);
    // Drop expired currencies/days as well, keeping the cache memory bounded.
    for (const [otherKey, entry] of entries) {
      if (!entry.pending && entry.value && entry.value.expiresAt <= now()) entries.delete(otherKey);
    }
    const entry: Entry = {};
    entries.set(key, entry);
    let pending: Promise<T>;
    try { pending = Promise.resolve(load()); }
    catch (error) { pending = Promise.reject(error); }
    const tracked = pending.then(result => {
      if (entries.get(key) === entry) entry.value = { result, expiresAt: now() + ttlMs };
      return result;
    }, error => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    }).finally(() => { entry.pending = undefined; });
    entry.pending = tracked;
    return tracked;
  }

  return { get, peek, invalidate: () => entries.clear() };
}
