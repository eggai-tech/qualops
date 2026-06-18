import { z } from 'zod';

import {
  ARRAY_ROOT_WRAP_KEY,
  isArrayRootSchema,
  unwrapArrayRootResult,
  wrapArrayRootSchema,
} from '@/ai/shared/structured';

describe('isArrayRootSchema', () => {
  it('returns true for z.array()', () => {
    expect(isArrayRootSchema(z.array(z.string()))).toBe(true);
  });

  it('returns false for z.object()', () => {
    expect(isArrayRootSchema(z.object({ a: z.string() }))).toBe(false);
  });

  it('returns false for z.string()', () => {
    expect(isArrayRootSchema(z.string())).toBe(false);
  });
});

describe('wrapArrayRootSchema', () => {
  it('wraps a z.array() schema into { [ARRAY_ROOT_WRAP_KEY]: schema }', () => {
    const inner = z.array(z.string());
    const { schema, wrapped } = wrapArrayRootSchema(inner);
    expect(wrapped).toBe(true);
    expect(schema).toBeInstanceOf(z.ZodObject);
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    expect(shape[ARRAY_ROOT_WRAP_KEY]).toBe(inner);
  });

  it('returns the schema unchanged when it is already an object', () => {
    const obj = z.object({ x: z.number() });
    const { schema, wrapped } = wrapArrayRootSchema(obj);
    expect(wrapped).toBe(false);
    expect(schema).toBe(obj);
  });

  it('wrapped schema validates array payload correctly', () => {
    const { schema } = wrapArrayRootSchema(z.array(z.number()));
    const result = schema.safeParse({ [ARRAY_ROOT_WRAP_KEY]: [1, 2, 3] });
    expect(result.success).toBe(true);
  });
});

describe('unwrapArrayRootResult', () => {
  it('returns a bare array as-is', () => {
    expect(unwrapArrayRootResult([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('unwraps { items: [...] } to the inner array', () => {
    expect(unwrapArrayRootResult({ [ARRAY_ROOT_WRAP_KEY]: [1, 2] })).toEqual([1, 2]);
  });

  it('coerces a single object with no wrap key to a one-element array', () => {
    const obj = { foo: 'bar' };
    expect(unwrapArrayRootResult(obj)).toEqual([obj]);
  });

  it('returns value unchanged for null/primitive', () => {
    expect(unwrapArrayRootResult(null)).toBeNull();
    expect(unwrapArrayRootResult(42)).toBe(42);
  });

  it('returns { items: null } inner value (null, not coerced)', () => {
    // inner is null, not an array → falls through to return value as-is
    const val = { [ARRAY_ROOT_WRAP_KEY]: null };
    expect(unwrapArrayRootResult(val)).toEqual(val);
  });
});
