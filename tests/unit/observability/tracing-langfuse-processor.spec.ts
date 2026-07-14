import { shutdownTracing } from '@/observability';

const constructorSpy = jest.fn();

jest.mock('@langfuse/otel', () => ({
  LangfuseSpanProcessor: class {
    constructor(params: unknown) {
      constructorSpy(params);
    }
    async forceFlush() {}
    async shutdown() {}
    onStart() {}
    onEnd() {}
  },
}));

describe('setupTracing (LangfuseSpanProcessor construction)', () => {
  afterEach(async () => {
    await shutdownTracing();
    delete process.env.QUALOPS_LANGFUSE_SECRET_KEY;
    delete process.env.QUALOPS_LANGFUSE_PUBLIC_KEY;
    delete process.env.QUALOPS_LANGFUSE_BASE_URL;
  });

  it('constructs LangfuseSpanProcessor with explicit options read from QUALOPS_LANGFUSE_* env vars', async () => {
    process.env.QUALOPS_LANGFUSE_SECRET_KEY = 'sk-test';
    process.env.QUALOPS_LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.QUALOPS_LANGFUSE_BASE_URL = 'http://localhost:3000';

    const { setupTracing } = await import('@/observability');
    await setupTracing();

    expect(constructorSpy).toHaveBeenCalledWith({
      secretKey: 'sk-test',
      publicKey: 'pk-test',
      baseUrl: 'http://localhost:3000',
    });
  });
});
