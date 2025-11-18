import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { logger } from '../../shared/utils/logger.ts';

const UNIFIED_DOCS_PATH = join(process.cwd(), '.qualops/unified-docs');
const SPLIT_DOCS_PATH = join(process.cwd(), '.qualops/docs');
const MAX_CHUNK_SIZE = 350000;

export async function executeDownloadDocsStage(): Promise<void> {
  mkdirSync(UNIFIED_DOCS_PATH, { recursive: true });
  rmSync(SPLIT_DOCS_PATH, { recursive: true, force: true });
  mkdirSync(SPLIT_DOCS_PATH, { recursive: true });

  await downloadAndSplit('angular', 'angular-llm-context.md', 'https://angular.dev/context/llm-files/llms-full.txt');
  await downloadAndSplit('ngrx', 'ngrx-llm-context.md', 'https://context7.com/ngrx/platform/llms.txt');
  await downloadAndSplit('rxjs', 'rxjs-llm-context.md', 'https://context7.com/reactivex/rxjs/llms.txt');
  await downloadOwaspDocs();
  await createAdrContext();

  const totalSize = await getDirectorySize(SPLIT_DOCS_PATH);
  logger.info(`Documentation ready in .qualops/docs (${formatSize(totalSize)})`);
}

async function downloadAndSplit(subdir: string, filename: string, url: string): Promise<void> {
  const unifiedDir = join(UNIFIED_DOCS_PATH, subdir);
  const unifiedFile = join(unifiedDir, filename);

  mkdirSync(unifiedDir, { recursive: true });

  const response = await fetch(url);
  const content = await response.text();
  writeFileSync(unifiedFile, content);

  const stats = statSync(unifiedFile);
  const baseName = filename.replace('-llm-context.md', '');

  if (stats.size <= MAX_CHUNK_SIZE) {
    writeFileSync(join(SPLIT_DOCS_PATH, `${baseName}.md`), content);
    logger.info(`${baseName}: ${formatSize(stats.size)} (single file)`);
    return;
  }

  const chunks = Math.ceil(stats.size / MAX_CHUNK_SIZE);

  for (let i = 0; i < chunks; i++) {
    const start = i * MAX_CHUNK_SIZE;
    const end = Math.min((i + 1) * MAX_CHUNK_SIZE, content.length);
    const chunk = content.slice(start, end);

    writeFileSync(join(SPLIT_DOCS_PATH, `${baseName}-${i + 1}.md`), chunk);
  }

  logger.info(`${baseName}: ${formatSize(stats.size)} (split into ${chunks} parts)`);
}

async function downloadOwaspDocs(): Promise<void> {
  const owaspDir = join(UNIFIED_DOCS_PATH, 'owasp');
  mkdirSync(owaspDir, { recursive: true });

  const cheatSheets = [
    'Cross_Site_Scripting_Prevention_Cheat_Sheet.md',
    'DOM_based_XSS_Prevention_Cheat_Sheet.md',
    'HTML5_Security_Cheat_Sheet.md',
    'Input_Validation_Cheat_Sheet.md',
    'Injection_Prevention_Cheat_Sheet.md',
    'Content_Security_Policy_Cheat_Sheet.md',
    'Session_Management_Cheat_Sheet.md',
    'Authentication_Cheat_Sheet.md',
    'Authorization_Cheat_Sheet.md',
    'Clickjacking_Defense_Cheat_Sheet.md',
    'Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.md',
    'JSON_Web_Token_for_Java_Cheat_Sheet.md',
    'REST_Security_Cheat_Sheet.md',
    'Web_Service_Security_Cheat_Sheet.md',
    'Transport_Layer_Protection_Cheat_Sheet.md',
    'Logging_Cheat_Sheet.md',
    'Error_Handling_Cheat_Sheet.md',
    'Secure_Coding_Practices_Cheat_Sheet.md',
    'Third_Party_Javascript_Management_Cheat_Sheet.md',
    'Nodejs_Security_Cheat_Sheet.md',
  ];

  const owaspBase = 'https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets';

  for (const sheet of cheatSheets) {
    const filename = sheet.replace('_Cheat_Sheet.md', '.md');
    const filePath = join(owaspDir, filename);
    const response = await fetch(`${owaspBase}/${sheet}`);
    const content = await response.text();
    writeFileSync(filePath, content);
  }

  const contextFile = join(owaspDir, 'owasp-security-context.md');
  let contextContent = `# OWASP Security Cheat Sheets - Complete Reference

Generated on: ${new Date().toISOString()}

`;

  const files = readdirSync(owaspDir)
    .filter((file) => file.endsWith('.md') && file !== 'owasp-security-context.md')
    .sort();

  for (const file of files) {
    const filePath = join(owaspDir, file);
    const content = readFileSync(filePath, 'utf-8');
    contextContent += `\n\n# === ${file} ===\n\n${content}\n\n---`;
  }

  writeFileSync(contextFile, contextContent);

  const stats = statSync(contextFile);
  const chunks = Math.ceil(stats.size / MAX_CHUNK_SIZE);

  if (chunks === 1) {
    writeFileSync(join(SPLIT_DOCS_PATH, 'owasp.md'), contextContent);
    logger.info(`owasp: ${formatSize(stats.size)} (single file)`);
    return;
  }

  for (let i = 0; i < chunks; i++) {
    const start = i * MAX_CHUNK_SIZE;
    const end = Math.min((i + 1) * MAX_CHUNK_SIZE, contextContent.length);
    const chunk = contextContent.slice(start, end);

    writeFileSync(join(SPLIT_DOCS_PATH, `owasp-${i + 1}.md`), chunk);
  }

  logger.info(`owasp: ${formatSize(stats.size)} (split into ${chunks} parts)`);
}

async function createAdrContext(): Promise<void> {
  const adrSourceDir = 'docs/architecture-decisions';
  const adrUnifiedDir = join(UNIFIED_DOCS_PATH, 'architecture');
  const adrUnifiedFile = join(adrUnifiedDir, 'adr-context.md');

  mkdirSync(adrUnifiedDir, { recursive: true });

  let contextContent = `# Architecture Decision Records (ADRs)

Generated on: ${new Date().toISOString()}

---

`;

  const adrFiles = readdirSync(adrSourceDir)
    .filter((file) => file.endsWith('.md'))
    .sort();

  for (const file of adrFiles) {
    const content = readFileSync(join(adrSourceDir, file), 'utf-8');
    contextContent += `\n# === ${file} ===\n\n${content}\n\n---\n`;
  }

  writeFileSync(adrUnifiedFile, contextContent);
  writeFileSync(join(SPLIT_DOCS_PATH, 'adr-context.md'), contextContent);

  const stats = statSync(adrUnifiedFile);
  logger.info(`adr-context: ${formatSize(stats.size)} (single file)`);
}

async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;

  function calculateSize(currentPath: string): void {
    const stats = statSync(currentPath);

    if (stats.isDirectory()) {
      const files = readdirSync(currentPath);
      for (const file of files) {
        calculateSize(join(currentPath, file));
      }
    } else {
      totalSize += stats.size;
    }
  }

  calculateSize(dirPath);
  return totalSize;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))}${sizes[i]}`;
}
