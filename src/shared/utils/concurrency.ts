import { logger } from './logger.ts';

export async function processConcurrently<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return Promise.resolve([]);
  }

  const results: (R | null)[] = new Array(items.length).fill(null);
  let currentIndex = 0;
  let activeCount = 0;

  return new Promise((resolve) => {
    const processNext = () => {
      if (currentIndex >= items.length) {
        if (activeCount === 0) {
          resolve(results.filter((r): r is R => r !== null));
        }
        return;
      }

      const index = currentIndex++;
      activeCount++;

      processor(items[index], index)
        .then((result) => {
          results[index] = result;
          activeCount--;
          processNext();
        })
        .catch((error) => {
          logger.error(`Task ${index + 1}/${items.length} failed: ${error.message}`);
          activeCount--;
          processNext();
        });
    };

    for (let i = 0; i < Math.min(concurrency, items.length); i++) {
      processNext();
    }
  });
}
