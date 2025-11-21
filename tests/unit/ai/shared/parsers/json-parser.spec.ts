import { JsonParser, jsonParser, parseJsonResponse } from '@/ai/shared/parsers/json-parser';
import { logger } from '@/shared/utils/logger';

jest.mock('@/shared/utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('JsonParser', () => {
  let parser: JsonParser;

  beforeEach(() => {
    parser = new JsonParser();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with default options', () => {
      const defaultParser = new JsonParser();
      expect(defaultParser).toBeInstanceOf(JsonParser);
    });

    it('should merge custom options with defaults', () => {
      const customParser = new JsonParser({
        strict: true,
        stripComments: false,
        allowTrailing: false,
        maxDepth: 100,
      });
      expect(customParser).toBeInstanceOf(JsonParser);
    });

    it('should handle partial options', () => {
      const partialParser = new JsonParser({ strict: true });
      expect(partialParser).toBeInstanceOf(JsonParser);
    });
  });

  describe('parseResponse', () => {
    it('should parse valid JSON object', () => {
      const json = '{"name": "test", "value": 123}';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', value: 123 });
      expect(result.rawResponse).toBe(json);
    });

    it('should parse valid JSON array', () => {
      const json = '[1, 2, 3, "four"]';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([1, 2, 3, 'four']);
    });

    it('should handle empty string input', () => {
      const result = parser.parseResponse('');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid response: empty or non-string input');
    });

    it('should handle non-string input', () => {
      const result = parser.parseResponse(null as any);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid response: empty or non-string input');
      expect(result.rawResponse).toBe('null');
    });

    it('should handle undefined input', () => {
      const result = parser.parseResponse(undefined as any);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid response: empty or non-string input');
    });

    it('should parse JSON with trailing commas when enabled', () => {
      const json = '{"name": "test", "value": 123,}';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', value: 123 });
    });

    it('should parse JSON with single quotes', () => {
      const json = "{'name': 'test', 'value': 123}";
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', value: 123 });
    });

    it('should parse JSON with unquoted keys', () => {
      const json = '{name: "test", value: 123}';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', value: 123 });
    });

    it('should strip single-line comments', () => {
      const json = `{
        "name": "test", // this is a comment
        "value": 123
      }`;
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', value: 123 });
    });

    it('should strip multi-line comments', () => {
      const json = `{
        "name": "test", /* this is a
        multi-line comment */
        "value": 123
      }`;
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', value: 123 });
    });

    it('should extract JSON from markdown code block', () => {
      const markdown = '```json\n{"name": "test", "value": 123}\n```';
      const result = parser.parseResponse(markdown);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', value: 123 });
    });

    it('should extract JSON from markdown code block without language', () => {
      const markdown = '```\n{"name": "test"}\n```';
      const result = parser.parseResponse(markdown);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test' });
    });

    it('should extract JSON object from text', () => {
      const text = 'Here is some data: {"name": "test", "value": 123} and more text';
      const result = parser.parseResponse(text);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', value: 123 });
    });

    it('should extract JSON array from text', () => {
      const text = 'Data: [1, 2, 3] here';
      const result = parser.parseResponse(text);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([1, 2, 3]);
    });

    it('should prefer object over array when both present', () => {
      const text = '[1, 2] {"name": "test"}';
      const result = parser.parseResponse(text);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test' });
    });

    it('should handle nested objects', () => {
      const json = '{"outer": {"inner": {"deep": "value"}}}';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ outer: { inner: { deep: 'value' } } });
    });

    it('should handle complex nested arrays', () => {
      const json = '{"items": [{"id": 1}, {"id": 2, "nested": [3, 4]}]}';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        items: [{ id: 1 }, { id: 2, nested: [3, 4] }],
      });
    });

    it('should handle mixed types in arrays', () => {
      const json = '[1, "string", true, null, {"obj": "value"}]';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([1, 'string', true, null, { obj: 'value' }]);
    });

    it('should fail when no JSON can be extracted', () => {
      const text = 'This is just plain text with no JSON';
      const result = parser.parseResponse(text);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse JSON:');
    });

    it('should handle malformed JSON gracefully', () => {
      const json = '{name: "test", value: }';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should handle JSON with special characters', () => {
      const json = '{"text": "Hello\\nWorld\\t!"}';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ text: 'Hello\nWorld\t!' });
    });

    it('should handle JSON with unicode characters', () => {
      const json = '{"text": "你好世界"}';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ text: '你好世界' });
    });

    it('should handle empty objects and arrays', () => {
      expect(parser.parseResponse('{}').success).toBe(true);
      expect(parser.parseResponse('[]').success).toBe(true);
      expect(parser.parseResponse('{}').data).toEqual({});
      expect(parser.parseResponse('[]').data).toEqual([]);
    });

    it('should preserve boolean values', () => {
      const json = '{"isTrue": true, "isFalse": false}';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ isTrue: true, isFalse: false });
    });

    it('should preserve null values', () => {
      const json = '{"value": null}';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ value: null });
    });

    it('should handle numbers with decimals and exponents', () => {
      const json = '{"decimal": 3.14, "exponential": 1.5e10}';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ decimal: 3.14, exponential: 1.5e10 });
    });

    it('should extract JSON from code blocks', () => {
      const markdown = '```json\n{"first": 1}\n```';
      const result = parser.parseResponse(markdown);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('first');
    });
  });

  describe('parseMultipleObjects', () => {
    it('should parse multiple JSON objects from separate lines', () => {
      const response = '{"id": 1, "name": "first"}\n{"id": 2, "name": "second"}';
      const result = parser.parseMultipleObjects(response);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data).toEqual([
        { id: 1, name: 'first' },
        { id: 2, name: 'second' },
      ]);
    });

    it('should skip empty lines', () => {
      const response = '{"id": 1}\n\n{"id": 2}\n\n\n{"id": 3}';
      const result = parser.parseMultipleObjects(response);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
    });

    it('should skip non-JSON lines', () => {
      const response = 'Some text\n{"id": 1}\nMore text\n{"id": 2}';
      const result = parser.parseMultipleObjects(response);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should handle arrays as multiple objects', () => {
      const response = '[1, 2]\n[3, 4]';
      const result = parser.parseMultipleObjects(response);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    it('should return error when no valid objects found', () => {
      const response = 'No JSON here\nJust plain text';
      const result = parser.parseMultipleObjects(response);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No valid JSON objects found');
    });

    it('should handle malformed JSON in some lines', () => {
      const response = '{"id": 1}\n{invalid json}\n{"id": 2}';
      const result = parser.parseMultipleObjects(response);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should preserve raw response', () => {
      const response = '{"id": 1}';
      const result = parser.parseMultipleObjects(response);

      expect(result.rawResponse).toBe(response);
    });
  });

  describe('validateSchema', () => {
    interface TestType {
      name: string;
      value: number;
    }

    const validator = (data: unknown): data is TestType => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'name' in data &&
        typeof (data as Record<string, unknown>).name === 'string' &&
        'value' in data &&
        typeof (data as Record<string, unknown>).value === 'number'
      );
    };

    it('should validate data with correct schema', () => {
      const data = { name: 'test', value: 123 };
      const result = parser.validateSchema(data, validator);

      expect(result).toBe(true);
    });

    it('should reject data with incorrect schema', () => {
      const data = { name: 'test', value: 'not a number' };
      const result = parser.validateSchema(data, validator);

      expect(result).toBe(false);
    });

    it('should handle validator throwing error', () => {
      const throwingValidator = (data: unknown): data is TestType => {
        throw new Error('Validation failed');
      };
      const data = { name: 'test' };
      const result = parser.validateSchema(data, throwingValidator);

      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should handle null data', () => {
      const result = parser.validateSchema(null, validator);

      expect(result).toBe(false);
    });

    it('should handle undefined data', () => {
      const result = parser.validateSchema(undefined, validator);

      expect(result).toBe(false);
    });
  });

  describe('default instance', () => {
    it('should export default parser instance', () => {
      expect(jsonParser).toBeInstanceOf(JsonParser);
    });

    it('should allow using default instance', () => {
      const json = '{"test": true}';
      const result = jsonParser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ test: true });
    });
  });

  describe('parseJsonResponse utility function', () => {
    it('should parse JSON using utility function', () => {
      const json = '{"name": "test"}';
      const result = parseJsonResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test' });
    });

    it('should accept custom options', () => {
      const json = '{name: "test"}';
      const result = parseJsonResponse(json, { strict: false });

      expect(result.success).toBe(true);
    });

    it('should handle strict mode', () => {
      const json = '{name: "test"}';
      const strictResult = parseJsonResponse(json, {
        strict: true,
        allowTrailing: false,
      });

      expect(strictResult.success).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle whitespace-only input', () => {
      const result = parser.parseResponse('   \n\t  ');

      expect(result.success).toBe(false);
    });

    it('should handle very large JSON objects', () => {
      const largeObject = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `item-${i}`,
        })),
      };
      const json = JSON.stringify(largeObject);
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect((result.data as { items: unknown[] }).items).toHaveLength(1000);
    });

    it('should handle JSON with no spaces', () => {
      const json = '{"a":1,"b":2,"c":3}';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
    });

    it('should handle JSON with excessive spaces', () => {
      const json = '{   "a"  :  1  ,  "b"  :  2  }';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
    });

    it('should handle JSON starting with BOM', () => {
      const json = '\uFEFF{"name": "test"}';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
    });

    it('should handle multiple trailing commas', () => {
      const json = '{"a": 1,, "b": 2,}';
      const result = parser.parseResponse(json);

      expect(result.success).toBe(false);
    });

    it('should detect objects that look like JSON but are not', () => {
      const text = '{this is not json}';
      const result = parser.parseResponse(text);

      expect(result.success).toBe(false);
    });

    it('should validate deeply nested objects within maxDepth', () => {
      const deeplyNested = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: 'value',
              },
            },
          },
        },
      };

      const json = JSON.stringify(deeplyNested);
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(deeplyNested);
    });

    it('should handle objects with arrays of nested objects', () => {
      const complexObject = {
        items: [
          { id: 1, nested: { value: 'a' } },
          { id: 2, nested: { value: 'b' } },
        ],
        metadata: {
          count: 2,
          tags: ['tag1', 'tag2'],
        },
      };

      const json = JSON.stringify(complexObject);
      const result = parser.parseResponse(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(complexObject);
    });
  });
});
