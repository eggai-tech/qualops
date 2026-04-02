import { z } from 'zod';

import { qualopsConfigSchema } from './config-schema';

export interface DeprecationWarning {
  path: string;
  description: string;
}

export interface ConfigValidationResult {
  deprecations: DeprecationWarning[];
}

/**
 * Validates raw config against the Zod schema.
 * Throws on schema violations (unknown fields, missing required, type errors).
 * Returns deprecation warnings for deprecated fields that are present.
 */
export function validateConfig(rawConfig: Record<string, unknown>): ConfigValidationResult {
  qualopsConfigSchema.parse(rawConfig);

  const deprecations = detectDeprecatedUsage(qualopsConfigSchema, rawConfig);
  return { deprecations };
}

/**
 * Walk the Zod schema's .shape, check .meta() for deprecated flags,
 * and collect paths where deprecated fields are present in the config.
 */
function detectDeprecatedUsage(
  schema: z.ZodObject<z.ZodRawShape>,
  config: Record<string, unknown>,
  prefix = '',
): DeprecationWarning[] {
  const warnings: DeprecationWarning[] = [];

  for (const [key, fieldSchema] of Object.entries(schema.shape)) {
    if (!(key in config) || config[key] === undefined) continue;

    const fullPath = prefix ? `${prefix}.${key}` : key;

    // Zod v4 shape entries are typed as $ZodType which doesn't expose .meta()
    // at the TS level, but it exists at runtime.
    const meta = (fieldSchema as any).meta?.();
    if (meta?.deprecated) {
      warnings.push({
        path: fullPath,
        description: (meta.description as string) ?? 'This field is deprecated.',
      });
    }

    const inner = unwrapToObject(fieldSchema as any);
    if (
      inner &&
      typeof config[key] === 'object' &&
      config[key] !== null &&
      !Array.isArray(config[key])
    ) {
      warnings.push(
        ...detectDeprecatedUsage(inner, config[key] as Record<string, unknown>, fullPath),
      );
    }
  }

  return warnings;
}

/**
 * Unwrap optional/meta wrappers to get the underlying ZodObject, if any.
 */
function unwrapToObject(schema: unknown): z.ZodObject<z.ZodRawShape> | null {
  let current: any = schema;

  // Unwrap meta/optional wrappers (they expose .unwrap())
  while (current && typeof current.unwrap === 'function') {
    current = current.unwrap();
  }

  if (current instanceof z.ZodObject) {
    return current;
  }

  return null;
}
