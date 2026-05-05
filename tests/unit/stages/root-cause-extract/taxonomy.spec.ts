import { getRootCauseByKey, getRootCauseKeys } from '@/stages/root-cause-extract/taxonomy';

describe('taxonomy', () => {
  it('getRootCauseKeys returns a non-empty array of strings', () => {
    const keys = getRootCauseKeys();
    expect(Array.isArray(keys)).toBe(true);
    expect(keys.length).toBeGreaterThan(0);
    keys.forEach((k) => expect(typeof k).toBe('string'));
  });

  it('getRootCauseByKey returns the matching entry', () => {
    const keys = getRootCauseKeys();
    const first = getRootCauseByKey(keys[0]);
    expect(first).toBeDefined();
    expect(first?.key).toBe(keys[0]);
  });

  it('getRootCauseByKey returns undefined for an unknown key', () => {
    expect(getRootCauseByKey('__nonexistent__')).toBeUndefined();
  });
});
