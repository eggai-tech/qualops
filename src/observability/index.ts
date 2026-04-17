// SDK lifecycle
export { setupTracing, getTracer, shutdownTracing, forceFlushTracing } from './tracing';

// OTel-standard helpers (portable, backend-agnostic)
export {
  setModelAttribute,
  setTokenUsage,
  withAISpan,
  sanitizeForObservability,
} from './span-attributes';
export type { TokenUsageOptions } from './span-attributes';

// Langfuse-specific helpers (replace this file when changing backends)
export {
  setTraceAttributes,
  setTraceMetadataFromPR,
  setObservationIO,
  setTraceIO,
  setAgenticSpanAttributes,
  setAgenticTurns,
  setGoldenDetails,
} from './langfuse';
export type { TraceAttributeOptions } from './langfuse';

// PR context extraction
export { extractPRMetadata } from './pr-metadata';
export type { PRMetadata } from './pr-metadata';
