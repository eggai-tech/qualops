import { escapeUnescapedControlChars, extractJsonText } from '@/ai/shared/structured';

describe('extractJsonText', () => {
  it('returns null for empty input', () => {
    expect(extractJsonText('')).toBeNull();
  });

  it('extracts a fenced ```json block', () => {
    const out = extractJsonText('prefix\n```json\n{"a":1}\n```\nsuffix');
    expect(out).toEqual({ text: '{"a":1}', source: 'fenced' });
  });

  it('extracts a fenced bare ``` block', () => {
    const out = extractJsonText('```\n[1,2,3]\n```');
    expect(out).toEqual({ text: '[1,2,3]', source: 'fenced' });
  });

  it('returns raw text when input itself is JSON object', () => {
    const out = extractJsonText('  {"a":1}  ');
    expect(out).toEqual({ text: '{"a":1}', source: 'raw' });
  });

  it('returns raw text when input itself is JSON array', () => {
    const out = extractJsonText('[1,2]');
    expect(out).toEqual({ text: '[1,2]', source: 'raw' });
  });

  it('falls back to array substring when wrapped in prose', () => {
    const out = extractJsonText('Sure, here is the result: [1, 2, 3] — done.');
    expect(out?.source).toBe('array-substring');
    expect(out?.text).toBe('[1, 2, 3]');
  });

  it('falls back to object substring when wrapped in prose', () => {
    const out = extractJsonText('Result: {"a":1} thanks.');
    expect(out?.source).toBe('object-substring');
    expect(out?.text).toBe('{"a":1}');
  });

  it('returns null when no JSON-like content found', () => {
    expect(extractJsonText('just plain text')).toBeNull();
  });
});

describe('escapeUnescapedControlChars', () => {
  it('escapes raw newlines inside string literals', () => {
    const input = '{"a":"line1\nline2"}';
    expect(escapeUnescapedControlChars(input)).toBe('{"a":"line1\\nline2"}');
  });

  it('escapes raw tabs inside string literals', () => {
    const input = '{"a":"col1\tcol2"}';
    expect(escapeUnescapedControlChars(input)).toBe('{"a":"col1\\tcol2"}');
  });

  it('strips raw carriage returns inside string literals', () => {
    const input = '{"a":"line1\r\nline2"}';
    expect(escapeUnescapedControlChars(input)).toBe('{"a":"line1\\nline2"}');
  });

  it('leaves whitespace OUTSIDE strings untouched', () => {
    const input = '{\n  "a": "x"\n}';
    expect(escapeUnescapedControlChars(input)).toBe(input);
  });

  it('preserves already-escaped sequences', () => {
    const input = '{"a":"line1\\nline2"}';
    expect(escapeUnescapedControlChars(input)).toBe(input);
  });

  it('handles escaped quotes inside strings', () => {
    const input = '{"a":"he said \\"hi\\""}';
    expect(escapeUnescapedControlChars(input)).toBe(input);
  });
});
