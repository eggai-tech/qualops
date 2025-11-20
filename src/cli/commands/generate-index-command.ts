import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { generateDashboardHTML } from './templates/index-dashboard-template';
import { logger } from '../../shared/utils/logger';
import { getDefaultReportRoot } from '../../shared/utils/report-root';

interface IssueStats {
  total: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  byEffort: Record<string, number>;
  byKnowledgeSource: Record<string, number>;
}

interface SessionData {
  sessionName: string;
  projectName: string;
  batch: string;
  timestamp: string | null;
  hasReport: boolean;
  hasDiffReport: boolean;
  issues: IssueStats;
  error: string | null;
}

interface BatchStats {
  name: string;
  sessionCount: number;
  completedSessions: number;
  sessionsWithDiffs: number;
  sessionsWithErrors: number;
  completionRate: number;
  issues: IssueStats;
  sessions: SessionData[];
}

interface Summary {
  metadata: {
    generatedAt: string;
    version: string;
    description: string;
    filter: string | null;
  };
  overall: {
    totalSessions: number;
    completedSessions: number;
    completionRate: number;
    issues: IssueStats;
    generatedAt: string;
  };
  batches: Record<string, BatchStats>;
  allSessions: SessionData[];
}

function parseSessionName(sessionName: string): string {
  const prefixes = ['first-full-', 'full-', 'incremental-'];
  for (const prefix of prefixes) {
    if (sessionName.startsWith(prefix)) {
      return sessionName.substring(prefix.length);
    }
  }
  return sessionName;
}

function determineBatch(projectName: string): string {
  const firstSegment = projectName.split('-')[0];
  return firstSegment || 'other';
}

function analyzeSession(sessionDir: string, sessionsBaseDir: string): SessionData {
  const relativePath = sessionDir.replace(sessionsBaseDir + '/', '');
  const sessionData: SessionData = {
    sessionName: relativePath,
    projectName: '',
    batch: '',
    timestamp: null,
    hasReport: false,
    hasDiffReport: false,
    issues: {
      total: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      byType: { security: 0, maintainability: 0, bug: 0, performance: 0 },
      byEffort: { high: 0, medium: 0, low: 0 },
      byKnowledgeSource: {},
    },
    error: null,
  };

  try {
    const metadataPath = join(sessionDir, 'metadata.json');
    if (existsSync(metadataPath)) {
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
      sessionData.timestamp = metadata.timestamp || null;
    }

    const reviewPath = join(sessionDir, 'review-summary.json');
    if (existsSync(reviewPath)) {
      const reviewData = JSON.parse(readFileSync(reviewPath, 'utf-8'));
      const issues = reviewData.issues || [];
      sessionData.issues.total = issues.length;

      for (const issue of issues) {
        const severity = issue.severity;
        if (severity && severity in sessionData.issues.bySeverity) {
          sessionData.issues.bySeverity[severity]++;
        }

        const type = issue.type;
        if (type && type in sessionData.issues.byType) {
          sessionData.issues.byType[type]++;
        }

        const effort = issue.estimatedEffort;
        if (effort && effort in sessionData.issues.byEffort) {
          sessionData.issues.byEffort[effort]++;
        }

        const knowledgeSource = issue.knowledge_source || '';
        if (knowledgeSource) {
          const category = knowledgeSource.includes(':')
            ? knowledgeSource.split(':')[0].trim()
            : knowledgeSource.trim();
          sessionData.issues.byKnowledgeSource[category] = (sessionData.issues.byKnowledgeSource[category] || 0) + 1;
        }
      }
    }

    sessionData.hasReport = existsSync(join(sessionDir, 'report.html'));
    sessionData.hasDiffReport = existsSync(join(sessionDir, 'diff-report.html'));

    const displayName = relativePath.split('/').pop() || relativePath;
    sessionData.projectName = parseSessionName(displayName);
    sessionData.batch = determineBatch(sessionData.projectName);
  } catch (error) {
    sessionData.error = error instanceof Error ? error.message : String(error);
  }

  return sessionData;
}

