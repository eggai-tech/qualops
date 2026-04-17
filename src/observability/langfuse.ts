import type { Span } from '@opentelemetry/api';

import type { PRMetadata } from './pr-metadata';
import { sanitizeForObservability, setModelAttribute } from './span-attributes';

// Single source of truth for all Langfuse-specific attribute key strings.
// Replace this file (and update callers) when swapping observability backends.
const LANGFUSE_KEYS = {
  traceName: 'langfuse.trace.name',
  traceTags: 'langfuse.trace.tags',
  traceInput: 'langfuse.trace.input',
  traceOutput: 'langfuse.trace.output',
  obsInput: 'langfuse.observation.input',
  obsOutput: 'langfuse.observation.output',
  traceMetaPrefix: 'langfuse.trace.metadata.',
} as const;

export interface TraceAttributeOptions {
  sessionId: string;
  traceName: string;
  model?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function setTraceAttributes(span: Span, opts: TraceAttributeOptions): void {
  span.setAttribute('session.id', opts.sessionId);
  span.setAttribute(LANGFUSE_KEYS.traceName, opts.traceName);
  if (opts.model) {
    setModelAttribute(span, opts.model);
  }
  if (opts.tags) {
    span.setAttribute(LANGFUSE_KEYS.traceTags, opts.tags);
  }
  if (opts.metadata) {
    const sanitized = sanitizeForObservability(opts.metadata) as Record<string, unknown>;
    for (const [key, value] of Object.entries(sanitized)) {
      if (value !== undefined && value !== null) {
        span.setAttribute(`${LANGFUSE_KEYS.traceMetaPrefix}${key}`, String(value));
      }
    }
  }
}

export function setTraceMetadataFromPR(
  span: Span,
  prMeta: PRMetadata,
  sessionName: string,
  model?: string,
  tags?: string[],
): void {
  setTraceAttributes(span, {
    sessionId: prMeta.sessionId,
    traceName: 'qualops/run',
    model,
    tags,
    metadata: {
      ...prMeta,
      sessionName,
    },
  });
}

export function setObservationIO(span: Span, opts: { input?: unknown; output?: unknown }): void {
  if (opts.input !== undefined) {
    span.setAttribute(LANGFUSE_KEYS.obsInput, JSON.stringify(sanitizeForObservability(opts.input)));
  }
  if (opts.output !== undefined) {
    span.setAttribute(
      LANGFUSE_KEYS.obsOutput,
      JSON.stringify(sanitizeForObservability(opts.output)),
    );
  }
}

export function setTraceIO(span: Span, opts: { input?: unknown; output?: unknown }): void {
  if (opts.input !== undefined) {
    span.setAttribute(
      LANGFUSE_KEYS.traceInput,
      JSON.stringify(sanitizeForObservability(opts.input)),
    );
  }
  if (opts.output !== undefined) {
    span.setAttribute(
      LANGFUSE_KEYS.traceOutput,
      JSON.stringify(sanitizeForObservability(opts.output)),
    );
  }
}

export function setAgenticSpanAttributes(
  span: Span,
  opts: { model: string; jobName: string; config: unknown },
): void {
  setModelAttribute(span, opts.model);
  span.setAttribute(`${LANGFUSE_KEYS.traceMetaPrefix}agenticJob`, opts.jobName);
  span.setAttribute(
    `${LANGFUSE_KEYS.traceMetaPrefix}agenticConfig`,
    JSON.stringify(sanitizeForObservability(opts.config)),
  );
}

export function setAgenticTurns(span: Span, turns: number): void {
  span.setAttribute('agentic.turns', turns);
}

export function setGoldenDetails(span: Span, details: unknown): void {
  span.setAttribute(`${LANGFUSE_KEYS.traceMetaPrefix}goldenDetails`, JSON.stringify(details));
}
