import { SpanStatusCode } from '@opentelemetry/api';
import type { Span, Tracer } from '@opentelemetry/api';

import { redactTokens } from '../shared/utils/security';

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
    } else if (typeof value === 'string') {
      sanitized[key] = redactTokens(value);
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
/**
 * Records an error on a span: calls recordException and sets ERROR status.
 * Call this in a catch block before re-throwing; end the span in finally.
 */
export function recordSpanError(span: Span, error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  span.recordException(err);
  span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
}

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
