import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { getCurrentSessionPaths } from '../../../shared/runtime/session-context';
import { logger } from '../../../shared/utils/logger';

export interface FileWriteOptions {
  encoding?: BufferEncoding;
  createDir?: boolean;
  overwrite?: boolean;
}

export async function writeReportFile(
  fileName: string,
  content: string,
  options: FileWriteOptions = {},
): Promise<string> {
  const {
    encoding = 'utf-8',
    createDir: _createDir = true,
    overwrite: _overwrite = true,
  } = options;

  const sessionPaths = getCurrentSessionPaths();
  const filePath =
    fileName === 'report.html'
      ? sessionPaths.sessionReport()
      : path.join(path.dirname(sessionPaths.sessionReport()), fileName);

  try {
    await writeFile(filePath, content, encoding);
    logger.info(`[FILE] Wrote ${fileName} report to ${filePath}`);
    return filePath;
  } catch (error) {
    logger.error(`[FILE] Failed to write ${fileName}: ${error}`);
    throw error;
  }
}

export async function writeMultipleReports(
  reports: Array<{ fileName: string; content: string; options?: FileWriteOptions }>,
): Promise<string[]> {
  const writePromises = reports.map(({ fileName, content, options }) =>
    writeReportFile(fileName, content, options),
  );

  try {
    const filePaths = await Promise.all(writePromises);
    logger.info(`[FILE] Successfully wrote ${reports.length} report files`);
    return filePaths;
  } catch (error) {
    logger.error(`[FILE] Failed to write some report files: ${error}`);
    throw error;
  }
}

export async function writeHTMLReport(htmlContent: string): Promise<string> {
  const fileName = 'report.html';
  return writeReportFile(fileName, htmlContent, {
    encoding: 'utf-8',
    createDir: true,
  });
}

export async function writeJSONReport(jsonData: unknown): Promise<string> {
  const fileName = 'report.json';
  const content = JSON.stringify(jsonData, null, 2);
  return writeReportFile(fileName, content, {
    encoding: 'utf-8',
    createDir: true,
  });
}

export async function writeCSVReport(csvContent: string, type = 'issues'): Promise<string> {
  const fileName = `${type}.csv`;
  return writeReportFile(fileName, csvContent, {
    encoding: 'utf-8',
    createDir: true,
  });
}

export async function writeMarkdownReport(markdownContent: string): Promise<string> {
  const fileName = 'report.md';
  return writeReportFile(fileName, markdownContent, {
    encoding: 'utf-8',
    createDir: true,
  });
}

export async function writeCIReport(ciData: unknown): Promise<string> {
  const fileName = 'ci-report.json';
  const content = JSON.stringify(ciData, null, 2);
  return writeReportFile(fileName, content, {
    encoding: 'utf-8',
    createDir: true,
  });
}

export function getFileSizeSummary(content: string): string {
  const sizeInBytes = Buffer.byteLength(content, 'utf-8');
  const sizeInKB = (sizeInBytes / 1024).toFixed(2);
  return `${sizeInKB} KB (${sizeInBytes} bytes)`;
}

export function validateContent(
  content: string,
  type: 'json' | 'html' | 'csv' | 'markdown',
): boolean {
  if (!content || content.trim().length === 0) {
    return false;
  }

  switch (type) {
    case 'json':
      try {
        JSON.parse(content);
        return true;
      } catch {
        return false;
      }
    case 'html':
      return content.includes('<html') || content.includes('<!DOCTYPE');
    case 'csv':
      return content.includes(',') || content.includes('\n');
    case 'markdown':
      return content.includes('#') || content.includes('**') || content.includes('*');
    default:
      return true;
  }
}
