'use client';

/**
 * Checkout queue for when the API cannot be reached (§45).
 *
 * A pharmacy counter does not stop because the network did. A sale that could
 * not be sent is held here and replayed when the connection returns.
 *
 * Two things make this safe rather than reckless:
 *
 * - Every queued sale carries the idempotency key it was created with, so
 *   replaying one that actually did reach the server returns the original sale
 *   instead of creating a second.
 * - Nothing is presented as complete. A queued sale is shown as queued, on the
 *   till and in the count, until the server has confirmed it. Telling a cashier
 *   a sale succeeded when the server never saw it would be exactly the kind of
 *   fiction this system does not trade in — the stock has not moved, and the
 *   next customer may be sold the same pack.
 */

const KEY = 'pharmacore.pos.queue';

export interface QueuedSale {
  idempotencyKey: string;
  queuedAt: string;
  body: unknown;
  lastError?: string;
  attempts: number;
}

function read(): QueuedSale[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

function write(queue: QueuedSale[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // A full or disabled storage is not a reason to lose the sale in progress;
    // the caller still holds it in memory and will surface the failure.
  }
}

export const posQueue = {
  list: read,

  enqueue(idempotencyKey: string, body: unknown, error?: string): QueuedSale[] {
    const queue = read();
    if (queue.some((q) => q.idempotencyKey === idempotencyKey)) return queue;
    queue.push({
      idempotencyKey,
      queuedAt: new Date().toISOString(),
      body,
      lastError: error,
      attempts: 0,
    });
    write(queue);
    return queue;
  },

  remove(idempotencyKey: string): QueuedSale[] {
    const queue = read().filter((q) => q.idempotencyKey !== idempotencyKey);
    write(queue);
    return queue;
  },

  recordFailure(idempotencyKey: string, error: string): QueuedSale[] {
    const queue = read().map((q) =>
      q.idempotencyKey === idempotencyKey
        ? { ...q, attempts: q.attempts + 1, lastError: error }
        : q,
    );
    write(queue);
    return queue;
  },

  clear(): void {
    write([]);
  },
};
