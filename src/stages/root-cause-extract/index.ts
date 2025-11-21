import { mkdir, readdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

import { getRootCauseByKey, getRootCauseKeys, ROOT_CAUSE_TAXONOMY } from './taxonomy';
import { AIFactory } from '../../ai/providers';
import { addStageTokenStats, getCurrentSessionPaths } from '../../shared/runtime/session-context';
import type { RootCauseMetadata } from '../../shared/types';
import { logger } from '../../shared/utils/logger';
import { isClassificationResultArray, isPathTraversalSafe } from '../../shared/utils/security';

interface IssueForClassification {
  id: string;
  title: string;
  severity: string;
  category: string;
  reasoning: string;
  filePath: string;
}

interface ClassificationResult {
  issueId: string;
  rootCause: string;
  confidence: number;
}

async function readIssuesFromFolder(issuesPath: string): Promise<IssueForClassification[]> {
  const issues: IssueForClassification[] = [];

  try {
    const files = await readdir(issuesPath);
    const issueFiles = files.filter((f) => f.endsWith('.md'));

    for (const file of issueFiles) {
      // Validate filename to prevent path traversal
      if (!isPathTraversalSafe(file)) {
        logger.warn(`Skipping suspicious filename: ${file}`);
        continue;
      }
      const filePath = join(issuesPath, file);
      const content = await readFile(filePath, 'utf-8');

      const issueId = file.replace('.md', '');
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const severityMatch = content.match(/\*\*Severity\*\*:\s*(\w+)/);
      const categoryMatch = content.match(/\*\*Category\*\*:\s*(\w+)/);
      const reasoningMatch = content.match(/##\s+Reasoning\s+([\s\S]+?)(?=##|$)/);

      issues.push({
        id: issueId,
        title: titleMatch?.[1] || issueId,
        severity: severityMatch?.[1] || 'unknown',
        category: categoryMatch?.[1] || 'unknown',
        reasoning: reasoningMatch?.[1]?.trim() || '',
        filePath,
      });
    }
  } catch (error) {
    logger.error(`Failed to read issues from ${issuesPath}: ${error}`);
  }

  return issues;
}

async function classifyIssuesInBatch(
  issues: IssueForClassification[],
  aiProvider: ReturnType<typeof AIFactory.createForStage> extends Promise<infer T> ? T : never,
): Promise<ClassificationResult[]> {
  const taxonomyDescription = ROOT_CAUSE_TAXONOMY.map((rc) => {
    const patterns = rc.patterns.length > 0 ? `\n  Patterns: ${rc.patterns.join(', ')}` : '';
    return `- ${rc.key}: ${rc.label}${patterns}`;
  }).join('\n');

  const issuesForPrompt = issues
    .map((issue) => {
      return `Issue ID: ${issue.id}
Title: ${issue.title}
Severity: ${issue.severity}
Category: ${issue.category}
Reasoning: ${issue.reasoning.substring(0, 500)}`;
    })
    .join('\n\n---\n\n');

  const prompt = `Analyze these code quality issues and classify each into a root cause category.

Root Cause Categories:
${taxonomyDescription}

Rules:
1. Choose the most specific category that matches
2. If multiple categories apply, choose the primary one
3. Use "other" only if no category fits
4. Return confidence 1-10 (10 = very confident)

Issues to classify:
${issuesForPrompt}

Return ONLY a JSON array with this exact format:
[
  {"issueId": "ISSUE-001", "rootCause": "memory_leaks_cleanup", "confidence": 9},
  {"issueId": "ISSUE-002", "rootCause": "security_input_validation", "confidence": 8}
]`;

  try {
    const content = await aiProvider.invoke(prompt, 4000);
    const trimmedContent = content.trim();

    const jsonMatch = trimmedContent.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }

    // Validate JSON structure
    const parsed = JSON.parse(jsonMatch[0]);
    if (!isClassificationResultArray(parsed)) {
      throw new Error('Invalid response structure from AI');
    }
    const results = parsed;

    const validKeys = getRootCauseKeys();
    for (const result of results) {
      // Validate rootCause is in allowed list AND safe for path operations
      if (!validKeys.includes(result.rootCause) || !isPathTraversalSafe(result.rootCause)) {
        logger.warn(`Invalid root cause key "${result.rootCause}" for ${result.issueId}, setting to "other"`);
        result.rootCause = 'other';
      }
    }

    return results;
  } catch (error) {
    logger.error(`Failed to classify batch: ${error}`);
    return issues.map((issue) => ({
      issueId: issue.id,
      rootCause: 'other',
      confidence: 0,
    }));
  }
}

async function moveIssuesToRootCauseFolders(
  classifications: Map<string, ClassificationResult>,
  issuesBasePath: string,
): Promise<void> {
  // First, create all root cause folders
  const uniqueRootCauses = new Set<string>();
  for (const classification of classifications.values()) {
    uniqueRootCauses.add(classification.rootCause);
  }

  // Create folders for all root causes
  for (const rootCause of uniqueRootCauses) {
    const folder = join(issuesBasePath, rootCause);
    try {
      await mkdir(folder, { recursive: true });
    } catch (error) {
      logger.error(`Failed to create folder ${rootCause}: ${error}`);
    }
  }

  // Then move each issue to its folder
  const files = await readdir(issuesBasePath);
  const issueFiles = files.filter((f) => f.endsWith('.md'));

  for (const [issueId, classification] of classifications.entries()) {
    // Find the actual file with full name (includes description)
    const issueFile = issueFiles.find((f) => f.startsWith(`${issueId}-`) || f === `${issueId}.md`);

    if (!issueFile) {
      logger.warn(`Could not find file for ${issueId}, skipping`);
      continue;
    }

    const oldPath = join(issuesBasePath, issueFile);
    const rootCauseFolder = join(issuesBasePath, classification.rootCause);
    const newPath = join(rootCauseFolder, issueFile);

    try {
      await rename(oldPath, newPath);
      logger.info(`Moved ${issueId} to ${classification.rootCause}/`);
    } catch (error) {
      logger.error(`Failed to move ${issueId}: ${error}`);
    }
  }
}

export async function extractRootCauses(): Promise<RootCauseMetadata> {
  logger.start('Starting root cause extraction...');
  const startTime = Date.now();

  const issuesPath = getCurrentSessionPaths().issues();
  const issues = await readIssuesFromFolder(issuesPath);

  if (issues.length === 0) {
    logger.warn('No issues found to classify');
    return {
      timestamp: new Date().toISOString(),
      totalIssues: 0,
      classifications: {},
      taxonomy: ROOT_CAUSE_TAXONOMY,
    };
  }

  logger.info(`Found ${issues.length} issues to classify`);

  const aiProvider = await AIFactory.createForStage('review');
  logger.ai(`Using AI provider: ${aiProvider.name}`);

  const BATCH_SIZE = 10;
  const classifications = new Map<string, ClassificationResult>();

  for (let i = 0; i < issues.length; i += BATCH_SIZE) {
    const batch = issues.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(issues.length / BATCH_SIZE);

    logger.info(`Processing batch ${batchNum}/${totalBatches} (${batch.length} issues)`);

    const results = await classifyIssuesInBatch(batch, aiProvider);

    for (const result of results) {
      classifications.set(result.issueId, result);
    }
  }

  logger.info('Moving issues to root cause folders...');
  await moveIssuesToRootCauseFolders(classifications, issuesPath);

  const byRootCause: Record<string, number> = {};
  for (const classification of classifications.values()) {
    byRootCause[classification.rootCause] = (byRootCause[classification.rootCause] || 0) + 1;
  }

  logger.info('\n[RESULTS] Root Cause Distribution:');
  for (const [rootCause, count] of Object.entries(byRootCause).sort((a, b) => b[1] - a[1])) {
    const taxonomy = getRootCauseByKey(rootCause);
    logger.info(`  - ${taxonomy?.label || rootCause}: ${count}`);
  }

  const metadata: RootCauseMetadata = {
    timestamp: new Date().toISOString(),
    totalIssues: issues.length,
    classifications: Object.fromEntries(classifications.entries()),
    taxonomy: ROOT_CAUSE_TAXONOMY,
    distribution: byRootCause,
  };

  const tokenStats = aiProvider.getTokenStats();
  if (tokenStats) {
    const cachedTokens = (aiProvider as unknown as { cachedTokens?: number }).cachedTokens || 0;
    addStageTokenStats(
      'root-cause-extract',
      tokenStats.invocationCount,
      tokenStats.totalInputTokens,
      tokenStats.totalOutputTokens,
      cachedTokens,
      tokenStats.estimatedCost,
    );
  }

  const duration = Date.now() - startTime;
  logger.timing(`Root cause extraction completed in ${(duration / 1000).toFixed(2)}s`);

  return metadata;
}
