import type { Span, Tracer } from '@opentelemetry/api';

import { SENSITIVE_VALUE_PATTERN_SOURCE } from '../shared/utils/security';

// Full-string match: redact values that are entirely a credential (not substrings)
const SENSITIVE_VALUE_PATTERN = new RegExp(`^(${SENSITIVE_VALUE_PATTERN_SOURCE})$`);

export interface TokenUsageOptions {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

const SENSITIVE_KEYS = [
  'apikey',
  'api_key',
  'token',
  'password',
  'secret',
  'authorization',
  'auth',
  'credentials',
  'apitoken',
  'api_token',
  'accesstoken',
  'access_token',
];

export function sanitizeForObservability(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeForObservability(item));
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.some((sk) => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && SENSITIVE_VALUE_PATTERN.test(value)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeForObservability(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Sets the OTel standard model attribute on a span.
 * Langfuse uses this attribute to associate spans with a model in the UI —
 * it must be set for the Langfuse model filter to work.
 */
export function setModelAttribute(span: Span, model: string): void {
  span.setAttribute('gen_ai.request.model', model);
}

export function setTokenUsage(span: Span, opts: TokenUsageOptions): void {
  span.setAttribute('gen_ai.request.model', opts.model);
  if (opts.inputTokens !== undefined) {
    span.setAttribute('gen_ai.usage.input_tokens', opts.inputTokens);
  }
  if (opts.outputTokens !== undefined) {
    span.setAttribute('gen_ai.usage.output_tokens', opts.outputTokens);
  }
}

export async function withAISpan<T>(
  tracer: Tracer,
  name: string,
  model: string,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      setModelAttribute(span, model);
      const result = await fn();
      span.setAttribute(
        'langfuse.observation.output',
        JSON.stringify(sanitizeForObservability(result)),
      );
      return result;
    } finally {
      span.end();
    }
  });
}
