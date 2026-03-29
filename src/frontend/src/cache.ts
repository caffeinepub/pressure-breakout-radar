interface CacheEntry {
  data: unknown;
  timestamp: number;
  ttlMs: number;
}

const memoryCache = new Map<string, CacheEntry>();
const STORAGE_PREFIX = "pbr_";

export function getCache<T>(key: string): T | null {
  const memEntry = memoryCache.get(key);
  if (memEntry) {
    if (Date.now() - memEntry.timestamp < memEntry.ttlMs) {
      return memEntry.data as T;
    }
    memoryCache.delete(key);
  }

  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + key);
    if (stored) {
      const entry = JSON.parse(stored) as CacheEntry;
      if (Date.now() - entry.timestamp < entry.ttlMs) {
        memoryCache.set(key, entry);
        return entry.data as T;
      }
      localStorage.removeItem(STORAGE_PREFIX + key);
    }
  } catch {
    // localStorage may be unavailable
  }

  return null;
}

export function setCache<T>(key: string, data: T, ttlMs: number): void {
  const entry: CacheEntry = { data, timestamp: Date.now(), ttlMs };
  memoryCache.set(key, entry);
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // ignore storage errors
  }
}

export const TTL = {
  universe: 12 * 60 * 60 * 1000,
  top10Snapshot: 90 * 1000,
  top10Live: 10 * 1000,
  candles1m: 4 * 60 * 1000,
  candles5m: 18 * 60 * 1000,
  pressureSnapshot: 8 * 1000,
  vacuumZones: 15 * 1000,
} as const;
