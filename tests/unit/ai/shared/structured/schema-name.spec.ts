import { z } from 'zod';

import { resolveSchemaName } from '@/ai/shared/structured';

describe('resolveSchemaName', () => {
  it('returns the explicit override when provided', () => {
    const s = z.object({ a: z.string() });
    expect(resolveSchemaName(s, 'explicit_name')).toBe('explicit_name');
  });

  it('reads schema.meta({ id }) when no override', () => {
    const s = z.object({ a: z.string() }).meta({ id: 'meta_name' });
    expect(resolveSchemaName(s)).toBe('meta_name');
  });

  it('prefers override even if meta id is set', () => {
    const s = z.object({ a: z.string() }).meta({ id: 'meta_name' });
    expect(resolveSchemaName(s, 'override_wins')).toBe('override_wins');
  });

  it('falls back to "schema" when no meta id and no override', () => {
    const s = z.object({ a: z.string() });
    expect(resolveSchemaName(s)).toBe('schema');
  });

  it('falls back to "schema" when meta is set but id is missing', () => {
    const s = z.object({ a: z.string() }).meta({ title: 'Title only' });
    expect(resolveSchemaName(s)).toBe('schema');
  });

  it('falls back to "schema" when meta id is empty string', () => {
    const s = z.object({ a: z.string() }).meta({ id: '' });
    expect(resolveSchemaName(s)).toBe('schema');
  });
});
