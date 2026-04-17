import { trace } from '@opentelemetry/api';
import type { Tracer } from '@opentelemetry/api';

import { logger } from '../shared/utils/logger';

interface TracingState {
  sdk: { shutdown(): Promise<void> };
  processor: { forceFlush(): Promise<void> };
}

let _state: TracingState | null = null;

/**
 * Initialize OpenTelemetry tracing.
 *
 * Auto-detection:
 * 1. LANGFUSE_SECRET_KEY + LANGFUSE_PUBLIC_KEY → LangfuseSpanProcessor
 * 2. OTEL_EXPORTER_OTLP_ENDPOINT → raw OTLPTraceExporter
 * 3. Neither → no-op (OTel default)
 */
export async function setupTracing(): Promise<void> {
  if (_state) return;

  const proxy = trace.getTracerProvider() as {
    getDelegate?: () => { constructor: { name: string } };
  };
  if (proxy.getDelegate && proxy.getDelegate().constructor.name !== 'NoopTracerProvider') {
    logger.debug('[Tracing] Existing TracerProvider detected, skipping setup');
    return;
  }

  const hasLangfuse = !!(process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_PUBLIC_KEY);
  const hasOtlp = !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!hasLangfuse && !hasOtlp) return;

  const { NodeSDK } = await import('@opentelemetry/sdk-node');

  if (hasLangfuse) {
    const { LangfuseSpanProcessor } = await import('@langfuse/otel');
    const processor = new LangfuseSpanProcessor();
    const sdk = new NodeSDK({ spanProcessors: [processor] });
    sdk.start();
    _state = { sdk, processor };
    logger.debug('[Tracing] Initialized with Langfuse OTEL exporter');
  } else {
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
    const processor = new BatchSpanProcessor(new OTLPTraceExporter());
    const sdk = new NodeSDK({ spanProcessors: [processor] });
    sdk.start();
    _state = { sdk, processor };
    logger.debug('[Tracing] Initialized with generic OTLP exporter');
  }
}

export function getTracer(name = 'qualops'): Tracer {
  return trace.getTracer(name);
}

export async function forceFlushTracing(): Promise<void> {
  if (!_state) return;
  await _state.processor.forceFlush();
}

export async function shutdownTracing(): Promise<void> {
  if (!_state) return;
  try {
    await _state.sdk.shutdown();
  } finally {
    _state = null;
  }
}
