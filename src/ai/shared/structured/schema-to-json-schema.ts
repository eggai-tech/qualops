import { z } from 'zod';

export interface SchemaToJsonOptions {
  target?: 'draft-2020-12' | 'draft-7';
  /**
   * When true, validate the result against OpenAI's strict JSON Schema dialect:
   * root must be object, all properties required, additionalProperties:false on every object,
   * no oneOf, no numeric/length constraints, no $ref to external schemas.
   * Throws on incompatibility instead of silently mutating.
   */
  enforceStrictDialect?: boolean;
  /**
   * When true, strip numeric and string constraints (minimum, maximum, multipleOf,
   * minLength, maxLength) that are not supported by Anthropic's structured output
   * constrained decoding (output_config.format / --json-schema).
   */
  stripUnsupportedConstraints?: boolean;
}

// Constraint keys not supported by Anthropic's structured output constrained decoding.
const UNSUPPORTED_CONSTRAINT_KEYS = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
]);

function stripConstraints(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(stripConstraints);
  const obj = node as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([k]) => !UNSUPPORTED_CONSTRAINT_KEYS.has(k))
      .map(([k, v]) => [k, stripConstraints(v)]),
  );
}

export function schemaToJsonSchema<S extends z.ZodType>(
  schema: S,
  options: SchemaToJsonOptions = {},
): Record<string, unknown> {
  const {
    target = 'draft-2020-12',
    enforceStrictDialect = false,
    stripUnsupportedConstraints = false,
  } = options;
  let json = z.toJSONSchema(schema, { target }) as Record<string, unknown>;
  if (stripUnsupportedConstraints) {
    json = stripConstraints(json) as Record<string, unknown>;
  }
  if (enforceStrictDialect) {
    validateStrictDialect(json, '$');
  }
  return json;
}

function validateStrictDialect(json: unknown, path: string): void {
  if (json == null || typeof json !== 'object') return;
  const node = json as Record<string, unknown>;

  if (node.type === 'object') {
    if (node.additionalProperties !== false) {
      throw new Error(`[${path}] strict dialect requires additionalProperties:false`);
    }
    const props = node.properties as Record<string, unknown> | undefined;
    const required = node.required as string[] | undefined;
    const propKeys = props ? Object.keys(props) : [];
    const requiredKeys = required ?? [];
    const missing = propKeys.filter((k) => !requiredKeys.includes(k));
    if (missing.length > 0) {
      throw new Error(
        `[${path}] strict dialect requires every property to be in 'required' (missing: ${missing.join(', ')})`,
      );
    }
  }

  if ('oneOf' in node) {
    throw new Error(`[${path}] strict dialect does not support oneOf — use anyOf or enum`);
  }

  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      value.forEach((item, idx) => validateStrictDialect(item, `${path}.${key}[${idx}]`));
    } else if (typeof value === 'object') {
      validateStrictDialect(value, `${path}.${key}`);
    }
  }
}
