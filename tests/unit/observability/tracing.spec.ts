import { trace } from '@opentelemetry/api';

import { setupTracing, getTracer, shutdownTracing, forceFlushTracing } from '@/observability';

describe('tracing', () => {
  afterEach(async () => {
    await shutdownTracing();
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_BASE_URL;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  describe('setupTracing', () => {
    it('does not register a provider when no env vars are set', async () => {
      await setupTracing();
      // Without Langfuse/OTLP env vars, no NodeTracerProvider is registered.
      // The global provider remains the ProxyTracerProvider wrapping the NoopTracerProvider.
      const provider = trace.getTracerProvider() as any;
      expect(provider.getDelegate().constructor.name).toBe('NoopTracerProvider');
    });

    it('registers a NodeTracerProvider when Langfuse keys are set', async () => {
      process.env.LANGFUSE_SECRET_KEY = 'sk-test';
      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
      process.env.LANGFUSE_BASE_URL = 'http://localhost:3000';

      await setupTracing();

      const provider = trace.getTracerProvider() as any;
      expect(provider.getDelegate().constructor.name).toBe('NodeTracerProvider');
    });

    it('is idempotent — calling twice does not register a second provider', async () => {
      process.env.LANGFUSE_SECRET_KEY = 'sk-test';
      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
      process.env.LANGFUSE_BASE_URL = 'http://localhost:3000';

      await setupTracing();
      const providerAfterFirst = (trace.getTracerProvider() as any).getDelegate();

      await setupTracing();
      const providerAfterSecond = (trace.getTracerProvider() as any).getDelegate();

      // Same provider instance — not replaced on second call.
      expect(providerAfterSecond).toBe(providerAfterFirst);
    });
  });

  describe('shutdownTracing', () => {
    it('clears state so a subsequent call is a no-op', async () => {
      process.env.LANGFUSE_SECRET_KEY = 'sk-test';
      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
      process.env.LANGFUSE_BASE_URL = 'http://localhost:3000';

      await setupTracing();
      await shutdownTracing();

      // After shutdown _state is null; a second shutdown must not throw.
      await expect(shutdownTracing()).resolves.toBeUndefined();
    });

    it('is a no-op when tracing was never initialized', async () => {
      await expect(shutdownTracing()).resolves.toBeUndefined();
    });
  });

  describe('forceFlushTracing', () => {
    it('is a no-op when tracing is not initialized', async () => {
      await expect(forceFlushTracing()).resolves.toBeUndefined();
    });
  });

  describe('span context propagation', () => {
    it('makes the span available as the active span inside startActiveSpan', async () => {
      const tracer = getTracer();
      await tracer.startActiveSpan('parent', async (parentSpan) => {
        expect(trace.getActiveSpan()).toBe(parentSpan);
        parentSpan.end();
      });
    });

    it('restores the previous active span after the callback returns', async () => {
      const tracer = getTracer();
      const outerSpanBefore = trace.getActiveSpan();

      await tracer.startActiveSpan('child', async (childSpan) => {
        childSpan.end();
      });

      expect(trace.getActiveSpan()).toBe(outerSpanBefore);
    });
  });
});
