export interface ExtractedJson {
  text: string;
  source: 'fenced' | 'raw' | 'array-substring' | 'object-substring';
}

/**
 * Best-effort JSON extraction from a model response when native structured output is
 * not available. Tries fenced code block first, then a raw JSON value, then a substring
 * matching the outermost object/array.
 */
export function extractJsonText(response: string): ExtractedJson | null {
  if (!response) return null;
  const trimmed = response.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return { text: fenced[1].trim(), source: 'fenced' };

  // Unclosed ```json fence (truncated response): extract everything after the opening marker.
  // Restricted to explicit ```json — bare ``` could be any language block (Python, bash, etc.).
  const unclosedFence = trimmed.match(/```json\s*([\s\S]+)/i);
  if (unclosedFence?.[1]) return { text: unclosedFence[1].trim(), source: 'fenced' };

  if (looksLikeJson(trimmed)) return { text: trimmed, source: 'raw' };

  const arrayMatch = trimmed.match(/(\[[\s\S]*\])/);
  if (arrayMatch?.[1]) return { text: arrayMatch[1], source: 'array-substring' };

  const objectMatch = trimmed.match(/(\{[\s\S]*\})/);
  if (objectMatch?.[1]) return { text: objectMatch[1], source: 'object-substring' };

  return null;
}

function looksLikeJson(text: string): boolean {
  return (
    (text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))
  );
}

/**
 * Escape unescaped newlines/tabs inside JSON string literals. Models occasionally emit
 * raw newlines inside string values (especially in code snippets) which JSON.parse rejects.
 */
export function escapeUnescapedControlChars(json: string): string {
  let inString = false;
  let escaped = false;
  let out = '';

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && ch === '\n') {
      out += '\\n';
      continue;
    }
    if (inString && ch === '\r') continue;
    if (inString && ch === '\t') {
      out += '\\t';
      continue;
    }
    out += ch;
  }

  return out;
}
