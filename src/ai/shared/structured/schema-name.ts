import type { z } from 'zod';

/**
 * Resolve a name for the given zod schema. Used by providers as the identifier on
 * `response_format.json_schema.name` (OpenAI) and `tools[].name` (tool_use dialect).
 *
 * Resolution order:
 *   1. Explicit `override` from the call site
 *   2. `schema.meta({ id })` if the schema defined one (rare — only useful for observability)
 *   3. Default `'schema'` — has no impact on generation quality. The model receives the schema
 *      shape and field descriptions, not the name; for forced tool_use the name is just a routing key.
 */
export function resolveSchemaName(schema: z.ZodType, override?: string): string {
  if (override) return override;
  const id = schema.meta?.()?.id;
  if (typeof id === 'string' && id.length > 0) return id;
  return 'schema';
}
