import { Injectable, Logger } from '@nestjs/common';

interface Entry<T> {
  value: T;
  expiresAt: number;
  computedAt: number;
}

/**
 * Small in-process cache for expensive read-only analytics (§67).
 *
 * Deliberately NOT used for anything that touches stock. A cached balance is a
 * wrong balance, and §48 requires every stock decision to read live state under
 * a lock. This only covers dashboards and classifications, where a figure that
 * is a minute old is fine and recomputing it on every page load is not.
 *
 * Single-process by design: a Redis-backed shared cache would be the next step
 * for a multi-instance deployment, and the interface here is what it would
 * implement.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly store = new Map<string, Entry<unknown>>();
  private hits = 0;
  private misses = 0;

  /** Entries are small; a hard cap stops an unbounded key space growing. */
  private readonly maxEntries = 500;

  async wrap<T>(key: string, ttlSeconds: number, produce: () => Promise<T>): Promise<T> {
    const existing = this.store.get(key) as Entry<T> | undefined;
    if (existing && existing.expiresAt > Date.now()) {
      this.hits += 1;
      return existing.value;
    }

    this.misses += 1;
    const value = await produce();

    if (this.store.size >= this.maxEntries) {
      // Evict the oldest entry rather than growing without bound.
      const oldest = [...this.store.entries()].sort(
        (a, b) => a[1].computedAt - b[1].computedAt,
      )[0];
      if (oldest) this.store.delete(oldest[0]);
    }

    this.store.set(key, {
      value,
      computedAt: Date.now(),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return value;
  }

  /** Drop everything matching a prefix, e.g. after a stock movement. */
  invalidate(prefix: string): number {
    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.store.clear();
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      entries: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? Math.round((this.hits / total) * 100) : null,
    };
  }
}
