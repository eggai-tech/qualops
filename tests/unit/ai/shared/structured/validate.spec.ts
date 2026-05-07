import { z } from 'zod';

import { parseAndValidate, StructuredOutputError } from '@/ai/shared/structured';

const PingSchema = z.object({ key: z.string(), n: z.number() });

describe('parseAndValidate', () => {
  it('returns typed object for valid raw JSON', () => {
    const result = parseAndValidate('{"key":"v","n":1}', PingSchema);
    expect(result).toEqual({ key: 'v', n: 1 });
  });

  it('extracts JSON from a fenced code block', () => {
    const result = parseAndValidate('```json\n{"key":"v","n":1}\n```', PingSchema);
    expect(result).toEqual({ key: 'v', n: 1 });
  });

  it('recovers from raw newlines inside string literals', () => {
    const raw = '{"key":"line1\nline2","n":1}';
    const result = parseAndValidate(raw, PingSchema);
    expect(result.key).toBe('line1\nline2');
  });

  it('throws StructuredOutputError when no JSON value present', () => {
    expect(() => parseAndValidate('plain prose', PingSchema)).toThrow(StructuredOutputError);
    expect(() => parseAndValidate('plain prose', PingSchema)).toThrow(
      'No JSON value found in model response',
    );
  });

  it('throws StructuredOutputError on unparseable JSON', () => {
    expect(() => parseAndValidate('{not json}', PingSchema)).toThrow(StructuredOutputError);
  });

  it('throws StructuredOutputError on schema validation failure', () => {
    expect(() => parseAndValidate('{"key":1,"n":1}', PingSchema)).toThrow(StructuredOutputError);
    try {
      parseAndValidate('{"key":1,"n":1}', PingSchema);
    } catch (error) {
      expect(error).toBeInstanceOf(StructuredOutputError);
      const soe = error as StructuredOutputError;
      expect(soe.message).toContain('Schema validation failed');
      expect(soe.raw).toBe('{"key":1,"n":1}');
    }
  });

  it('preserves the raw response on the error for debugging', () => {
    const raw = 'gibberish that is not json';
    try {
      parseAndValidate(raw, PingSchema);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as StructuredOutputError).raw).toBe(raw);
    }
  });
});
