/** How many files convert and upload at once. */
export const UPLOAD_POOL_SIZE = 3;

/** Run later steps only after earlier claims, so duplicate checks do not race. */
export function createGate(): <T>(fn: () => T | Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/** A batch that can grow while earlier files are still converting or uploading. */
export function createUploadQueue<T>(task: (item: T) => Promise<void>): {
  append(next: T[]): void;
  drained(): Promise<void>;
  isIdle(): boolean;
} {
  const items: T[] = [];
  let cursor = 0;
  let active = 0;
  let drainPromise: Promise<void> | null = null;
  let drainResolve: (() => void) | null = null;

  function arm(): void {
    if (!drainPromise) {
      drainPromise = new Promise((resolve) => {
        drainResolve = resolve;
      });
    }
  }

  function check(): void {
    if (active === 0 && cursor >= items.length && drainResolve) {
      const resolve = drainResolve;
      drainResolve = null;
      drainPromise = null;
      resolve();
    }
  }

  function pump(): void {
    arm();
    while (active < UPLOAD_POOL_SIZE && cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      active += 1;
      void task(item).finally(() => {
        active -= 1;
        pump();
        check();
      });
    }
    check();
  }

  return {
    append(next) {
      if (!next.length) return;
      items.push(...next);
      pump();
    },
    drained() {
      arm();
      const pending = drainPromise ?? Promise.resolve();
      check();
      return pending;
    },
    isIdle() {
      return active === 0 && cursor >= items.length;
    },
  };
}

/** Keep UPLOAD_POOL_SIZE files in flight. The next file starts when one finishes. */
export async function runUploadPool(count: number, task: (index: number) => Promise<void>): Promise<void> {
  const width = Math.min(UPLOAD_POOL_SIZE, count);
  if (width < 1) return;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (cursor < count) {
        const index = cursor;
        cursor += 1;
        await task(index);
      }
    }),
  );
}
