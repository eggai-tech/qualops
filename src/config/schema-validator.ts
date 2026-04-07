import { z } from 'zod';

import { qualopsConfigSchema } from './config-schema';

export interface DeprecationWarning {
  path: string;
  description: string;
}

export interface UnknownFieldWarning {
  path: string;
  field: string;
}

export interface ConfigValidationResult {
  deprecations: DeprecationWarning[];
  unknownFields: UnknownFieldWarning[];
}

/**
 * Stable, machine-readable code for matching this error type without
 * parsing the human-readable message.
 */
export const CONFIG_VALIDATION_ERROR_CODE = 'CONFIG_VALIDATION_ERROR' as const;

export class ConfigValidationError extends Error {
  readonly errorCode = CONFIG_VALIDATION_ERROR_CODE;
  /** Marks this error as ready for direct user display (no stack trace needed). */
  readonly userFacing = true;

  constructor(public readonly issues: z.core.$ZodIssue[]) {
    super(formatIssues(issues));
    this.name = 'ConfigValidationError';
  }
}

/**
 * Throws `ConfigValidationError` if the raw config violates the Zod schema
 * (unknown fields, missing required, type errors). Pure assertion — no
 * return value.
 */
export function assertValidConfig(rawConfig: Record<string, unknown>): void {
  const result = qualopsConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues);
  }
}

/**
 * Walks the schema and config to collect non-fatal warnings:
 * - deprecation warnings for fields tagged with `.meta({ deprecated: true })`
 * - unknown-field warnings for keys inside `.passthrough()` objects (where
 *   typos would otherwise be silently accepted)
 *
 * Pure: never throws. Assumes the config has already been validated by
 * `assertValidConfig`.
 */
export function collectConfigWarnings(rawConfig: Record<string, unknown>): ConfigValidationResult {
  const deprecations: DeprecationWarning[] = [];
  const unknownFields: UnknownFieldWarning[] = [];

  walkSchemaWithConfig(qualopsConfigSchema, rawConfig, ({ schema, config, path, fieldPath }) => {
    if (fieldPath) {
      // Per-field visit: check for deprecated metadata on the field schema.
      const meta = readMeta(fieldPath.fieldSchema);
      if (meta?.deprecated) {
        const description =
          typeof meta.description === 'string' ? meta.description : 'This field is deprecated.';
        deprecations.push({ path: fieldPath.path, description });
      }
      return;
    }

    // Per-object visit: check for unknown keys inside passthrough objects.
    if (isPassthroughObject(schema)) {
      const declared = new Set(Object.keys(schema.shape));
      for (const key of Object.keys(config)) {
        if (!declared.has(key)) {
          unknownFields.push({ path: path || '<root>', field: key });
        }
      }
    }
  });

  return { deprecations, unknownFields };
}

function formatIssues(issues: z.core.$ZodIssue[]): string {
  const lines = issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `  - ${path}: ${issue.message}`;
  });
  return `Invalid .qualopsrc.json configuration:\n${lines.join('\n')}`;
}

// --- Zod runtime escape hatch ---
//
// Zod v4 types `.shape` entries as `$ZodType` which doesn't expose `.meta()`,
// `.unwrap()`, etc. at the TS level even though they exist at runtime. This
// interface is the single, named place where we trade type-checking for
// runtime introspection — easier to audit/replace than scattered `as any`s.

interface ZodRuntime {
  meta?: () => Record<string, unknown> | undefined;
  unwrap?: () => unknown;
}

function asRuntime(schema: unknown): ZodRuntime {
  return schema as ZodRuntime;
}

function readMeta(schema: unknown): Record<string, unknown> | undefined {
  return asRuntime(schema).meta?.();
}

/**
 * Unwrap optional/meta wrappers to get the underlying ZodObject, if any.
 */
function unwrapToObject(schema: unknown): z.ZodObject<z.ZodRawShape> | null {
  let current: unknown = schema;

  while (asRuntime(current).unwrap) {
    current = asRuntime(current).unwrap!();
  }

  if (current instanceof z.ZodObject) {
    return current;
  }

  return null;
}

/**
 * True if the object schema was created with `.passthrough()`. Detected via
 * the `passthrough: true` meta tag declared at the schema definition site
 * (see `aiStageConfigSchema` in `config-schema.ts`). This avoids depending
 * on Zod internal layout (`def.catchall`).
 */
function isPassthroughObject(schema: z.ZodObject<z.ZodRawShape>): boolean {
  return readMeta(schema)?.passthrough === true;
}

interface WalkVisitorArgs {
  schema: z.ZodObject<z.ZodRawShape>;
  config: Record<string, unknown>;
  path: string;
  /** Set when called for a specific field within `schema`; undefined for the root visit. */
  fieldPath?: {
    path: string;
    fieldSchema: unknown;
  };
}

/**
 * Walks a schema/config tree depth-first. The visitor is called once for the
 * root object, then once per field in each nested object. Recursion only
 * descends into nested ZodObjects whose value in the config is also an
 * object (not array, not null).
 */
function walkSchemaWithConfig(
  schema: z.ZodObject<z.ZodRawShape>,
  config: Record<string, unknown>,
  visit: (args: WalkVisitorArgs) => void,
  prefix = '',
): void {
  // Visit the object itself (no fieldPath — used for object-level checks
  // like passthrough detection).
  visit({ schema, config, path: prefix });

  for (const [key, fieldSchema] of Object.entries(schema.shape)) {
    if (!(key in config) || config[key] === undefined) continue;

    const fullPath = prefix ? `${prefix}.${key}` : key;

    // Visit the field (used for field-level checks like deprecation).
    visit({
      schema,
      config,
      path: prefix,
      fieldPath: { path: fullPath, fieldSchema },
    });

    const value = config[key];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;

    const inner = unwrapToObject(fieldSchema);
    if (!inner) continue;

    walkSchemaWithConfig(inner, value as Record<string, unknown>, visit, fullPath);
  }
}
