import { executeGitCommand } from './git-utils';
import { shouldProcessFile } from '../../../shared/utils/filters';
import { logger } from '../../../shared/utils/logger';

export interface FileDiff {
  additions: Set<number>;
  deletions: Set<number>;
  modifications: Set<number>;
}

export async function getFileDiff(
  filePath: string,
  base = 'main',
  head = 'HEAD',
): Promise<FileDiff> {
  const diff: FileDiff = {
    additions: new Set<number>(),
    deletions: new Set<number>(),
    modifications: new Set<number>(),
  };

  try {
    const diffOutput = executeGitCommand(['diff', '-U0', `${base}...${head}`, '--', filePath]);
    if (!diffOutput) {
      return diff;
    }

    const lines = diffOutput.split('\n');
    let newLineNumber = 0;

    for (const line of lines) {
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
        if (match) {
          newLineNumber = parseInt(match[1], 10);
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        diff.additions.add(newLineNumber);
        newLineNumber++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        diff.deletions.add(newLineNumber);
      } else if (!line.startsWith('\\')) {
        newLineNumber++;
      }
    }
  } catch (error) {
    logger.warn(
      `Could not get diff for ${filePath}:`,
      error instanceof Error ? error.message : String(error),
    );
  }

  return diff;
}

export async function getChangedFiles(base = 'main', head = 'HEAD'): Promise<string[]> {
  logger.git(`Getting changed files: ${base}..${head}`);

  try {
    const committedFiles = executeGitCommand([
      'diff',
      '--name-only',
      '--diff-filter=ACMRT',
      `${base}...${head}`,
    ]);
    const stagedFiles = executeGitCommand([
      'diff',
      '--cached',
      '--name-only',
      '--diff-filter=ACMRT',
    ]);
    const unstagedFiles = executeGitCommand(['diff', '--name-only', '--diff-filter=ACMRT']);
    const untrackedFiles = executeGitCommand(['ls-files', '--others', '--exclude-standard']);

    const allChangedFiles = [
      ...new Set([
        ...(committedFiles ? committedFiles.split('\n') : []),
        ...(stagedFiles ? stagedFiles.split('\n') : []),
        ...(unstagedFiles ? unstagedFiles.split('\n') : []),
        ...(untrackedFiles ? untrackedFiles.split('\n') : []),
      ]),
    ]
      .filter(Boolean)
      .join('\n');

    if (!allChangedFiles) {
      return [];
    }

    const files = allChangedFiles
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.endsWith('.ts') && !f.includes('node_modules'))
      .filter((f) => shouldProcessFile(f));

    logger.git(`Found ${files.length} changed TypeScript files`);
    return files;
  } catch (error) {
    logger.error(
      'Error getting changed files:',
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}
