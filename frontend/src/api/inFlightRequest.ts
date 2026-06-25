export function createInFlightRequestDeduper() {
  const requests = new Map<string, Promise<unknown>>();

  return function dedupe<T>(key: string, request: () => Promise<T>): Promise<T> {
    const existing = requests.get(key);
    if (existing) return existing as Promise<T>;

    let pending: Promise<T>;
    try {
      pending = request();
    } catch (error) {
      return Promise.reject(error);
    }

    const tracked = pending.finally(() => {
      if (requests.get(key) === tracked) requests.delete(key);
    });
    requests.set(key, tracked);
    return tracked;
  };
}
