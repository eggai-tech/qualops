import { logger } from '../../../shared/utils/logger';

export interface ContextLocation {
  startIndex: number;
  endIndex: number;
  startLine: number;
  endLine: number;
  confidence: 'exact' | 'pattern' | 'fuzzy';
}

export function findContextInFile(fileContent: string, context: string): ContextLocation | null {
  const index = fileContent.indexOf(context);
  if (index !== -1) {
    return { ...calculateLocation(fileContent, index, context.length), confidence: 'exact' };
  }

  const normalizedContent = fileContent.replace(/\s+/g, ' ');
  const normalizedContext = context.replace(/\s+/g, ' ');
  const normalizedIndex = normalizedContent.indexOf(normalizedContext);

  if (normalizedIndex !== -1) {
    let originalIndex = 0;
    let normalizedPos = 0;

    while (normalizedPos < normalizedIndex && originalIndex < fileContent.length) {
      if (/\s/.test(fileContent[originalIndex])) {
        while (originalIndex < fileContent.length && /\s/.test(fileContent[originalIndex])) {
          originalIndex++;
        }
        if (normalizedPos < normalizedContent.length && normalizedContent[normalizedPos] === ' ') {
          normalizedPos++;
        }
      } else {
        if (originalIndex < fileContent.length && normalizedPos < normalizedContent.length) {
          originalIndex++;
          normalizedPos++;
        } else {
          break;
        }
      }
    }

    const startIndex = originalIndex;
    let endIndex = startIndex;
    let contextPos = 0;

    while (contextPos < context.length && endIndex < fileContent.length) {
      if (/\s/.test(fileContent[endIndex])) {
        endIndex++;
      } else {
        const fileChar = fileContent[endIndex];
        const contextChar = context[contextPos];

        if (/\s/.test(contextChar)) {
          contextPos++;
          continue;
        }

        if (fileChar === contextChar) {
          endIndex++;
          contextPos++;
        } else {
          break;
        }
      }
    }

    const actualLength = endIndex - startIndex;
    return { ...calculateLocation(fileContent, startIndex, actualLength), confidence: 'pattern' };
  }

  const patterns = [
    { regex: `\\b${escapeRegExp(context)}\\s*\\(`, type: 'function' },
    { regex: `class\\s+${escapeRegExp(context)}\\s*[{<]`, type: 'class' },
    { regex: `(const|let|var)\\s+${escapeRegExp(context)}\\s*[=:]`, type: 'variable' },
  ];

  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern.regex, 'g');
      const match = regex.exec(fileContent);
      if (match) {
        return {
          ...calculateLocation(fileContent, match.index, match[0].length),
          confidence: 'pattern',
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function extractCodeAroundContext(
  fileContent: string,
  location: ContextLocation,
  linesBefore = 10,
  linesAfter = 10,
): string {
  const lines = fileContent.split('\n');
  const startLine = Math.max(0, location.startLine - linesBefore);
  const endLine = Math.min(lines.length, location.endLine + linesAfter + 1);

  return lines.slice(startLine, endLine).join('\n');
}

export async function smartContextSearch(
  fileContent: string,
  context: string,
  description: string,
): Promise<ContextLocation | null> {
  const cleanContext = context.replace(/^\s*\d+[\u2192\s]+/gm, '').trim();

  if (!cleanContext) {
    return null;
  }

  // 1. Try exact/normalized match with cleaned context
  let location = findContextInFile(fileContent, cleanContext);
  if (location) {
    return location;
  }

  // 2. Try original context in case cleaning removed too much
  location = findContextInFile(fileContent, context);
  if (location) {
    return location;
  }

  // 3. Extract keywords from description and context
  const keywords = extractKeywords(description, cleanContext);

  // 4. Try finding unique identifiers first (longer keywords)
  const uniqueKeywords = keywords.filter((k) => k.length > 8);
  for (const keyword of uniqueKeywords) {
    location = findContextInFile(fileContent, keyword);
    if (location) {
      logger.info(`Found via unique keyword: ${keyword}`);
      return { ...location, confidence: 'fuzzy' };
    }
  }

  // 5. Try shorter keywords
  for (const keyword of keywords) {
    location = findContextInFile(fileContent, keyword);
    if (location) {
      logger.info(`Found via keyword: ${keyword}`);
      return { ...location, confidence: 'fuzzy' };
    }
  }

  // 6. Last resort - try to find any significant word from context
  const contextWords = cleanContext
    .split(/\s+/)
    .filter((w) => w.length > 5 && /^[a-zA-Z_]\w+$/.test(w));
  for (const word of contextWords) {
    if (fileContent.includes(word)) {
      const index = fileContent.indexOf(word);
      const lines = fileContent.substring(0, index).split('\n');
      logger.info(`Found via word match: ${word} at line ${lines.length}`);
      return {
        startIndex: index,
        endIndex: index + word.length,
        startLine: lines.length - 1,
        endLine: lines.length - 1,
        confidence: 'fuzzy',
      };
    }
  }

  return null;
}

export function extractKeywords(description: string, context?: string): string[] {
  const keywords: string[] = [];

  if (context) {
    keywords.push(context);
    const words = context.split(/\s+/).filter((w) => w.length > 4);
    keywords.push(...words);
  }

  const quotedMatches = description.match(/['"`]([^'"`]+)['"`]/g);
  if (quotedMatches) {
    keywords.push(...quotedMatches.map((m) => m.slice(1, -1)));
  }

  const functionMatches = description.match(/\b(\w+)\s*\(/g);
  if (functionMatches) {
    keywords.push(...functionMatches.map((m) => m.replace(/\s*\(/, '')));
  }

  const capitalizedMatches = description.match(/\b[A-Z]\w+\b/g);
  if (capitalizedMatches) {
    keywords.push(...capitalizedMatches);
  }

  const camelCaseMatches = description.match(/\b[a-z]+[A-Z]\w+\b/g);
  if (camelCaseMatches) {
    keywords.push(...camelCaseMatches);
  }

  const identifierMatches = description.match(/\b[a-zA-Z_]\w{3,}\b/g);
  if (identifierMatches) {
    keywords.push(...identifierMatches);
  }

  return [...new Set(keywords)].sort((a, b) => b.length - a.length);
}

function calculateLocation(
  content: string,
  index: number,
  length: number,
): Omit<ContextLocation, 'confidence'> {
  const lines = content.substring(0, index).split('\n');
  const startLine = lines.length - 1;
  const endContent = content.substring(0, index + length);
  const endLines = endContent.split('\n');
  const endLine = endLines.length - 1;

  return {
    startIndex: index,
    endIndex: index + length,
    startLine,
    endLine,
  };
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