function generateBatchStatistics(sessionsByBatch: Record<string, SessionData[]>): Record<string, BatchStats> {
  const batchStats: Record<string, BatchStats> = {};

  for (const [batchName, sessions] of Object.entries(sessionsByBatch)) {
    const completedSessions = sessions.filter((s) => s.hasReport).length;
    const sessionsWithDiffs = sessions.filter((s) => s.hasDiffReport).length;
    const sessionsWithErrors = sessions.filter((s) => s.error).length;

    const totalIssues = sessions.reduce((sum, s) => sum + s.issues.total, 0);
    const issuesBySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    const issuesByType = { security: 0, maintainability: 0, bug: 0, performance: 0 };
    const issuesByEffort = { high: 0, medium: 0, low: 0 };
    const issuesByKnowledgeSource: Record<string, number> = {};

    for (const session of sessions) {
      for (const severity of Object.keys(issuesBySeverity)) {
        issuesBySeverity[severity] += session.issues.bySeverity[severity] || 0;
      }
      for (const type of Object.keys(issuesByType)) {
        issuesByType[type] += session.issues.byType[type] || 0;
      }
      for (const effort of Object.keys(issuesByEffort)) {
        issuesByEffort[effort] += session.issues.byEffort[effort] || 0;
      }
      for (const [source, count] of Object.entries(session.issues.byKnowledgeSource)) {
        issuesByKnowledgeSource[source] = (issuesByKnowledgeSource[source] || 0) + count;
      }
    }

    batchStats[batchName] = {
      name: batchName,
      sessionCount: sessions.length,
      completedSessions,
      sessionsWithDiffs,
      sessionsWithErrors,
      completionRate: sessions.length > 0 ? Math.round((completedSessions / sessions.length) * 100 * 10) / 10 : 0,
      issues: {
        total: totalIssues,
        bySeverity: issuesBySeverity,
        byType: issuesByType,
        byEffort: issuesByEffort,
        byKnowledgeSource: issuesByKnowledgeSource,
      },
      sessions: sessions.sort((a, b) => a.sessionName.localeCompare(b.sessionName)),
    };
  }

  return batchStats;
}

function findSessionDirs(baseDir: string, filter?: string): string[] {
  const dirs: string[] = [];

  function scanDir(dir: string) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      if (!statSync(fullPath).isDirectory()) continue;

      if (existsSync(join(fullPath, 'metadata.json')) || existsSync(join(fullPath, 'review-summary.json'))) {
        dirs.push(fullPath);
      } else {
        scanDir(fullPath);
      }
    }
  }

  if (filter) {
    // Validate filter parameter to prevent path traversal
    const normalizedFilter = filter.replace(/\.\./g, '').replace(/^\//, '');
    const filterPath = join(baseDir, normalizedFilter);
    const resolvedPath = resolve(filterPath);
    const resolvedBase = resolve(baseDir);

    if (!resolvedPath.startsWith(resolvedBase)) {
      logger.error('Invalid filter path: path traversal detected');
      return [];
    }

    if (existsSync(filterPath) && statSync(filterPath).isDirectory()) {
      scanDir(filterPath);
    }
  } else {
    scanDir(baseDir);
  }

  return dirs.filter((path) => !path.toLowerCase().includes('workspace'));
}

