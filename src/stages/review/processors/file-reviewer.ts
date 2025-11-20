import type { AIProvider } from '../../../ai/providers/provider';
import type { ReviewIssue } from '../../../shared/types';
import type { FileInfo } from '../../../shared/types/config';
import { logger } from '../../../shared/utils/logger';
import { globalRateLimiter } from '../utils/global-rate-limiter';
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
Return issues as a JSON array with this schema:

[
  {
    "type": "security|performance|bug|maintainability",
    "severity": "critical|high|medium|low",
    "description": "Brief description of the ACTUAL issue found in the code",
    "location": "line:42",
    "reasoning": "Why this SPECIFIC CODE is problematic (reference actual code patterns)",
    "context": "EXACT code snippet from the file (must match line numbers exactly)",
    "suggestion": "Concrete fix based on the actual code structure",
    "confidence": 8,
    "impact": "What happens if exploited? What NEW capability does attacker gain?",
    "cwe": "CWE-79 (for security issues only, otherwise omit)",
    "threat_model": "What access does attacker need? Do they already have it?"
  }
]

Field Requirements:
- "description": Brief summary of the ACTUAL issue found
- "location": Exact line number(s) where issue exists (e.g., "line:42" or "lines:42-45")
- "reasoning": Explain why THIS SPECIFIC CODE is problematic, not theoretical concerns
- "context": Copy the EXACT problematic code from the file (2-5 lines showing the issue)
- "suggestion": Concrete fix applicable to this specific code
- "confidence": Numerical confidence score (1-10) based on certainty and severity guidelines
- "impact": What happens if this is exploited? What NEW capability beyond current access?
- "cwe": CWE identifier for security issues (e.g., "CWE-79", "CWE-89") - security issues ONLY
- "threat_model": Describe required attacker access and whether they already have it
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

    await globalRateLimiter.throttleApiCall(this.aiProvider.name);

    const response = await this.aiProvider.complete({
      messages,
      maxTokens: this.aiProvider.getMaxTokens(),
      temperature: this.aiProvider.getTemperature(),
    });

    return this.parseIssuesFromResponse(response.content, file.path);
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
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn(`[FileReviewer] No JSON found in response for ${filePath}`);
      return [];
    }

    try {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
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
      logger.error(`[FileReviewer] Failed to parse issues for ${filePath}:`, error);
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
