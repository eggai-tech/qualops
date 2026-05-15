import { detectCapabilities } from '@/ai/providers/capabilities';

describe('detectCapabilities', () => {
  describe('openai provider', () => {
    it.each([
      ['gpt-5', 'openai-json-schema-strict', false, 'max_completion_tokens'],
      ['gpt-5-mini', 'openai-json-schema-strict', false, 'max_completion_tokens'],
      ['gpt-4o', 'openai-json-schema-strict', true, 'max_tokens'],
      ['gpt-4o-mini', 'openai-json-schema-strict', true, 'max_tokens'],
      ['o1-preview', 'openai-json-schema-strict', false, 'max_completion_tokens'],
      ['o1-mini', 'openai-json-schema-strict', false, 'max_completion_tokens'],
      ['o3-mini', 'openai-json-schema-strict', false, 'max_completion_tokens'],
      ['o4-mini', 'openai-json-schema-strict', false, 'max_completion_tokens'],
      ['gpt-3.5-turbo', 'openai-json-object', true, 'max_tokens'],
      ['some-custom-model', 'openai-json-object', true, 'max_tokens'],
    ])('routes %s to %s', (model, dialect, supportsTemperature, maxTokensField) => {
      const caps = detectCapabilities('openai', model);
      expect(caps.structuredDialect).toBe(dialect);
      expect(caps.supportsTemperature).toBe(supportsTemperature);
      expect(caps.maxTokensField).toBe(maxTokensField);
    });
  });

  describe('github provider', () => {
    it('routes gpt-4o exact match to strict', () => {
      expect(detectCapabilities('github', 'gpt-4o').structuredDialect).toBe(
        'openai-json-schema-strict',
      );
      expect(detectCapabilities('github', 'openai/gpt-4o').structuredDialect).toBe(
        'openai-json-schema-strict',
      );
    });

    it('routes gpt-4o-mini and other models to json_object (not strict on GitHub)', () => {
      expect(detectCapabilities('github', 'gpt-4o-mini').structuredDialect).toBe(
        'openai-json-object',
      );
      expect(detectCapabilities('github', 'phi-3-medium').structuredDialect).toBe(
        'openai-json-object',
      );
      expect(detectCapabilities('github', 'meta-llama/llama-3-70b').structuredDialect).toBe(
        'openai-json-object',
      );
    });
  });

  describe('anthropic provider', () => {
    it.each([
      ['claude-sonnet-4-5-20250929', 'anthropic-output-config'],
      ['claude-opus-4-5', 'anthropic-output-config'],
      ['claude-haiku-4-5', 'anthropic-output-config'],
      ['claude-mythos-preview', 'anthropic-output-config'],
      ['claude-3-haiku-20240307', 'anthropic-tool-use'],
      ['claude-opus-4-1', 'anthropic-tool-use'],
      ['claude-opus-4-0', 'anthropic-tool-use'],
    ])('routes %s to %s', (model, dialect) => {
      expect(detectCapabilities('anthropic', model).structuredDialect).toBe(dialect);
    });

    it('always supports temperature and max_tokens', () => {
      const caps = detectCapabilities('anthropic', 'claude-sonnet-4-5-20250929');
      expect(caps.supportsTemperature).toBe(true);
      expect(caps.maxTokensField).toBe('max_tokens');
    });
  });

  describe('bedrock provider', () => {
    it('always uses anthropic-tool-use until AWS exposes output_config', () => {
      expect(detectCapabilities('bedrock', 'anthropic.claude-sonnet-4-5').structuredDialect).toBe(
        'anthropic-tool-use',
      );
      expect(detectCapabilities('bedrock', 'any-model').structuredDialect).toBe(
        'anthropic-tool-use',
      );
    });
  });

  it('throws for unknown provider via never-narrowed switch', () => {
    expect(() =>
      detectCapabilities('unknown' as Parameters<typeof detectCapabilities>[0], 'any'),
    ).toThrow('Unknown provider');
  });
});
