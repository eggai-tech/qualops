import {
  setTraceAttributes,
  setTraceMetadataFromPR,
  setModelAttribute,
  setTokenUsage,
  setObservationIO,
  setTraceIO,
  setAgenticSpanAttributes,
  setAgenticTurns,
  setGoldenDetails,
  recordSpanError,
  withAISpan,
} from '@/observability';
import type { PRMetadata } from '@/observability';

describe('observability helpers', () => {
  function createMockSpan() {
    const attrs: Record<string, unknown> = {};
    return {
      setAttribute: jest.fn((key: string, value: unknown) => {
        attrs[key] = value;
      }),
      setStatus: jest.fn(),
      recordException: jest.fn(),
      end: jest.fn(),
      _attrs: attrs,
    };
  }

  describe('setTraceAttributes', () => {
    it('sets session.id, trace.name, tags, and metadata', () => {
      const span = createMockSpan();
      setTraceAttributes(span as any, {
        sessionId: 'my-session',
        traceName: 'qualops/run',
        tags: ['production', 'ci'],
        metadata: { repo: 'org/repo', prNumber: '42' },
      });

      expect(span._attrs['session.id']).toBe('my-session');
      expect(span._attrs['langfuse.trace.name']).toBe('qualops/run');
      expect(span._attrs['langfuse.trace.tags']).toEqual(['production', 'ci']);
      expect(span._attrs['langfuse.trace.metadata.repo']).toBe('org/repo');
      expect(span._attrs['langfuse.trace.metadata.prNumber']).toBe('42');
    });

    it('redacts sensitive keys in metadata', () => {
      const span = createMockSpan();
      setTraceAttributes(span as any, {
        sessionId: 's',
        traceName: 't',
        metadata: { repo: 'org/repo', apiKey: 'sk-secret' },
      });
      expect(span._attrs['langfuse.trace.metadata.repo']).toBe('org/repo');
      expect(span._attrs['langfuse.trace.metadata.apiKey']).toBe('[REDACTED]');
    });

    it('omits undefined/null metadata values', () => {
      const span = createMockSpan();
      setTraceAttributes(span as any, {
        sessionId: 's',
        traceName: 't',
        metadata: { a: 'present', b: undefined, c: null },
      });

      expect(span._attrs['langfuse.trace.metadata.a']).toBe('present');
      expect(span._attrs).not.toHaveProperty('langfuse.trace.metadata.b');
      expect(span._attrs).not.toHaveProperty('langfuse.trace.metadata.c');
    });
  });

  describe('setTraceMetadataFromPR', () => {
    it('sets all PR metadata as trace attributes', () => {
      const span = createMockSpan();
      const prMeta: PRMetadata = {
        repo: 'org/repo',
        prNumber: '99',
        prUrl: 'https://github.com/org/repo/pull/99',
        headSha: 'abc123',
        baseSha: 'def456',
        sessionId: 'org/repo:abc123',
      };

      setTraceMetadataFromPR(span as any, prMeta, 'my-session');

      expect(span._attrs['session.id']).toBe('org/repo:abc123');
      expect(span._attrs['langfuse.trace.name']).toBe('qualops/run');
      expect(span._attrs['langfuse.trace.metadata.repo']).toBe('org/repo');
      expect(span._attrs['langfuse.trace.metadata.sessionName']).toBe('my-session');
    });
  });

  describe('setModelAttribute', () => {
    it('sets gen_ai.request.model', () => {
      const span = createMockSpan();
      setModelAttribute(span as any, 'claude-sonnet-4-6');
      expect(span._attrs['gen_ai.request.model']).toBe('claude-sonnet-4-6');
    });
  });

  describe('setTraceAttributes with model', () => {
    it('sets gen_ai.request.model when model is provided', () => {
      const span = createMockSpan();
      setTraceAttributes(span as any, {
        sessionId: 's',
        traceName: 't',
        model: 'claude-sonnet-4-6',
      });
      expect(span._attrs['gen_ai.request.model']).toBe('claude-sonnet-4-6');
    });

    it('omits gen_ai.request.model when model is not provided', () => {
      const span = createMockSpan();
      setTraceAttributes(span as any, { sessionId: 's', traceName: 't' });
      expect(span._attrs).not.toHaveProperty('gen_ai.request.model');
    });
  });

  describe('setTokenUsage', () => {
    it('sets model, input_tokens, and output_tokens', () => {
      const span = createMockSpan();
      setTokenUsage(span as any, {
        model: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 50,
      });

      expect(span._attrs['gen_ai.request.model']).toBe('claude-sonnet-4-6');
      expect(span._attrs['gen_ai.usage.input_tokens']).toBe(100);
      expect(span._attrs['gen_ai.usage.output_tokens']).toBe(50);
    });

    it('omits optional token fields when not provided', () => {
      const span = createMockSpan();
      setTokenUsage(span as any, { model: 'gpt-4' });

      expect(span._attrs['gen_ai.request.model']).toBe('gpt-4');
      expect(span._attrs).not.toHaveProperty('gen_ai.usage.input_tokens');
      expect(span._attrs).not.toHaveProperty('gen_ai.usage.output_tokens');
    });
  });

  describe('setObservationIO', () => {
    it('serializes input as JSON observation attribute', () => {
      const span = createMockSpan();
      setObservationIO(span as any, { input: { prompt: 'hello' } });
      expect(span._attrs['langfuse.observation.input']).toBe('{"prompt":"hello"}');
    });

    it('serializes output as JSON observation attribute', () => {
      const span = createMockSpan();
      setObservationIO(span as any, { output: { issueCount: 5 } });
      expect(span._attrs['langfuse.observation.output']).toBe('{"issueCount":5}');
    });

    it('redacts sensitive keys in input', () => {
      const span = createMockSpan();
      setObservationIO(span as any, { input: { user: 'alice', apiKey: 'sk-secret' } });
      const parsed = JSON.parse(span._attrs['langfuse.observation.input'] as string);
      expect(parsed.apiKey).toBe('[REDACTED]');
      expect(parsed.user).toBe('alice');
    });

    it('omits input when not provided', () => {
      const span = createMockSpan();
      setObservationIO(span as any, { output: 'result' });
      expect(span._attrs).not.toHaveProperty('langfuse.observation.input');
    });

    it('omits output when not provided', () => {
      const span = createMockSpan();
      setObservationIO(span as any, { input: 'data' });
      expect(span._attrs).not.toHaveProperty('langfuse.observation.output');
    });
  });

  describe('setTraceIO', () => {
    it('serializes input as trace-level attribute', () => {
      const span = createMockSpan();
      setTraceIO(span as any, { input: { file: 'src/foo.ts' } });
      expect(span._attrs['langfuse.trace.input']).toBe('{"file":"src/foo.ts"}');
    });

    it('serializes output as trace-level attribute', () => {
      const span = createMockSpan();
      setTraceIO(span as any, { output: [{ severity: 'high' }] });
      expect(span._attrs['langfuse.trace.output']).toBe('[{"severity":"high"}]');
    });
  });

  describe('setAgenticSpanAttributes', () => {
    it('redacts sensitive keys in config', () => {
      const span = createMockSpan();
      setAgenticSpanAttributes(span as any, {
        model: 'claude-sonnet-4-6',
        jobName: 'security',
        config: { maxTurns: 10, apiKey: 'sk-secret' },
      });
      const stored = JSON.parse(span._attrs['langfuse.trace.metadata.agenticConfig'] as string);
      expect(stored.apiKey).toBe('[REDACTED]');
      expect(stored.maxTurns).toBe(10);
    });

    it('sets model, jobName, and config attributes', () => {
      const span = createMockSpan();
      const config = { maxTurns: 10 };
      setAgenticSpanAttributes(span as any, {
        model: 'claude-sonnet-4-6',
        jobName: 'security',
        config,
      });
      expect(span._attrs['gen_ai.request.model']).toBe('claude-sonnet-4-6');
      expect(span._attrs['langfuse.trace.metadata.agenticJob']).toBe('security');
      expect(span._attrs['langfuse.trace.metadata.agenticConfig']).toBe(JSON.stringify(config));
    });
  });

  describe('setAgenticTurns', () => {
    it('sets agentic.turns attribute', () => {
      const span = createMockSpan();
      setAgenticTurns(span as any, 7);
      expect(span._attrs['agentic.turns']).toBe(7);
    });
  });

  describe('setGoldenDetails', () => {
    it('serializes goldenDetails as trace metadata attribute', () => {
      const span = createMockSpan();
      const details = [{ goldenIndex: 0, matched: true }];
      setGoldenDetails(span as any, details);
      expect(span._attrs['langfuse.trace.metadata.goldenDetails']).toBe(JSON.stringify(details));
    });
  });

  describe('sanitizeForObservability (via setObservationIO)', () => {
    it('redacts nested sensitive keys', () => {
      const span = createMockSpan();
      setObservationIO(span as any, { input: { config: { token: 'abc', name: 'test' } } });
      const parsed = JSON.parse(span._attrs['langfuse.observation.input'] as string);
      expect(parsed.config.token).toBe('[REDACTED]');
      expect(parsed.config.name).toBe('test');
    });

    it('handles arrays of objects', () => {
      const span = createMockSpan();
      setObservationIO(span as any, { input: [{ password: 'x', role: 'admin' }] });
      const parsed = JSON.parse(span._attrs['langfuse.observation.input'] as string);
      expect(parsed[0].password).toBe('[REDACTED]');
      expect(parsed[0].role).toBe('admin');
    });

    it('redacts Bearer token values', () => {
      const span = createMockSpan();
      setObservationIO(span as any, { input: { header: 'Bearer sk-abc123xyz' } });
      const parsed = JSON.parse(span._attrs['langfuse.observation.input'] as string);
      expect(parsed.header).toBe('[REDACTED]');
    });

    it('redacts vendor-prefixed API key values (sk-, pk-, ghp_, glpat-)', () => {
      const span = createMockSpan();
      setObservationIO(span as any, {
        input: {
          a: 'sk-abcdefghij1234',
          b: 'pk-abcdefghij1234',
          c: 'ghp_ABCdef123456',
          d: 'glpat-abcdefghijklmnopqrst123456',
          e: 'not-a-secret',
        },
      });
      const parsed = JSON.parse(span._attrs['langfuse.observation.input'] as string);
      expect(parsed.a).toBe('[REDACTED]');
      expect(parsed.b).toBe('[REDACTED]');
      expect(parsed.c).toBe('[REDACTED]');
      expect(parsed.d).toBe('[REDACTED]');
      expect(parsed.e).toBe('not-a-secret');
    });

    it('redacts credentials embedded within a longer string value', () => {
      const span = createMockSpan();
      setObservationIO(span as any, {
        input: { prompt: 'Authorization: Bearer ghp_ABCdef123456 — please use this token' },
      });
      const parsed = JSON.parse(span._attrs['langfuse.observation.input'] as string);
      expect(parsed.prompt).not.toContain('ghp_ABCdef123456');
      expect(parsed.prompt).toContain('[REDACTED]');
    });

    it('passes through null and primitives unchanged', () => {
      const span = createMockSpan();
      setObservationIO(span as any, { input: null });
      expect(span._attrs['langfuse.observation.input']).toBe('null');
    });
  });

  describe('recordSpanError', () => {
    it('calls recordException and sets ERROR status for an Error instance', () => {
      const span = createMockSpan();
      const err = new Error('boom');
      recordSpanError(span as any, err);
      expect(span.recordException).toHaveBeenCalledWith(err);
      expect(span.setStatus).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    });

    it('wraps non-Error values in an Error before recording', () => {
      const span = createMockSpan();
      recordSpanError(span as any, 'string error');
      const recorded = (span.recordException as jest.Mock).mock.calls[0][0];
      expect(recorded).toBeInstanceOf(Error);
      expect(recorded.message).toBe('string error');
    });
  });

  describe('withAISpan', () => {
    it('sets gen_ai.request.model and span output, then ends span', async () => {
      const span = createMockSpan();
      const tracer = { startActiveSpan: jest.fn((_name, fn) => fn(span)) } as any;
      const result = await withAISpan(tracer, 'test-span', 'claude-sonnet-4-6', async () => [1, 2]);
      expect(result).toEqual([1, 2]);
      expect(span._attrs['gen_ai.request.model']).toBe('claude-sonnet-4-6');
      expect(span._attrs['langfuse.observation.output']).toBe('[1,2]');
      expect(span.end).toHaveBeenCalled();
    });
  });
});
