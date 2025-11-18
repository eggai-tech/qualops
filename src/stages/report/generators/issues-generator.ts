import { diffLines } from 'diff';
import { readFile } from 'node:fs/promises';

import type { ReviewIssue } from '../../../shared/types/index.ts';
import { logger } from '../../../shared/utils/logger.ts';
import {
  generateCodeSection,
  generateDirectoryHeader,
  generateFileHeader,
  generateIssueCard,
} from '../templates/components.ts';
import {
  buildFileTree,
  type FixSuggestion,
  generateSafeId,
  groupIssuesByFile,
  sortDirectoriesByIssues,
} from '../utils/data-transformer.ts';
import { escapeHtml } from '../utils/formatters.ts';

export async function generateIssuesSection(
  issues: ReviewIssue[],
  fixSuggestions: { suggestions: FixSuggestion[] } | null,
  issueIdMap: Map<string, number> = new Map(),
): Promise<string> {
  const fileTree = buildFileTree(issues);
  const sortedDirectories = sortDirectoriesByIssues(fileTree);

  const directorySections = await Promise.all(
    sortedDirectories.map(async ([directory, dirData]) => {
      const dirId = generateSafeId(directory);
      const fileIssues = groupIssuesByFile(dirData.issues);

      const fileSections = await Promise.all(
        Array.from(fileIssues.entries()).map(async ([file, fileIssueList]) => {
          const fileId = generateSafeId(file);
          const fileName = file.split('/').pop() || file;

          const issueSections = await Promise.all(
            fileIssueList.map(async (issue) => {
              const codePreview = await getCodePreview(issue.file || file, issue.location);
              const codeSection = await generateCodeOrFixSection(issue, fixSuggestions, file, codePreview);
              const issueId = issueIdMap.get(issue.id);
              // Validate issueId is a number before passing to template
              const validatedIssueId = typeof issueId === 'number' ? issueId : undefined;
              return await generateIssueCard(issue, codeSection, validatedIssueId);
            }),
          );

          return `
            <div id="file-${fileId}" class="file-section">
              ${generateFileHeader(fileName, fileId, fileIssueList.length)}
              <div class="file-content" id="file-content-${fileId}" style="display: none;">
                ${issueSections.join('')}
              </div>
            </div>
          `;
        }),
      );

      return `
        <div class="directory-section">
          ${generateDirectoryHeader(directory, dirId, dirData.issues)}
          <div class="directory-content" id="dir-content-${dirId}" style="display: none;">
            ${fileSections.join('')}
          </div>
        </div>
      `;
    }),
  );

  return directorySections.join('');
}

async function getCodePreview(filePath: string, location: string): Promise<string> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    const lineMatch = location.match(/(?:line[s]?\s+)?(\d+)(?:-(\d+))?/);

    let startLine = 0;
    let endLine = lines.length - 1;
    let hasSpecificLines = false;

    if (lineMatch) {
      startLine = parseInt(lineMatch[1]) - 1;
      endLine = lineMatch[2] ? parseInt(lineMatch[2]) - 1 : startLine;
      hasSpecificLines = true;

      const contextBefore = 10;
      const contextAfter = 10;
      startLine = Math.max(0, startLine - contextBefore);
      endLine = Math.min(lines.length - 1, endLine + contextAfter);
    }

    if (!hasSpecificLines) {
      startLine = 0;
      endLine = lines.length - 1;
    }

    return lines
      .slice(startLine, endLine + 1)
      .map((line, i) => {
        const actualLineNum = startLine + i + 1;
        const lineNumStr = actualLineNum.toString().padStart(4, ' ');

        if (lineMatch) {
          const issueStart = parseInt(lineMatch[1]);
          const issueEnd = lineMatch[2] ? parseInt(lineMatch[2]) : issueStart;
          const isIssueLine = actualLineNum >= issueStart && actualLineNum <= issueEnd;
          const marker = isIssueLine ? '►' : '│';
          return `${lineNumStr} ${marker} ${line}`;
        }

        return `${lineNumStr} │ ${line}`;
      })
      .join('\n');
  } catch (error) {
    logger.warn(`Failed to read file ${filePath}:`, error);
    return `// Could not load code preview for ${filePath}`;
  }
}

