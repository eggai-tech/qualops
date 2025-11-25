import { logger } from '../../../shared/utils/logger';

export interface ParsedResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  rawResponse?: string;
}

export interface JsonParserOptions {
  strict?: boolean;
  stripComments?: boolean;
  allowTrailing?: boolean;
  maxDepth?: number;
}

export class JsonParser {
  private options: Required<JsonParserOptions>;

  constructor(options: JsonParserOptions = {}) {
    this.options = {
      strict: false,
      stripComments: true,
      allowTrailing: true,
      maxDepth: 50,
      ...options,
    };
  }

  parseResponse<T = unknown>(response: string): ParsedResponse<T> {
    if (!response || typeof response !== 'string') {
      return {
        success: false,
        error: 'Invalid response: empty or non-string input',
        rawResponse: String(response),
      };
    }

    let jsonText = response.trim();

    const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*)```/i);
    if (codeBlockMatch?.[1]) {
      jsonText = codeBlockMatch[1].trim();
    } else if (!this.looksLikeJson(jsonText)) {
      const objectMatch = jsonText.match(/(\{[\s\S]*\})/);
      const arrayMatch = jsonText.match(/(\[[\s\S]*\])/);
      if (objectMatch?.[1]) {
        jsonText = objectMatch[1];
      } else if (arrayMatch?.[1]) {
        jsonText = arrayMatch[1];
      }
    }

    jsonText = this.stripJsonComments(jsonText);
    jsonText = this.fixCommonIssues(jsonText);

    try {
      const data = JSON.parse(jsonText);
      return { success: true, data, rawResponse: response };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
        rawResponse: response,
      };
    }
  }

  parseMultipleObjects<T = unknown>(response: string): ParsedResponse<T[]> {
    const objects: T[] = [];
    const lines = response.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !this.looksLikeJson(trimmed)) continue;

      const result = this.parseResponse<T>(trimmed);
      if (result.success && result.data) {
        objects.push(result.data);
      }
    }

    if (objects.length === 0) {
      return {
        success: false,
        error: 'No valid JSON objects found',
        rawResponse: response,
      };
    }

    return {
      success: true,
      data: objects,
      rawResponse: response,
    };
  }

  private stripJsonComments(json: string): string {
    json = json.replace(/\/\/.*$/gm, '');
    json = json.replace(/\/\*[\s\S]*?\*\//g, '');
    return json;
  }

  private fixCommonIssues(json: string): string {
    json = json.replace(/,(\s*[}\]])/g, '$1');
    json = json.replace(/'/g, '"');
    json = json.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
    return json;
  }

  private validateDepth(obj: unknown, currentDepth = 0): boolean {
    if (currentDepth > this.options.maxDepth) {
      return false;
    }

    if (typeof obj === 'object' && obj !== null) {
      for (const value of Object.values(obj)) {
        if (!this.validateDepth(value, currentDepth + 1)) {
          return false;
        }
      }
    }

    return true;
  }

  private looksLikeJson(text: string): boolean {
    const trimmed = text.trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
  }

  validateSchema<T>(data: unknown, validator: (data: unknown) => data is T): data is T {
    try {
      return validator(data);
    } catch (error) {
      const err = error as Error;
      logger.warn('Schema validation failed:', err.message);
      return false;
    }
  }
}

export const jsonParser = new JsonParser();

export function parseJsonResponse<T = unknown>(response: string, options?: JsonParserOptions): ParsedResponse<T> {
  const parser = new JsonParser(options);
  return parser.parseResponse<T>(response);
}
