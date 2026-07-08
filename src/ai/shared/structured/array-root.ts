import { z } from 'zod';

/**
 * The property name used to wrap an array-root schema into an object.
 * OpenAI's structured-output dialects (json_schema strict and, in practice,
 * json_object with schema guidance) require the root schema to be an object —
 * a top-level array is rejected with "Root schema must have type: 'object'".
 * Several qualops review schemas are array-rooted (review issues, validation
 * results, root-cause classifications, dedup indices), so we transparently wrap
 * them in `{ <WRAP_KEY>: [...] }` for the request and unwrap the parsed payload.
 */
export const ARRAY_ROOT_WRAP_KEY = 'items';

/** True when the schema's JSON-Schema root is an array (and therefore needs wrapping). */
export function isArrayRootSchema(schema: z.ZodType): boolean {
  // z.ZodArray is the only zod type that serializes to a root `type: "array"`.
  return schema instanceof z.ZodArray;
}

/**
 * If `schema` is array-rooted, return an object schema `{ items: schema }` so it can
 * be sent to a provider that requires an object root. Otherwise return the schema
 * unchanged. `wrapped` tells the caller whether to unwrap the response.
 */
export function wrapArrayRootSchema<S extends z.ZodType>(
  schema: S,
): { schema: z.ZodType; wrapped: boolean } {
  if (isArrayRootSchema(schema)) {
    return { schema: z.object({ [ARRAY_ROOT_WRAP_KEY]: schema }), wrapped: true };
  }
  return { schema, wrapped: false };
}

/**
 * Unwrap a parsed payload produced against a wrapped array-root schema. Tolerant of
 * shape drift: accepts the wrapper object `{ items: [...] }`, a bare array, or a
 * single object (coerced to a one-element array) so a stray shape is not silently
 * dropped to an empty result.
 */
export function unwrapArrayRootResult(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const wrapper = value as Record<string, unknown>;
    const inner = wrapper[ARRAY_ROOT_WRAP_KEY];
    if (Array.isArray(inner)) return inner;
    // A single object that looks like one item rather than the wrapper.
    if (!(ARRAY_ROOT_WRAP_KEY in wrapper)) return [value];
  }
  return value;
}