async function generateCodeOrFixSection(
  issue: ReviewIssue,
  fixSuggestions: { suggestions: FixSuggestion[] } | null,
  file: string,
  codePreview: string,
): Promise<string> {
  const fix = fixSuggestions?.suggestions.find((s) => s.issueId === issue.id);

  if (fix) {
    let actualLineNumber = fix.line; // fallback

    try {
      const fileContent = await readFile(fix.file, 'utf-8');
      const fileLines = fileContent.split('\n');
      const originalLines = fix.originalCode.split('\n');

      if (originalLines.length > 0) {
        const firstOriginalLine = originalLines[0].trim();

        for (let i = 0; i < fileLines.length; i++) {
          if (fileLines[i].trim() === firstOriginalLine) {
            let matches = true;
            for (let j = 1; j < Math.min(3, originalLines.length); j++) {
              if (i + j >= fileLines.length || fileLines[i + j].trim() !== originalLines[j].trim()) {
                matches = false;
                break;
              }
            }

            if (matches) {
              actualLineNumber = i + 1; // Convert to 1-based line number
              break;
            }
          }
        }
      }
    } catch (error) {
      logger.warn(`Could not determine actual line number for fix in ${fix.file}:`, error);
    }

    const diff = generateDiff(fix.originalCode, fix.suggestedCode, actualLineNumber);

    return `
    <div class="detail-section">
      <div class="detail-label">Suggested Fix</div>
      <div class="detail-content">${escapeHtml(fix.explanation)}</div>
      <div class="code-section">
        <div class="code-header">
          ${escapeHtml(fix.file)}:line ${actualLineNumber}
          <button class="copy-button" onclick="copyCode(this)">Copy</button>
        </div>
        <div class="code-content">
          ${diff
            .map(
              (line) => `
          <div class="code-line diff-line ${line.type}">
            <div class="line-number">${line.lineNumber || ''}</div>
            <div class="line-content">${escapeHtml(line.content)}</div>
          </div>
          `,
            )
            .join('')}
        </div>
      </div>
    </div>
    `;
  } else {
    return generateCodeSection(file, issue.location, codePreview);
  }
}

function generateDiff(
  original: string,
  suggested: string,
  startLineNumber = 1,
): Array<{ type: 'context' | 'removed' | 'added'; content: string; lineNumber?: number }> {
  const originalLines = original.split('\n');
  const suggestedLines = suggested.split('\n');

  if (originalLines.length === suggestedLines.length) {
    const result = [];
    for (let i = 0; i < originalLines.length; i++) {
      const lineNum = startLineNumber + i;
      if (originalLines[i] !== suggestedLines[i]) {
        result.push({ type: 'removed', content: originalLines[i], lineNumber: lineNum });
        result.push({ type: 'added', content: suggestedLines[i] });
      } else {
        result.push({ type: 'context', content: originalLines[i], lineNumber: lineNum });
      }
    }
    return result;
  }

  const patches = diffLines(original, suggested, { ignoreWhitespace: false });
  const result = [];
  let currentOriginalLine = startLineNumber;

  for (const patch of patches) {
    const lines = patch.value.split('\n');
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }

    if (patch.removed) {
      for (const line of lines) {
        result.push({ type: 'removed', content: line, lineNumber: currentOriginalLine });
        currentOriginalLine++;
      }
    } else if (patch.added) {
      for (const line of lines) {
        result.push({ type: 'added', content: line });
      }
    } else {
      for (const line of lines) {
        result.push({ type: 'context', content: line, lineNumber: currentOriginalLine });
        currentOriginalLine++;
      }
    }
  }

  return result;
}
