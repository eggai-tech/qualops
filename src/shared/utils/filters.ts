const SKIP_PATTERNS = [
  /\.d\.ts$/,
  /\.spec\.ts$/,
  /\.test\.ts$/,
  /\.config\.[jt]s$/,
  /\.mock\.ts$/,
  /tools\/qualops\//,
] as const;
export function shouldProcessFile(filePath: string): boolean {
  return !SKIP_PATTERNS.some((pattern) => pattern.test(filePath));
}
export function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  return batches;
}
