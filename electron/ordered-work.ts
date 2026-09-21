/** Bound model requests while committing only a contiguous, resumable prefix. */
export async function orderedWork<T>(
  start: number,
  end: number,
  concurrency: number,
  work: (index: number) => Promise<T>,
  commit: (result: T) => void,
) {
  let next = start,
    saved = start,
    failure: unknown,
    failed = false;
  const ready = new Map<number, T>();
  const worker = async () => {
    while (!failed && next < end) {
      const index = next++;
      try {
        ready.set(index, await work(index));
        while (ready.has(saved)) {
          commit(ready.get(saved)!);
          ready.delete(saved++);
        }
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  };
  // Wait for in-flight requests before returning failure or allowing a retry.
  await Promise.all(
    Array.from({ length: Math.min(concurrency, end - start) }, worker),
  );
  if (failed) throw failure;
}
