import { minimatch } from 'minimatch';

export function shouldProcessFile(filePath: string, skipPatterns: string[] = []): boolean {
  return !skipPatterns.some((pattern) => minimatch(filePath, pattern, { dot: true }));
}

export function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  return batches;
}
