import { createBatches, shouldProcessFile } from '@/shared/utils/filters';

describe('shouldProcessFile', () => {
  it('should allow all files when no skipPatterns', () => {
    expect(shouldProcessFile('types.d.ts')).toBe(true);
    expect(shouldProcessFile('component.spec.ts')).toBe(true);
    expect(shouldProcessFile('src/app.ts')).toBe(true);
  });

  it('should skip files matching skipPatterns', () => {
    const patterns = ['**/*.d.ts', '**/*.spec.ts', '**/*.test.ts', '**/*.mock.ts'];
    expect(shouldProcessFile('types.d.ts', patterns)).toBe(false);
    expect(shouldProcessFile('src/models/user.d.ts', patterns)).toBe(false);
    expect(shouldProcessFile('component.spec.ts', patterns)).toBe(false);
    expect(shouldProcessFile('component.test.ts', patterns)).toBe(false);
    expect(shouldProcessFile('service.mock.ts', patterns)).toBe(false);
  });

  it('should allow files not matching skipPatterns', () => {
    const patterns = ['**/*.d.ts', '**/*.spec.ts', '**/*.test.ts'];
    expect(shouldProcessFile('component.ts', patterns)).toBe(true);
    expect(shouldProcessFile('src/utils/helper.ts', patterns)).toBe(true);
    expect(shouldProcessFile('Component.tsx', patterns)).toBe(true);
    expect(shouldProcessFile('script.js', patterns)).toBe(true);
  });

  it('should skip node_modules when pattern is configured', () => {
    const patterns = ['node_modules/**'];
    expect(shouldProcessFile('node_modules/lib/index.js', patterns)).toBe(false);
    expect(shouldProcessFile('node_modules/@types/node/index.ts', patterns)).toBe(false);
    expect(shouldProcessFile('src/app.ts', patterns)).toBe(true);
  });

  it('should handle dot files with dot: true', () => {
    const patterns = ['.git/**'];
    expect(shouldProcessFile('.git/config', patterns)).toBe(false);
    expect(shouldProcessFile('src/app.ts', patterns)).toBe(true);
  });

  it('should be case sensitive', () => {
    const patterns = ['**/*.spec.ts'];
    expect(shouldProcessFile('file.SPEC.TS', patterns)).toBe(true);
    expect(shouldProcessFile('file.spec.ts', patterns)).toBe(false);
  });

  it('should handle files with multiple dots', () => {
    const patterns = ['**/*.spec.ts', '**/*.test.ts', '**/*.d.ts'];
    expect(shouldProcessFile('file.component.spec.ts', patterns)).toBe(false);
    expect(shouldProcessFile('file.service.test.ts', patterns)).toBe(false);
    expect(shouldProcessFile('file.types.d.ts', patterns)).toBe(false);
    expect(shouldProcessFile('file.component.ts', patterns)).toBe(true);
  });

  it('should handle empty filename', () => {
    expect(shouldProcessFile('')).toBe(true);
    expect(shouldProcessFile('', ['**/*.ts'])).toBe(true);
  });
});

describe('createBatches', () => {
  it('should create single batch when items less than batch size', () => {
    const items = [1, 2, 3];
    const batches = createBatches(items, 5);

    expect(batches).toEqual([[1, 2, 3]]);
  });

  it('should create single batch when items equal batch size', () => {
    const items = [1, 2, 3, 4, 5];
    const batches = createBatches(items, 5);

    expect(batches).toEqual([[1, 2, 3, 4, 5]]);
  });

  it('should create multiple equal batches', () => {
    const items = [1, 2, 3, 4, 5, 6];
    const batches = createBatches(items, 3);

    expect(batches).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('should handle uneven batches', () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    const batches = createBatches(items, 3);

    expect(batches).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it('should create batch of size 1', () => {
    const items = [1, 2, 3];
    const batches = createBatches(items, 1);

    expect(batches).toEqual([[1], [2], [3]]);
  });

  it('should handle empty array', () => {
    const batches = createBatches([], 5);

    expect(batches).toEqual([]);
  });

  it('should handle single item', () => {
    const items = [1];
    const batches = createBatches(items, 5);

    expect(batches).toEqual([[1]]);
  });

  it('should work with string arrays', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const batches = createBatches(items, 2);

    expect(batches).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('should work with object arrays', () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const batches = createBatches(items, 3);

    expect(batches).toEqual([[{ id: 1 }, { id: 2 }, { id: 3 }], [{ id: 4 }]]);
  });

  it('should not mutate original array', () => {
    const items = [1, 2, 3, 4, 5];
    const originalItems = [...items];

    createBatches(items, 2);

    expect(items).toEqual(originalItems);
  });

  it('should create independent batch arrays', () => {
    const items = [1, 2, 3, 4];
    const batches = createBatches(items, 2);

    batches[0][0] = 99;

    expect(items[0]).toBe(1);
  });

  it('should handle large batch sizes', () => {
    const items = [1, 2, 3];
    const batches = createBatches(items, 1000);

    expect(batches).toEqual([[1, 2, 3]]);
  });

  it('should handle many small batches', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const batches = createBatches(items, 10);

    expect(batches).toHaveLength(10);
    expect(batches[0]).toHaveLength(10);
    expect(batches[9]).toHaveLength(10);
  });

  it('should preserve item order', () => {
    const items = [5, 4, 3, 2, 1];
    const batches = createBatches(items, 2);

    expect(batches).toEqual([[5, 4], [3, 2], [1]]);
  });

  it('should handle mixed type arrays', () => {
    const items: (string | number)[] = ['a', 1, 'b', 2];
    const batches = createBatches(items, 2);

    expect(batches).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });
});
