import * as fs from 'fs';
import * as path from 'path';

import { buildSessionPath } from '../../config/buildSessionPath';
import { logger } from '../utils/logger';

interface StageTokenStats {
  stage: string;
  invocations: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost: number;
}

class SessionContext {
  private sessionName = '';
  private reportRoot?: string;
  private initialized = false;
  private stageStats: StageTokenStats[] = [];

  initialize(sessionName: string, reportRoot?: string): void {
    if (this.initialized && this.sessionName !== sessionName) {
      logger.warn(
        `[WARN] Session context already initialized with "${this.sessionName}", overwriting with "${sessionName}"`,
      );
    }
    this.sessionName = sessionName;
    this.reportRoot = reportRoot;
    this.initialized = true;
    this.stageStats = [];
  }

  getSessionName(): string {
    if (!this.initialized) {
      throw new Error('Session context not initialized. Call setCurrentSession() first.');
    }
    return this.sessionName;
  }

  getSessionPaths() {
    if (!this.initialized) {
      return buildSessionPath('default', 'reports');
    }
    return buildSessionPath(this.getSessionName(), this.reportRoot ?? 'reports');
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  addStageStats(stats: StageTokenStats): void {
    this.stageStats.push(stats);
  }

  getTotalStats() {
    return this.stageStats.reduce(
      (acc, stat) => ({
        totalInvocations: acc.totalInvocations + stat.invocations,
        totalInputTokens: acc.totalInputTokens + stat.inputTokens,
        totalOutputTokens: acc.totalOutputTokens + stat.outputTokens,
        totalCachedTokens: acc.totalCachedTokens + stat.cachedTokens,
        totalCost: acc.totalCost + stat.cost,
        stages: [...acc.stages, stat],
      }),
      {
        totalInvocations: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedTokens: 0,
        totalCost: 0,
        stages: [] as StageTokenStats[],
      },
    );
  }

  reset(): void {
    this.sessionName = '';
    this.reportRoot = undefined;
    this.initialized = false;
    this.stageStats = [];
  }
}

const sessionContext = new SessionContext();
export function setCurrentSession(sessionName: string, reportRoot?: string): void {
  sessionContext.initialize(sessionName, reportRoot);
}

export function getCurrentSession(): string {
  return sessionContext.getSessionName();
}

export function getCurrentSessionPaths() {
  return sessionContext.getSessionPaths();
}

export function isSessionInitialized(): boolean {
  return sessionContext.isInitialized();
}

export function getMostRecentSession(): string | null {
  const reportsDir = path.join(process.cwd(), 'reports', 'sessions');

  if (!fs.existsSync(reportsDir)) {
    return null;
  }

  const sessions = fs
    .readdirSync(reportsDir)
    .filter((dir: string) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(dir)) {
        return false;
      }
      try {
        const fullPath = path.join(reportsDir, dir);
        return fs.statSync(fullPath).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a: string, b: string) => b.localeCompare(a));

  return sessions.length > 0 ? sessions[0] : null;
}

export function addStageTokenStats(
  stage: string,
  invocations: number,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  cost: number,
): void {
  sessionContext.addStageStats({ stage, invocations, inputTokens, outputTokens, cachedTokens, cost });
}

export function getTotalTokenStats() {
  return sessionContext.getTotalStats();
}

export { sessionContext };
export type { StageTokenStats };
