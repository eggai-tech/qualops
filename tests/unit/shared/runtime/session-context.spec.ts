import * as fs from 'fs';
import * as path from 'path';

jest.mock('fs');
jest.mock('path');
jest.mock('@/config/buildSessionPath', () => ({
  buildSessionPath: jest.fn((sessionName: string, _reportRoot: string) => ({
    base: () => `/reports/sessions/${sessionName}`,
    analysis: () => `/reports/sessions/${sessionName}/analysis.json`,
    reviewSummary: () => `/reports/sessions/${sessionName}/review-summary.json`,
    fixSummary: () => `/reports/sessions/${sessionName}/fix-suggestions.json`,
    overallReport: () => `/reports/sessions/${sessionName}/overall-report.json`,
    judgeDecision: () => `/reports/sessions/${sessionName}/judge-decision.json`,
    cache: () => `/reports/sessions/${sessionName}/qualops-cache.json`,
    extractLog: () => `/reports/sessions/${sessionName}/extract-log.json`,
    diffReport: () => `/reports/sessions/${sessionName}/diff-report.html`,
    tokenStats: () => `/reports/sessions/${sessionName}/token-stats.json`,
    metadata: () => `/reports/sessions/${sessionName}/metadata.json`,
    sessionReport: () => `/reports/sessions/${sessionName}/report.html`,
    errorLog: (stage: string) => `/reports/sessions/${sessionName}/error-${stage}.json`,
    timingStats: () => `/reports/sessions/${sessionName}/timing-stats.json`,
  })),
}));
jest.mock('@/shared/utils/logger');

const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockReaddirSync = fs.readdirSync as jest.MockedFunction<typeof fs.readdirSync>;
const mockStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;
const mockJoin = path.join as jest.MockedFunction<typeof path.join>;

import { buildSessionPath } from '@/config/buildSessionPath';
import {
  addStageTokenStats,
  getCurrentSession,
  getCurrentSessionPaths,
  getMostRecentSession,
  getTotalTokenStats,
  isSessionInitialized,
  sessionContext,
  setCurrentSession,
} from '@/shared/runtime/session-context';
import { logger } from '@/shared/utils/logger';

const mockBuildSessionPath = buildSessionPath as jest.MockedFunction<typeof buildSessionPath>;

