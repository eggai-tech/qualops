import type { AIProvider } from '../../../ai/providers/provider';
import { fixMalformedJson } from '../../../ai/shared/parsers/json-parser';
import {
  getTracer,
  recordSpanError,
  setModelAttribute,
  setObservationIO,
  setTokenUsage,
} from '../../../observability';
import type { ReviewIssue } from '../../../shared/types';
import type { FileInfo } from '../../../shared/types/config';
import { logger } from '../../../shared/utils/logger';
import { getGlobalRateLimiter } from '../utils/global-rate-limiter';
import { addLineNumbers } from '../utils/line-numbered-content';

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  cache_control?: {
    type: 'ephemeral';
    ttl?: '1h';
  };
}

const JSON_RESPONSE_SPEC = `

<response_format>
Return VALID JSON ONLY - a single JSON array. Do not include markdown code fences or any text before/after the JSON.

CRITICAL: All strings must use proper JSON escaping:
- Newlines: \\n (not actual line breaks)
- Quotes: \\"
- Backslashes: \\\\
- Tabs: \\t

Schema:
[
  {
    "type": "security|performance|bug|maintainability",
    "severity": "critical|high|medium|low",
    "description": "Brief description of issue",
    "location": "line:42",
    "reasoning": "Why this specific code is problematic",
    "context": "Code snippet with proper JSON escaping - use \\n for newlines",
    "suggestion": "Concrete fix",
    "confidence": 8,
    "impact": "Attack impact",
    "cwe": "CWE-79",
    "threat_model": "Required attacker access"
  }
]

If no issues found, return: []
</response_format>
`;

export class FileReviewer {
  private aiProvider: AIProvider;
  private systemPrompt: string;
  private passName: string;

  constructor(aiProvider: AIProvider, systemPrompt: string, passName: string) {
    this.aiProvider = aiProvider;
    this.systemPrompt = systemPrompt + JSON_RESPONSE_SPEC;
    this.passName = passName;
  }

  async reviewFile(file: FileInfo): Promise<ReviewIssue[]> {
    const userMessage = this.buildUserMessage(file);

    const messages: Message[] = [
      {
        role: 'system',
        content: this.systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
      {
        role: 'user',
        content: userMessage,
      },
    ];

    const tracer = getTracer();

    return tracer.startActiveSpan(`file-review/${file.path}`, async (span) => {
      try {
        setModelAttribute(span, this.aiProvider.getModelName());
        setObservationIO(span, { input: messages });

        await getGlobalRateLimiter().throttleApiCall(this.aiProvider.name);

        const response = await this.aiProvider.complete({
          messages,
          maxTokens: this.aiProvider.getMaxTokens(),
          temperature: this.aiProvider.getTemperature(),
        });

        const parsedIssues = this.parseIssuesFromResponse(response.content, file.path);

        setTokenUsage(span, {
          model: this.aiProvider.getModelName(),
          inputTokens: response.usage?.promptTokens,
          outputTokens: response.usage?.completionTokens,
        });
        setObservationIO(span, { output: parsedIssues });

        return parsedIssues;
      } catch (error) {
        recordSpanError(span, error);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private buildUserMessage(file: FileInfo): string {
    const diffContext = this.buildDiffContext(file);

    return `Please review the following file:

File: ${file.path}
${diffContext}

\`\`\`
${addLineNumbers(file.content)}
\`\`\`

If no issues are found, respond with an empty array: []`;
  }

  private buildDiffContext(file: FileInfo): string {
    if (!file.diff) {
      return '';
    }

    const addedLines = Array.from(file.diff.additions).sort((a, b) => a - b);
    const deletedLines = Array.from(file.diff.deletions).sort((a, b) => a - b);

    if (addedLines.length === 0 && deletedLines.length === 0) {
      return '';
    }

    return `
**THIS IS A MERGE REQUEST REVIEW**
Changes in this MR:
- Lines added: ${addedLines.length > 0 ? addedLines.join(', ') : 'none'}
- Lines deleted: ${deletedLines.length > 0 ? deletedLines.join(', ') : 'none'}

IMPORTANT: Focus your review ONLY on the changed lines above. The rest of the file is shown for context.
Do NOT report issues in unchanged code unless they are directly related to the changes in this MR.`;
  }

  private parseIssuesFromResponse(content: string, filePath: string): ReviewIssue[] {
    if (!content || content.trim() === '') {
      logger.warn(`[FileReviewer] Empty response for ${filePath}`);
      return [];
    }

    // Try multiple patterns to extract JSON
    const codeBlockMatch = content.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    const arrayMatch = content.match(/\[[\s\S]*\]/);
    const jsonString = codeBlockMatch?.[1] || arrayMatch?.[0];

    if (!jsonString) {
      logger.warn(`[FileReviewer] No JSON array found in response for ${filePath}`);
      logger.warn(`[FileReviewer] Response preview: ${content.slice(0, 300)}...`);
      return [];
    }

    try {
      // Try to fix common JSON issues: unescaped newlines in string values
      const fixedJson = fixMalformedJson(jsonString);
      const parsed = JSON.parse(fixedJson);
      const issueArray = Array.isArray(parsed) ? parsed : [];

      return issueArray.map((issue) => ({
        id: this.generateIssueId(filePath, issue),
        file: filePath,
        type: issue.type,
        severity: issue.severity,
        description: issue.description,
        location: this.normalizeLocation(issue.location),
        reasoning: issue.reasoning || '',
        suggestion: issue.suggestion,
        context: issue.context || '',
        confidence: issue.confidence,
        knowledge_source: this.passName,
        priority: this.calculatePriority(issue.severity),
        estimatedEffort: issue.effort || 'medium',
        tags: this.generateTags(issue, filePath),
      }));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown parse error';
      logger.warn(`[FileReviewer] JSON parse error for ${filePath}: ${errorMsg}`);
      logger.warn(`[FileReviewer] JSON preview: ${jsonString.slice(0, 300)}...`);
      return [];
    }
  }

  private normalizeLocation(location: string | { line?: number }): string {
    if (typeof location === 'object') {
      return location.line ? `${location.line}` : '1';
    }
    const numbers = location.match(/\d+/g);
    return numbers ? numbers[0] : '1';
  }

  private generateIssueId(
    filePath: string,
    issue: { description?: string; location?: string | number; line?: string | number },
  ): string {
    const timestamp = Date.now();
    const location = issue.location || issue.line || '1';
    const hash = Math.abs(
      (filePath + (issue.description || '') + location).split('').reduce((a, b) => {
        a = (a << 5) - a + b.charCodeAt(0);
        return a & a;
      }, 0),
    );
    return `${filePath}-L${location}-${timestamp}-${hash}`;
  }

  private calculatePriority(severity: string): number {
    const priorities = {
      critical: 1,
      high: 2,
      medium: 3,
      low: 4,
    };
    return priorities[severity as keyof typeof priorities] || 3;
  }

  private generateTags(issue: { type?: string; severity?: string }, filePath: string): string[] {
    const tags: string[] = [];

    if (issue.type) {
      tags.push(issue.type);
    }

    if (issue.severity) {
      tags.push(issue.severity);
    }

    const ext = filePath.split('.').pop();
    if (ext) {
      tags.push(ext);
    }

    return tags;
  }
}
