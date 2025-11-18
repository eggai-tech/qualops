import { createBatches, shouldProcessFile } from './filters';

describe('shouldProcessFile', () => {
  it('should skip TypeScript declaration files', () => {
    expect(shouldProcessFile('types.d.ts')).toBe(false);
    expect(shouldProcessFile('src/models/user.d.ts')).toBe(false);
    expect(shouldProcessFile('path/to/file.d.ts')).toBe(false);
  });

  it('should skip spec test files', () => {
    expect(shouldProcessFile('component.spec.ts')).toBe(false);
    expect(shouldProcessFile('src/utils/helper.spec.ts')).toBe(false);
    expect(shouldProcessFile('test/unit/service.spec.ts')).toBe(false);
  });

  it('should skip test files', () => {
    expect(shouldProcessFile('component.test.ts')).toBe(false);
    expect(shouldProcessFile('src/utils/helper.test.ts')).toBe(false);
    expect(shouldProcessFile('test/integration/api.test.ts')).toBe(false);
  });

  it('should skip config files', () => {
    expect(shouldProcessFile('jest.config.js')).toBe(false);
    expect(shouldProcessFile('webpack.config.ts')).toBe(false);
    expect(shouldProcessFile('src/app.config.js')).toBe(false);
    expect(shouldProcessFile('path/to/babel.config.ts')).toBe(false);
  });

  it('should skip mock files', () => {
    expect(shouldProcessFile('service.mock.ts')).toBe(false);
    expect(shouldProcessFile('src/api/client.mock.ts')).toBe(false);
    expect(shouldProcessFile('test/mocks/data.mock.ts')).toBe(false);
  });

  it('should process regular TypeScript files', () => {
    expect(shouldProcessFile('component.ts')).toBe(true);
    expect(shouldProcessFile('src/utils/helper.ts')).toBe(true);
    expect(shouldProcessFile('services/auth.ts')).toBe(true);
  });

  it('should process TypeScript React files', () => {
    expect(shouldProcessFile('Component.tsx')).toBe(true);
    expect(shouldProcessFile('src/components/Button.tsx')).toBe(true);
  });

  it('should process JavaScript files', () => {
    expect(shouldProcessFile('script.js')).toBe(true);
    expect(shouldProcessFile('src/legacy/old.js')).toBe(true);
  });

  it('should process files with non-matching extensions', () => {
    expect(shouldProcessFile('file.tsx')).toBe(true);
    expect(shouldProcessFile('file.jsx')).toBe(true);
  });

  it('should handle empty filename', () => {
    expect(shouldProcessFile('')).toBe(true);
  });

  it('should handle paths with no extension', () => {
    expect(shouldProcessFile('README')).toBe(true);
    expect(shouldProcessFile('src/types')).toBe(true);
  });

  it('should handle Windows-style paths', () => {
    expect(shouldProcessFile('C:\\project\\file.spec.ts')).toBe(false);
    expect(shouldProcessFile('C:\\project\\file.ts')).toBe(true);
  });

  it('should handle relative paths', () => {
    expect(shouldProcessFile('./file.spec.ts')).toBe(false);
    expect(shouldProcessFile('../utils/helper.ts')).toBe(true);
  });

  it('should be case sensitive', () => {
    expect(shouldProcessFile('file.SPEC.TS')).toBe(true);
    expect(shouldProcessFile('file.D.TS')).toBe(true);
    expect(shouldProcessFile('file.spec.ts')).toBe(false);
    expect(shouldProcessFile('file.d.ts')).toBe(false);
  });

  it('should handle files with multiple dots', () => {
    expect(shouldProcessFile('file.component.spec.ts')).toBe(false);
    expect(shouldProcessFile('file.service.test.ts')).toBe(false);
    expect(shouldProcessFile('file.types.d.ts')).toBe(false);
    expect(shouldProcessFile('app.config.js')).toBe(false);
    expect(shouldProcessFile('file.component.ts')).toBe(true);
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