describe('session-context', () => {
  let consoleWarnSpy: jest.SpyInstance;
  let mockProcessCwd: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleWarnSpy = jest.spyOn(logger, 'warn').mockImplementation();
    mockProcessCwd = jest.spyOn(process, 'cwd').mockReturnValue('/test/project');
    sessionContext.reset();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    mockProcessCwd.mockRestore();
  });

  describe('setCurrentSession', () => {
    it('should initialize session context with session name', () => {
      setCurrentSession('test-session');

      expect(isSessionInitialized()).toBe(true);
      expect(getCurrentSession()).toBe('test-session');
    });

    it('should allow multiple calls with same session name', () => {
      setCurrentSession('test-session');
      setCurrentSession('test-session');

      expect(getCurrentSession()).toBe('test-session');
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should warn when overwriting existing session', () => {
      setCurrentSession('session-1');
      setCurrentSession('session-2');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[WARN] Session context already initialized with "session-1", overwriting with "session-2"',
      );
      expect(getCurrentSession()).toBe('session-2');
    });

    it('should reset stage stats when initializing new session', () => {
      setCurrentSession('session-1');
      addStageTokenStats('review', 1, 100, 50, 0, 0.1);

      setCurrentSession('session-2');
      const stats = getTotalTokenStats();

      expect(stats.totalInvocations).toBe(0);
      expect(stats.stages).toHaveLength(0);
    });

    it('should handle empty session name', () => {
      setCurrentSession('');

      expect(isSessionInitialized()).toBe(true);
      expect(getCurrentSession()).toBe('');
    });

    it('should handle session name with special characters', () => {
      const sessionName = 'test-session_2024-01-01';
      setCurrentSession(sessionName);

      expect(getCurrentSession()).toBe(sessionName);
    });
  });

  describe('getCurrentSession', () => {
    it('should return session name after initialization', () => {
      setCurrentSession('test-session');

      expect(getCurrentSession()).toBe('test-session');
    });

    it('should throw error when not initialized', () => {
      expect(() => getCurrentSession()).toThrow(
        'Session context not initialized. Call setCurrentSession() first.',
      );
    });

    it('should return correct session after multiple initializations', () => {
      setCurrentSession('session-1');
      setCurrentSession('session-2');
      setCurrentSession('session-3');

      expect(getCurrentSession()).toBe('session-3');
    });
  });

  describe('getCurrentSessionPaths', () => {
    it('should return session paths after initialization', () => {
      setCurrentSession('test-session');
      const paths = getCurrentSessionPaths();

      expect(mockBuildSessionPath).toHaveBeenCalledWith('test-session', 'reports');
      expect(paths.base()).toBe('/reports/sessions/test-session');
      expect(paths.analysis()).toBe('/reports/sessions/test-session/analysis.json');
    });

    it('should return default paths when not initialized', () => {
      const paths = getCurrentSessionPaths();

      expect(mockBuildSessionPath).toHaveBeenCalledWith('default', 'reports');
      expect(paths.base()).toBe('/reports/sessions/default');
    });

    it('should return paths with error log for specific stage', () => {
      setCurrentSession('test-session');
      const paths = getCurrentSessionPaths();

      expect(paths.errorLog('review')).toBe('/reports/sessions/test-session/error-review.json');
    });

    it('should return all path types correctly', () => {
      setCurrentSession('test-session');
      const paths = getCurrentSessionPaths();

      expect(paths.reviewSummary()).toContain('review-summary.json');
      expect(paths.fixSummary()).toContain('fix-suggestions.json');
      expect(paths.overallReport()).toContain('overall-report.json');
      expect(paths.judgeDecision()).toContain('judge-decision.json');
      expect(paths.cache()).toContain('qualops-cache.json');
      expect(paths.extractLog()).toContain('extract-log.json');
      expect(paths.diffReport()).toContain('diff-report.html');
      expect(paths.tokenStats()).toContain('token-stats.json');
      expect(paths.metadata()).toContain('metadata.json');
      expect(paths.sessionReport()).toContain('report.html');
      expect(paths.timingStats()).toContain('timing-stats.json');
    });
  });

  describe('isSessionInitialized', () => {
    it('should return false before initialization', () => {
      expect(isSessionInitialized()).toBe(false);
    });

    it('should return true after initialization', () => {
      setCurrentSession('test-session');

      expect(isSessionInitialized()).toBe(true);
    });

    it('should return false after reset', () => {
      setCurrentSession('test-session');
      sessionContext.reset();

      expect(isSessionInitialized()).toBe(false);
    });

    it('should return true even with empty session name', () => {
      setCurrentSession('');

      expect(isSessionInitialized()).toBe(true);
    });
  });

  describe('getMostRecentSession', () => {
    beforeEach(() => {
      mockJoin.mockImplementation((...args) => args.join('/'));
    });

    it('should return null when reports directory does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      expect(getMostRecentSession()).toBeNull();
    });

    it('should return null when no sessions exist', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      expect(getMostRecentSession()).toBeNull();
    });

    it('should return most recent session when single session exists', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['session-1'] as any);
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

      expect(getMostRecentSession()).toBe('session-1');
    });

    it('should return most recent session sorted alphabetically', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['session-1', 'session-3', 'session-2'] as any);
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

      expect(getMostRecentSession()).toBe('session-3');
    });

    it('should filter out non-alphanumeric directory names', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['session-1', 'invalid@session', 'session-2'] as any);
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

      expect(getMostRecentSession()).toBe('session-2');
    });

    it('should filter out files and only return directories', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['session-1', 'file.txt', 'session-2'] as any);
      mockStatSync.mockImplementation((p: any) => {
        const path = p.toString();
        return {
          isDirectory: () => !path.includes('file.txt'),
        } as any;
      });

      expect(getMostRecentSession()).toBe('session-2');
    });

    it('should handle statSync errors gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['session-1', 'corrupted', 'session-2'] as any);
      mockStatSync.mockImplementation((p: any) => {
        const path = p.toString();
        if (path.includes('corrupted')) {
          throw new Error('Access denied');
        }
        return { isDirectory: () => true } as any;
      });

      expect(getMostRecentSession()).toBe('session-2');
    });

    it('should accept sessions with hyphens and underscores', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['test-session_2024', 'test-session_2023'] as any);
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

      expect(getMostRecentSession()).toBe('test-session_2024');
    });

    it('should filter out sessions with spaces', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['session-1', 'invalid session', 'session-2'] as any);
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

      expect(getMostRecentSession()).toBe('session-2');
    });

    it('should filter out sessions with dots', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['session-1', 'session.backup', 'session-2'] as any);
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

      expect(getMostRecentSession()).toBe('session-2');
    });

    it('should return session sorted by lexicographic order descending', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['a-session', 'z-session', 'm-session'] as any);
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

      expect(getMostRecentSession()).toBe('z-session');
    });

    it('should use process.cwd() for base path', () => {
      mockExistsSync.mockReturnValue(false);

      getMostRecentSession();

      expect(mockJoin).toHaveBeenCalledWith('/test/project', 'reports', 'sessions');
    });
  });

  describe('addStageTokenStats', () => {
    it('should add stage token stats', () => {
      setCurrentSession('test-session');
      addStageTokenStats('review', 1, 100, 50, 0, 0.1);

      const stats = getTotalTokenStats();
      expect(stats.stages).toHaveLength(1);
      expect(stats.stages[0]).toEqual({
        stage: 'review',
        invocations: 1,
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 0,
        cost: 0.1,
      });
    });

    it('should add multiple stage stats', () => {
      setCurrentSession('test-session');
      addStageTokenStats('review', 1, 100, 50, 0, 0.1);
      addStageTokenStats('fix', 2, 200, 100, 50, 0.2);

      const stats = getTotalTokenStats();
      expect(stats.stages).toHaveLength(2);
    });

    it('should work without session initialization', () => {
      addStageTokenStats('review', 1, 100, 50, 0, 0.1);

      const stats = getTotalTokenStats();
      expect(stats.stages).toHaveLength(1);
    });

    it('should handle zero values', () => {
      addStageTokenStats('review', 0, 0, 0, 0, 0);

      const stats = getTotalTokenStats();
      expect(stats.stages[0]).toEqual({
        stage: 'review',
        invocations: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        cost: 0,
      });
    });

    it('should handle large numbers', () => {
      addStageTokenStats('review', 1000, 1000000, 500000, 250000, 100.5);

      const stats = getTotalTokenStats();
      expect(stats.stages[0]).toEqual({
        stage: 'review',
        invocations: 1000,
        inputTokens: 1000000,
        outputTokens: 500000,
        cachedTokens: 250000,
        cost: 100.5,
      });
    });

    it('should handle negative values', () => {
      addStageTokenStats('review', -1, -100, -50, -25, -0.1);

      const stats = getTotalTokenStats();
      expect(stats.stages[0]).toEqual({
        stage: 'review',
        invocations: -1,
        inputTokens: -100,
        outputTokens: -50,
        cachedTokens: -25,
        cost: -0.1,
      });
    });

    it('should handle fractional costs', () => {
      addStageTokenStats('review', 1, 100, 50, 0, 0.123456789);

      const stats = getTotalTokenStats();
      expect(stats.stages[0].cost).toBe(0.123456789);
    });
  });

  describe('getTotalTokenStats', () => {
    it('should return empty stats when no stages added', () => {
      const stats = getTotalTokenStats();

      expect(stats).toEqual({
        totalInvocations: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedTokens: 0,
        totalCost: 0,
        stages: [],
      });
    });

    it('should calculate totals for single stage', () => {
      addStageTokenStats('review', 1, 100, 50, 25, 0.1);

      const stats = getTotalTokenStats();
      expect(stats.totalInvocations).toBe(1);
      expect(stats.totalInputTokens).toBe(100);
      expect(stats.totalOutputTokens).toBe(50);
      expect(stats.totalCachedTokens).toBe(25);
      expect(stats.totalCost).toBe(0.1);
    });

    it('should calculate totals for multiple stages', () => {
      addStageTokenStats('review', 1, 100, 50, 10, 0.1);
      addStageTokenStats('fix', 2, 200, 100, 20, 0.2);
      addStageTokenStats('analyze', 3, 300, 150, 30, 0.3);

      const stats = getTotalTokenStats();
      expect(stats.totalInvocations).toBe(6);
      expect(stats.totalInputTokens).toBe(600);
      expect(stats.totalOutputTokens).toBe(300);
      expect(stats.totalCachedTokens).toBe(60);
      expect(stats.totalCost).toBeCloseTo(0.6, 10);
    });

    it('should include all stages in stages array', () => {
      addStageTokenStats('review', 1, 100, 50, 0, 0.1);
      addStageTokenStats('fix', 2, 200, 100, 0, 0.2);

      const stats = getTotalTokenStats();
      expect(stats.stages).toHaveLength(2);
      expect(stats.stages[0].stage).toBe('review');
      expect(stats.stages[1].stage).toBe('fix');
    });

    it('should preserve individual stage data', () => {
      addStageTokenStats('review', 5, 500, 250, 100, 1.5);

      const stats = getTotalTokenStats();
      expect(stats.stages[0]).toEqual({
        stage: 'review',
        invocations: 5,
        inputTokens: 500,
        outputTokens: 250,
        cachedTokens: 100,
        cost: 1.5,
      });
    });

    it('should handle floating point precision in cost calculations', () => {
      addStageTokenStats('review', 1, 100, 50, 0, 0.1);
      addStageTokenStats('fix', 1, 100, 50, 0, 0.2);

      const stats = getTotalTokenStats();
      expect(stats.totalCost).toBeCloseTo(0.3, 10);
    });

    it('should return new object on each call', () => {
      addStageTokenStats('review', 1, 100, 50, 0, 0.1);

      const stats1 = getTotalTokenStats();
      const stats2 = getTotalTokenStats();

      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);
    });

    it('should return new stages array on each call', () => {
      addStageTokenStats('review', 1, 100, 50, 0, 0.1);

      const stats1 = getTotalTokenStats();
      const stats2 = getTotalTokenStats();

      expect(stats1.stages).not.toBe(stats2.stages);
      expect(stats1.stages).toEqual(stats2.stages);
    });
  });

  describe('sessionContext.reset', () => {
    it('should reset session name', () => {
      setCurrentSession('test-session');
      sessionContext.reset();

      expect(isSessionInitialized()).toBe(false);
      expect(() => getCurrentSession()).toThrow();
    });

    it('should reset initialized flag', () => {
      setCurrentSession('test-session');
      sessionContext.reset();

      expect(isSessionInitialized()).toBe(false);
    });

    it('should reset stage stats', () => {
      setCurrentSession('test-session');
      addStageTokenStats('review', 1, 100, 50, 0, 0.1);
      sessionContext.reset();

      const stats = getTotalTokenStats();
      expect(stats.totalInvocations).toBe(0);
      expect(stats.stages).toHaveLength(0);
    });

    it('should allow reinitialization after reset', () => {
      setCurrentSession('session-1');
      sessionContext.reset();
      setCurrentSession('session-2');

      expect(isSessionInitialized()).toBe(true);
      expect(getCurrentSession()).toBe('session-2');
    });

    it('should not warn when setting same session after reset', () => {
      setCurrentSession('test-session');
      sessionContext.reset();
      setCurrentSession('test-session');

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete session workflow', () => {
      setCurrentSession('test-session');
      addStageTokenStats('analyze', 1, 100, 50, 0, 0.1);
      addStageTokenStats('review', 2, 200, 100, 50, 0.2);
      addStageTokenStats('fix', 1, 150, 75, 25, 0.15);

      const stats = getTotalTokenStats();
      expect(stats.totalInvocations).toBe(4);
      expect(stats.totalInputTokens).toBe(450);
      expect(stats.totalOutputTokens).toBe(225);
      expect(stats.totalCachedTokens).toBe(75);
      expect(stats.totalCost).toBeCloseTo(0.45, 10);

      const paths = getCurrentSessionPaths();
      expect(paths.base()).toBe('/reports/sessions/test-session');
    });

    it('should handle session switching', () => {
      setCurrentSession('session-1');
      addStageTokenStats('review', 1, 100, 50, 0, 0.1);

      setCurrentSession('session-2');
      addStageTokenStats('review', 2, 200, 100, 0, 0.2);

      const stats = getTotalTokenStats();
      expect(stats.totalInvocations).toBe(2);
      expect(stats.stages).toHaveLength(1);
    });

    it('should handle multiple resets and reinitializations', () => {
      setCurrentSession('session-1');
      addStageTokenStats('review', 1, 100, 50, 0, 0.1);
      sessionContext.reset();

      setCurrentSession('session-2');
      addStageTokenStats('review', 2, 200, 100, 0, 0.2);
      sessionContext.reset();

      setCurrentSession('session-3');
      const stats = getTotalTokenStats();
      expect(stats.stages).toHaveLength(0);
    });

    it('should handle empty session name with stats', () => {
      setCurrentSession('');
      addStageTokenStats('review', 1, 100, 50, 0, 0.1);

      expect(getCurrentSession()).toBe('');
      const stats = getTotalTokenStats();
      expect(stats.stages).toHaveLength(1);
    });

    it('should handle getting paths before and after initialization', () => {
      const pathsBefore = getCurrentSessionPaths();
      expect(pathsBefore.base()).toBe('/reports/sessions/default');

      setCurrentSession('test-session');
      const pathsAfter = getCurrentSessionPaths();
      expect(pathsAfter.base()).toBe('/reports/sessions/test-session');
    });
  });

  describe('edge cases', () => {
    it('should handle very long session names', () => {
      const longName = 'a'.repeat(1000);
      setCurrentSession(longName);

      expect(getCurrentSession()).toBe(longName);
    });

    it('should handle unicode characters in session name', () => {
      const unicodeName = 'session-名前-🎉';
      setCurrentSession(unicodeName);

      expect(getCurrentSession()).toBe(unicodeName);
    });

    it('should handle repeated reset calls', () => {
      setCurrentSession('test-session');
      sessionContext.reset();
      sessionContext.reset();
      sessionContext.reset();

      expect(isSessionInitialized()).toBe(false);
    });

    it('should handle adding stats with same stage multiple times', () => {
      addStageTokenStats('review', 1, 100, 50, 0, 0.1);
      addStageTokenStats('review', 2, 200, 100, 50, 0.2);
      addStageTokenStats('review', 3, 300, 150, 100, 0.3);

      const stats = getTotalTokenStats();
      expect(stats.stages).toHaveLength(3);
      expect(stats.totalInvocations).toBe(6);
    });

    it('should handle getMostRecentSession with empty directory', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      expect(getMostRecentSession()).toBeNull();
    });

    it('should handle getMostRecentSession with only invalid directories', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['invalid@name', 'another.bad', 'bad name'] as any);
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

      expect(getMostRecentSession()).toBeNull();
    });

    it('should handle numeric session names', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['123', '456', '789'] as any);
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

      expect(getMostRecentSession()).toBe('789');
    });
  });

  describe('exported sessionContext object', () => {
    it('should expose initialize method', () => {
      expect(typeof sessionContext.initialize).toBe('function');
    });

    it('should expose getSessionName method', () => {
      expect(typeof sessionContext.getSessionName).toBe('function');
    });

    it('should expose getSessionPaths method', () => {
      expect(typeof sessionContext.getSessionPaths).toBe('function');
    });

    it('should expose isInitialized method', () => {
      expect(typeof sessionContext.isInitialized).toBe('function');
    });

    it('should expose addStageStats method', () => {
      expect(typeof sessionContext.addStageStats).toBe('function');
    });

    it('should expose getTotalStats method', () => {
      expect(typeof sessionContext.getTotalStats).toBe('function');
    });

    it('should expose reset method', () => {
      expect(typeof sessionContext.reset).toBe('function');
    });

    it('should maintain singleton behavior', () => {
      const { sessionContext: imported1 } = require('@/shared/runtime/session-context');
      const { sessionContext: imported2 } = require('@/shared/runtime/session-context');

      expect(imported1).toBe(imported2);
    });
  });
});