export async function generateIndexCommand(options: { reportRoot?: string; filter?: string } = {}): Promise<void> {
  logger.info('🔍 Analyzing QualOps sessions...');

  const reportRootName = options.reportRoot || getDefaultReportRoot();
  const reportRoot = `reports/${reportRootName}`;
  const sessionsDir = join(reportRoot, 'sessions');

  if (!existsSync(sessionsDir)) {
    logger.error(`Sessions directory not found: ${sessionsDir}`);
    logger.error(`Make sure you have run QualOps with --report-root=${reportRootName} first`);
    return;
  }

  const sessionDirs = findSessionDirs(sessionsDir, options.filter);

  if (options.filter) {
    logger.info(`Applying filter: ${options.filter}`);
  }

  logger.info(`📊 Found ${sessionDirs.length} session directories`);

  const allSessions: SessionData[] = [];
  const sessionsByBatch: Record<string, SessionData[]> = {};

  for (const sessionDir of sessionDirs) {
    const sessionName = sessionDir.split('/').pop() || '';
    logger.debug(`Analyzing ${sessionName}...`);
    const sessionData = analyzeSession(sessionDir, sessionsDir);
    allSessions.push(sessionData);

    if (!sessionsByBatch[sessionData.batch]) {
      sessionsByBatch[sessionData.batch] = [];
    }
    sessionsByBatch[sessionData.batch].push(sessionData);
  }

  const batchStats = generateBatchStatistics(sessionsByBatch);

  const completedSessions = allSessions.filter((s) => s.hasReport).length;
  const totalIssues = allSessions.reduce((sum, s) => sum + s.issues.total, 0);

  const overallIssuesBySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  const overallIssuesByType = { security: 0, maintainability: 0, bug: 0, performance: 0 };
  const overallIssuesByEffort = { high: 0, medium: 0, low: 0 };
  const overallIssuesByKnowledgeSource: Record<string, number> = {};

  for (const session of allSessions) {
    for (const severity of Object.keys(overallIssuesBySeverity)) {
      overallIssuesBySeverity[severity] += session.issues.bySeverity[severity] || 0;
    }
    for (const type of Object.keys(overallIssuesByType)) {
      overallIssuesByType[type] += session.issues.byType[type] || 0;
    }
    for (const effort of Object.keys(overallIssuesByEffort)) {
      overallIssuesByEffort[effort] += session.issues.byEffort[effort] || 0;
    }
    for (const [source, count] of Object.entries(session.issues.byKnowledgeSource)) {
      overallIssuesByKnowledgeSource[source] = (overallIssuesByKnowledgeSource[source] || 0) + count;
    }
  }

  const overallStats = {
    totalSessions: allSessions.length,
    completedSessions,
    completionRate: allSessions.length > 0 ? Math.round((completedSessions / allSessions.length) * 100 * 10) / 10 : 0,
    issues: {
      total: totalIssues,
      bySeverity: overallIssuesBySeverity,
      byType: overallIssuesByType,
      byEffort: overallIssuesByEffort,
      byKnowledgeSource: overallIssuesByKnowledgeSource,
    },
    generatedAt: new Date().toISOString(),
  };

  const summary: Summary = {
    metadata: {
      generatedAt: new Date().toISOString(),
      version: '1.0.0',
      description: 'QualOps Reports Index - Comprehensive analysis of all session reports',
      filter: options.filter || null,
    },
    overall: overallStats,
    batches: batchStats,
    allSessions,
  };

  const outputFile = join(reportRoot, 'sessions-summary.json');
  writeFileSync(outputFile, JSON.stringify(summary, null, 2));

  const htmlFile = join(reportRoot, 'index.html');
  const htmlContent = generateDashboardHTML(summary);
  writeFileSync(htmlFile, htmlContent);

  logger.info('');
  logger.info('✅ Analysis complete!');
  logger.info('📈 Overall Statistics:');
  logger.info(`   • Total Sessions: ${overallStats.totalSessions}`);
  logger.info(`   • Completed: ${overallStats.completedSessions} (${overallStats.completionRate}%)`);
  logger.info(`   • Total Issues Found: ${overallStats.issues.total.toLocaleString()}`);

  logger.info('');
  logger.info('🚨 Issues by Severity:');
  for (const [severity, count] of Object.entries(overallStats.issues.bySeverity)) {
    if (count > 0) {
      logger.info(`   • ${severity.charAt(0).toUpperCase() + severity.slice(1)}: ${count.toLocaleString()}`);
    }
  }

  logger.info('');
  logger.info('🔍 Issues by Type:');
  for (const [type, count] of Object.entries(overallStats.issues.byType)) {
    if (count > 0) {
      logger.info(`   • ${type.charAt(0).toUpperCase() + type.slice(1)}: ${count.toLocaleString()}`);
    }
  }

  logger.info('');
  logger.info('📚 Top Knowledge Sources:');
  const topSources = Object.entries(overallStats.issues.byKnowledgeSource)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  for (const [source, count] of topSources) {
    logger.info(`   • ${source}: ${count.toLocaleString()}`);
  }

  logger.info('');
  logger.info('📊 Batches Summary:');
  for (const [batchName, stats] of Object.entries(batchStats)) {
    logger.info(
      `   • ${batchName}: ${stats.sessionCount} sessions, ${stats.completionRate}% complete, ${stats.issues.total} issues`,
    );
  }

  logger.info('');
  logger.info(`💾 Summary saved to: ${outputFile}`);
  logger.info(`📊 Dashboard saved to: ${htmlFile}`);
}
