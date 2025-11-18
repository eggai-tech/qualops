import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FixSuggestion } from '../../../shared/types/index.ts';
import { logger } from '../../../shared/utils/logger.ts';

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber?: number;
}

export function generateUnifiedDiff(original: string, modified: string): string {
  try {
    const tempDir = mkdtempSync(join(tmpdir(), 'qualops-'));
    const originalFile = join(tempDir, 'original.ts');
    const modifiedFile = join(tempDir, 'modified.ts');

    writeFileSync(originalFile, original);
    writeFileSync(modifiedFile, modified);

    const result = spawnSync('git', ['diff', '--no-index', '--no-color', '-U5', '--', originalFile, modifiedFile], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      shell: false,
    });

    try {
      if (existsSync(originalFile)) unlinkSync(originalFile);
      if (existsSync(modifiedFile)) unlinkSync(modifiedFile);
      if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      logger.warn('Failed to clean temporary files:', cleanupError);
    }

    return result.stdout || '';
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error) {
      return String(error.stdout);
    }
    return simpleTextDiff(original, modified);
  }
}

function simpleTextDiff(original: string, modified: string): string {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');
  const diff: string[] = [];
  const maxLines = Math.max(originalLines.length, modifiedLines.length);

  for (let i = 0; i < maxLines; i++) {
    const origLine = originalLines[i];
    const modLine = modifiedLines[i];

    if (origLine === modLine) {
      diff.push(` ${origLine || ''}`);
    } else if (origLine && !modLine) {
      diff.push(`-${origLine}`);
    } else if (!origLine && modLine) {
      diff.push(`+${modLine}`);
    } else {
      diff.push(`-${origLine}`);
      diff.push(`+${modLine}`);
    }
  }

  return diff.join('\n');
}

function parseUnifiedDiff(diffText: string): DiffLine[] {
  const lines = diffText.split('\n');
  const result: DiffLine[] = [];

  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('diff ')) {
      continue;
    }

    if (line.startsWith('+')) {
      result.push({ type: 'add', content: line.substring(1) });
    } else if (line.startsWith('-')) {
      result.push({ type: 'remove', content: line.substring(1) });
    } else if (line.length > 0) {
      result.push({ type: 'context', content: line.substring(1) });
    }
  }

  return result;
}

export async function generateDiffHTML(fixes: FixSuggestion[], outputPath: string): Promise<void> {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QualOps Fix Diff Report</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    .fix-item {
      background: white;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .fix-header {
      background: #f8f9fa;
      padding: 15px 20px;
      border-bottom: 1px solid #e9ecef;
    }
    .fix-file {
      font-weight: 600;
      color: #333;
      margin-bottom: 5px;
    }
    .fix-meta {
      font-size: 14px;
      color: #666;
    }
    .confidence-high { color: #28a745; }
    .confidence-medium { color: #ffc107; }
    .confidence-low { color: #dc3545; }
    .breaking { color: #dc3545; font-weight: bold; }
    .fix-explanation {
      padding: 15px 20px;
      background: #e8f4f9;
      border-bottom: 1px solid #e9ecef;
      font-size: 14px;
    }
    .diff-container {
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 13px;
      line-height: 1.5;
      overflow-x: auto;
    }
    .diff-line {
      padding: 2px 10px;
      white-space: pre;
    }
    .diff-add {
      background: #e6ffed;
      color: #24292e;
    }
    .diff-remove {
      background: #ffeef0;
      color: #24292e;
    }
    .diff-context {
      background: white;
      color: #586069;
    }
    .no-fixes {
      text-align: center;
      padding: 60px 20px;
      color: #666;
    }
    h1 {
      margin-bottom: 30px;
      color: #333;
    }
    .summary {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .summary-stat {
      display: inline-block;
      margin-right: 30px;
      font-size: 16px;
    }
    .summary-stat strong {
      color: #333;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>QualOps Fix Diff Report</h1>

    <div class="summary">
      <div class="summary-stat">
        <strong>Total Fixes:</strong> ${fixes.length}
      </div>
      <div class="summary-stat">
        <strong>High Confidence:</strong> ${fixes.filter((f) => f.confidence === 'high').length}
      </div>
      <div class="summary-stat">
        <strong>Breaking Changes:</strong> ${fixes.filter((f) => f.breaking).length}
      </div>
      <div class="summary-stat">
        <strong>Applied:</strong> ${fixes.filter((f) => f.applied).length}
      </div>
    </div>

    ${fixes.length === 0 ? '<div class="no-fixes">No fixes generated</div>' : ''}

    ${fixes
      .map((fix) => {
        const diff = generateUnifiedDiff(fix.originalCode || '', fix.suggestedCode || '');
        const diffLines = parseUnifiedDiff(diff);

        return `
        <div class="fix-item">
          <div class="fix-header">
            <div class="fix-file">${fix.file}</div>
            <div class="fix-meta">
              Line ${fix.line} •
              <span class="confidence-${fix.confidence}">${fix.confidence} confidence</span>
              ${fix.breaking ? ' • <span class="breaking">Breaking Change</span>' : ''}
              ${fix.applied ? ' • ✅ Applied' : ''}
            </div>
          </div>
          ${fix.explanation ? `<div class="fix-explanation">${fix.explanation}</div>` : ''}
          <div class="diff-container">
            ${diffLines
              .map((line) => `<div class="diff-line diff-${line.type}">${escapeHtml(line.content)}</div>`)
              .join('')}
          </div>
        </div>
      `;
      })
      .join('')}
  </div>
</body>
</html>
  `;

  await writeFile(outputPath, html, 'utf-8');
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}
