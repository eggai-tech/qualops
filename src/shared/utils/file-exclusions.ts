import { minimatch } from 'minimatch';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Use a different name to avoid conflict with Jest's global __dirname
const moduleDir = typeof __dirname !== 'undefined' ? __dirname : dirname(__filename);

export interface FileExclusionResult {
  shouldSkip: boolean;
  confidencePenalty: number;
  reason?: string;
}

class FileExclusionChecker {
  private skipPatterns: string[];
  private penaltyPatterns: Map<string, { penalty: number; reason: string }>;

  constructor() {
    this.skipPatterns = [];
    this.penaltyPatterns = new Map();
    this.loadExclusions();
  }

  private loadExclusions(): void {
    try {
      const exclusionsPath = join(moduleDir, '../config/file-exclusions.md');
      const content = readFileSync(exclusionsPath, 'utf-8');

      let currentSection = '';
      const lines = content.split('\n');

      for (const line of lines) {
        if (line.startsWith('## ')) {
          currentSection = line.substring(3).trim();
          continue;
        }

        if (line.startsWith('- `') && line.includes('`')) {
          const pattern = line.match(/`([^`]+)`/)?.[1];
          if (!pattern) continue;

          if (currentSection === 'Generated Files' || currentSection === 'Third-Party and Examples') {
            this.skipPatterns.push(pattern);
          } else if (currentSection === 'Test and Mock Files') {
            this.penaltyPatterns.set(pattern, {
              penalty: 0.5,
              reason: 'Test/mock file',
            });
          } else if (currentSection === 'Configuration Files') {
            this.penaltyPatterns.set(pattern, {
              penalty: 0.2,
              reason: 'Configuration file',
            });
          }
        }
      }
    } catch {
      this.loadDefaults();
    }
  }

  private loadDefaults(): void {
    this.skipPatterns = [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.angular/**',
      '**/.qualops/**',
      '**/*.generated.ts',
      '**/*.g.ts',
    ];

    this.penaltyPatterns.set('**/*.spec.ts', { penalty: 0.5, reason: 'Test file' });
    this.penaltyPatterns.set('**/*.test.ts', { penalty: 0.5, reason: 'Test file' });
    this.penaltyPatterns.set('**/*.mock.ts', { penalty: 0.5, reason: 'Mock file' });
    this.penaltyPatterns.set('**/*.config.ts', { penalty: 0.2, reason: 'Config file' });
  }

  check(filePath: string): FileExclusionResult {
    for (const pattern of this.skipPatterns) {
      if (minimatch(filePath, pattern, { dot: true })) {
        return {
          shouldSkip: true,
          confidencePenalty: 0,
          reason: `File matches skip pattern: ${pattern}`,
        };
      }
    }

    for (const [pattern, config] of this.penaltyPatterns) {
      if (minimatch(filePath, pattern, { dot: true })) {
        return {
          shouldSkip: false,
          confidencePenalty: config.penalty,
          reason: config.reason,
        };
      }
    }

    return {
      shouldSkip: false,
      confidencePenalty: 0,
    };
  }

  applyPenalty<T extends { confidence: number; notes?: string }>(issues: T[], filePath: string): T[] {
    const exclusion = this.check(filePath);

    if (exclusion.confidencePenalty > 0) {
      return issues.map((issue) => ({
        ...issue,
        confidence: issue.confidence * (1 - exclusion.confidencePenalty),
        notes: `${issue.notes || ''} [Confidence reduced: ${exclusion.reason}]`.trim(),
      }));
    }

    return issues;
  }
}

// Singleton instance
export const fileExclusions = new FileExclusionChecker();
