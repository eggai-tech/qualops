import type { z } from 'zod';

import { escapeUnescapedControlChars, extractJsonText } from './extract-json';

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    public readonly raw: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StructuredOutputError';
  }
}

/**
 * Parse a raw model response into a typed object validated by the given zod schema.
 * Used both as the post-validation step on native structured-output paths and as the
 * primary parser on the prompt-fallback path.
 */
export function parseAndValidate<S extends z.ZodType>(raw: string, schema: S): z.infer<S> {
  const extracted = extractJsonText(raw);
  if (!extracted) {
    throw new StructuredOutputError('No JSON value found in model response', raw);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.text);
  } catch {
    try {
      parsed = JSON.parse(escapeUnescapedControlChars(extracted.text));
    } catch (secondError) {
      throw new StructuredOutputError(
        `Failed to parse JSON: ${(secondError as Error).message}`,
        raw,
        secondError,
      );
    }
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new StructuredOutputError(
      `Schema validation failed: ${result.error.message}`,
      raw,
      result.error,
    );
  }
  return result.data;
}
