import { AIFactory } from '@/ai/providers';
import { ConfigService } from '@/config/config';
import { addStageTokenStats, getCurrentSessionPaths } from '@/shared/runtime/session-context';
import type { FixMetadata, ReviewMetadata } from '@/shared/types';
import { readMetadataFile, writeMetadataFile } from '@/shared/utils/file-utils';
import { logger } from '@/shared/utils/logger';
import { generateFixes } from '@/stages/fix';
import { applySafeFixes } from '@/stages/fix/appliers/fix-applier';
import { generateFix } from '@/stages/fix/generators/fix-generator';
import { generateDiffHTML } from '@/stages/fix/utils/diff-visualizer';
import { createFixBatchRollbackPoint } from '@/stages/fix/utils/rollback-manager';

jest.mock('@/ai/providers');
jest.mock('@/config/config');
jest.mock('@/shared/runtime/session-context');
jest.mock('@/shared/utils/file-utils');
jest.mock('@/shared/utils/logger');
jest.mock('@/stages/fix/appliers/fix-applier');
jest.mock('@/stages/fix/generators/fix-generator');
jest.mock('@/stages/fix/utils/diff-visualizer');
jest.mock('@/stages/fix/utils/rollback-manager');

const mockAIFactory = AIFactory as jest.Mocked<typeof AIFactory>;
const mockConfigService = ConfigService as jest.Mocked<typeof ConfigService>;
const mockGetCurrentSessionPaths = getCurrentSessionPaths as jest.MockedFunction<
  typeof getCurrentSessionPaths
>;
const mockAddStageTokenStats = addStageTokenStats as jest.MockedFunction<typeof addStageTokenStats>;
const mockReadMetadataFile = readMetadataFile as jest.MockedFunction<typeof readMetadataFile>;
const mockWriteMetadataFile = writeMetadataFile as jest.MockedFunction<typeof writeMetadataFile>;
const mockApplySafeFixes = applySafeFixes as jest.MockedFunction<typeof applySafeFixes>;
const mockGenerateFix = generateFix as jest.MockedFunction<typeof generateFix>;
const mockGenerateDiffHTML = generateDiffHTML as jest.MockedFunction<typeof generateDiffHTML>;
const mockCreateFixBatchRollbackPoint = createFixBatchRollbackPoint as jest.MockedFunction<
  typeof createFixBatchRollbackPoint
>;

describe('generateFixes', () => {
  const mockPaths = {
    analysis: jest.fn().mockReturnValue('/session/analysis.json'),
    reviewSummary: jest.fn().mockReturnValue('/session/review.json'),
    fixSummary: jest.fn().mockReturnValue('/session/fix.json'),
    overallReport: jest.fn().mockReturnValue('/session/report.json'),
    diffReport: jest.fn().mockReturnValue('/session/diff.html'),
    judgeDecision: jest.fn().mockReturnValue('/session/judge.json'),
    htmlReport: jest.fn().mockReturnValue('/session/report.html'),
  };

  let mockAIProvider: any;
  let mockConfigInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetCurrentSessionPaths.mockReturnValue(mockPaths as any);
    mockWriteMetadataFile.mockResolvedValue();
    mockGenerateDiffHTML.mockResolvedValue();

    mockAIProvider = {
      name: 'test-provider',
      getTokenStats: jest.fn().mockReturnValue({
        totalInputTokens: 2000,
        totalOutputTokens: 1000,
        totalTokens: 3000,
        invocationCount: 10,
        estimatedCost: 0.1,
      }),
    };
    mockAIFactory.createForStage = jest.fn().mockResolvedValue(mockAIProvider);

    mockConfigInstance = {
      getAll: jest.fn().mockReturnValue({
        fix: {
          maxConcurrentFixes: 3,
        },
      }),
    };
    mockConfigService.getInstance = jest.fn().mockReturnValue(mockConfigInstance);
  });

  describe('existing fix', () => {
    it('should return existing fix if found', async () => {
      const existingFix: FixMetadata = {
        timestamp: '2024-01-01T00:00:00Z',
        issuesProcessed: 5,
        suggestions: [],
        summary: {
          totalSuggestions: 0,
          highConfidence: 0,
          mediumConfidence: 0,
          lowConfidence: 0,
          breaking: 0,
          applied: 0,
        },
      };
      mockReadMetadataFile.mockResolvedValue(existingFix);

      const result = await generateFixes();

      expect(result).toEqual(existingFix);
      expect(logger.info).toHaveBeenCalledWith(
        'Fix stage already completed - using existing results',
      );
    });
  });

  describe('prerequisites', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.fixSummary()) return null;
        return {} as any;
      });
    });

    it('should throw error if no review metadata found', async () => {
      mockReadMetadataFile.mockResolvedValue(null);

      await expect(generateFixes()).rejects.toThrow(
        'No review metadata found. Run review stage first.',
      );
    });

    it('should handle empty issues', async () => {
      const reviewData: ReviewMetadata = {
        timestamp: '2024-01-01',
        filesReviewed: 5,
        projectsReviewed: 2,
        issues: [],
        summary: {
          totalIssues: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          byType: { bug: 0, security: 0, performance: 0, maintainability: 0 },
        },
      };

      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.fixSummary()) return null;
        if (path === mockPaths.reviewSummary()) return reviewData;
        return null;
      });

      const result = await generateFixes();

      expect(result.suggestions).toEqual([]);
      expect(result.summary.totalSuggestions).toBe(0);
      expect(mockGenerateFix).not.toHaveBeenCalled();
    });
  });

  describe('fix generation', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.fixSummary()) return null;
        if (path === mockPaths.reviewSummary())
          return {
            timestamp: '2024-01-01',
            filesReviewed: 2,
            projectsReviewed: 1,
            issues: [
              {
                id: '1',
                file: 'file1.ts',
                type: 'bug',
                severity: 'high',
                confidence: 90,
                description: 'Test issue',
                location: 'file1.ts:10',
                reasoning: 'Test',
                suggestion: 'Fix',
                context: 'Test context',
              },
            ],
            summary: {
              totalIssues: 1,
              critical: 0,
              high: 1,
              medium: 0,
              low: 0,
              byType: { bug: 1, security: 0, performance: 0, maintainability: 0 },
            },
          };
        return null;
      });
    });

    it('should generate fixes for high severity issues', async () => {
      const fixSuggestion = {
        issueId: '1',
        file: 'file1.ts',
        line: 10,
        originalCode: 'old code',
        suggestedCode: 'fixed code',
        explanation: 'Fix the bug',
        confidence: 'high' as const,
        breaking: false,
        applied: false,
      };

      mockGenerateFix.mockResolvedValue(fixSuggestion);

      const result = await generateFixes({ dryRun: true });

      expect(result.suggestions).toHaveLength(1);
      expect(mockGenerateFix).toHaveBeenCalled();
    });

    it('should filter issues by confidence threshold', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.fixSummary()) return null;
        if (path === mockPaths.reviewSummary())
          return {
            timestamp: '2024-01-01',
            filesReviewed: 2,
            projectsReviewed: 1,
            issues: [
              {
                id: '1',
                file: 'file1.ts',
                type: 'bug',
                severity: 'high',
                confidence: 5,
                description: 'Low confidence issue',
                location: 'file1.ts:10',
                reasoning: 'Test',
                suggestion: 'Fix',
                context: 'Test context',
              },
            ],
            summary: {
              totalIssues: 1,
              critical: 0,
              high: 1,
              medium: 0,
              low: 0,
              byType: { bug: 1, security: 0, performance: 0, maintainability: 0 },
            },
          };
        return null;
      });

      mockGenerateFix.mockResolvedValue({
        issueId: '1',
        file: 'file1.ts',
        line: 10,
        originalCode: 'old',
        suggestedCode: 'fixed',
        explanation: 'Fix',
        confidence: 'high' as const,
        breaking: false,
        applied: false,
      });

      const result = await generateFixes({ dryRun: true });

      expect(result.suggestions).toHaveLength(0);
    });

    it('should skip ESLint issues', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.fixSummary()) return null;
        if (path === mockPaths.reviewSummary())
          return {
            timestamp: '2024-01-01',
            filesReviewed: 2,
            projectsReviewed: 1,
            issues: [
              {
                id: '1',
                file: 'file1.ts',
                type: 'bug',
                severity: 'high',
                confidence: 90,
                description: 'ESLint issue',
                location: 'file1.ts:10',
                reasoning: 'Test',
                suggestion: 'Fix',
                context: '[ESLint] semi',
              },
            ],
            summary: {
              totalIssues: 1,
              critical: 0,
              high: 1,
              medium: 0,
              low: 0,
              byType: { bug: 1, security: 0, performance: 0, maintainability: 0 },
            },
          };
        return null;
      });

      mockGenerateFix.mockResolvedValue({
        issueId: '1',
        file: 'file1.ts',
        line: 10,
        originalCode: 'old',
        suggestedCode: 'fixed',
        explanation: 'Fix',
        confidence: 'high' as const,
        breaking: false,
        applied: false,
      });

      const result = await generateFixes({ dryRun: true });

      expect(result.suggestions).toHaveLength(0);
    });

    it('should handle fix generation failures gracefully', async () => {
      mockGenerateFix.mockRejectedValue(new Error('Generation failed'));

      const result = await generateFixes({ dryRun: true });

      expect(result.suggestions).toHaveLength(0);
    });

    it('should process fixes concurrently', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.fixSummary()) return null;
        if (path === mockPaths.reviewSummary())
          return {
            timestamp: '2024-01-01',
            filesReviewed: 5,
            projectsReviewed: 1,
            issues: Array.from({ length: 5 }, (_, i) => ({
              id: `${i + 1}`,
              file: `file${i + 1}.ts`,
              type: 'bug',
              severity: 'high',
              confidence: 90,
              description: 'Test issue',
              location: `file${i + 1}.ts:10`,
              reasoning: 'Test',
              suggestion: 'Fix',
              context: 'Test context',
            })),
            summary: {
              totalIssues: 5,
              critical: 0,
              high: 5,
              medium: 0,
              low: 0,
              byType: { bug: 5, security: 0, performance: 0, maintainability: 0 },
            },
          };
        return null;
      });

      mockGenerateFix.mockImplementation(async (issue) => ({
        issueId: issue.id,
        file: issue.file,
        line: 10,
        originalCode: 'old',
        suggestedCode: 'fixed',
        explanation: 'Fix',
        confidence: 'high' as const,
        breaking: false,
        applied: false,
      }));

      const result = await generateFixes({ dryRun: true });

      expect(result.suggestions).toHaveLength(5);
    });
  });

  describe('fix application', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.fixSummary()) return null;
        if (path === mockPaths.reviewSummary())
          return {
            timestamp: '2024-01-01',
            filesReviewed: 2,
            projectsReviewed: 1,
            issues: [
              {
                id: '1',
                file: 'file1.ts',
                type: 'bug',
                severity: 'high',
                confidence: 90,
                description: 'Test issue',
                location: 'file1.ts:10',
                reasoning: 'Test',
                suggestion: 'Fix',
                context: 'Test context',
              },
            ],
            summary: {
              totalIssues: 1,
              critical: 0,
              high: 1,
              medium: 0,
              low: 0,
              byType: { bug: 1, security: 0, performance: 0, maintainability: 0 },
            },
          };
        return null;
      });

      mockGenerateFix.mockResolvedValue({
        issueId: '1',
        file: 'file1.ts',
        line: 10,
        originalCode: 'old',
        suggestedCode: 'fixed',
        explanation: 'Fix',
        confidence: 'high' as const,
        breaking: false,
        applied: false,
      });
    });

    it('should not apply fixes in dry run mode', async () => {
      await generateFixes({ dryRun: true, apply: false });

      expect(mockApplySafeFixes).not.toHaveBeenCalled();
    });

    it('should apply fixes when apply=true and dryRun=false', async () => {
      mockApplySafeFixes.mockResolvedValue([
        {
          filePath: 'file1.ts',
          success: true,
          appliedChanges: {
            linesAdded: 1,
            linesRemoved: 1,
            linesModified: 0,
          },
        },
      ]);

      await generateFixes({ dryRun: false, apply: true });

      expect(mockApplySafeFixes).toHaveBeenCalled();
    });

    it('should create rollback point before applying fixes', async () => {
      mockCreateFixBatchRollbackPoint.mockResolvedValue({ id: 'rollback-1' } as any);
      mockApplySafeFixes.mockResolvedValue([
        {
          filePath: 'file1.ts',
          success: true,
          appliedChanges: {
            linesAdded: 1,
            linesRemoved: 1,
            linesModified: 0,
          },
        },
      ]);

      await generateFixes({ dryRun: false, apply: true, createRollback: true });

      expect(mockCreateFixBatchRollbackPoint).toHaveBeenCalledWith(['file1.ts']);
    });

    it('should skip rollback point when createRollback=false', async () => {
      mockApplySafeFixes.mockResolvedValue([
        {
          filePath: 'file1.ts',
          success: true,
          appliedChanges: {
            linesAdded: 1,
            linesRemoved: 1,
            linesModified: 0,
          },
        },
      ]);

      await generateFixes({ dryRun: false, apply: true, createRollback: false });

      expect(mockCreateFixBatchRollbackPoint).not.toHaveBeenCalled();
    });

    it('should continue even if rollback point creation fails', async () => {
      mockCreateFixBatchRollbackPoint.mockRejectedValue(new Error('Rollback failed'));
      mockApplySafeFixes.mockResolvedValue([
        {
          filePath: 'file1.ts',
          success: true,
          appliedChanges: {
            linesAdded: 1,
            linesRemoved: 1,
            linesModified: 0,
          },
        },
      ]);

      await expect(
        generateFixes({ dryRun: false, apply: true, createRollback: true }),
      ).resolves.toBeDefined();
    });

    it('should update applied status on success', async () => {
      mockApplySafeFixes.mockResolvedValue([
        {
          filePath: 'file1.ts',
          success: true,
          appliedChanges: {
            linesAdded: 1,
            linesRemoved: 1,
            linesModified: 0,
          },
        },
      ]);

      const result = await generateFixes({ dryRun: false, apply: true });

      expect(result.suggestions[0].applied).toBe(true);
      expect(result.summary.applied).toBe(1);
    });

    it('should not update applied status on failure', async () => {
      mockApplySafeFixes.mockResolvedValue([
        {
          filePath: 'file1.ts',
          success: false,
          error: 'Apply failed',
          appliedChanges: {
            linesAdded: 0,
            linesRemoved: 0,
            linesModified: 0,
          },
        },
      ]);

      const result = await generateFixes({ dryRun: false, apply: true });

      expect(result.suggestions[0].applied).toBeFalsy();
      expect(result.summary.applied).toBe(0);
    });
  });

  describe('summary generation', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.fixSummary()) return null;
        if (path === mockPaths.reviewSummary())
          return {
            timestamp: '2024-01-01',
            filesReviewed: 3,
            projectsReviewed: 1,
            issues: [
              {
                id: '1',
                file: 'file1.ts',
                type: 'bug',
                severity: 'high',
                confidence: 95,
                description: 'Test',
                location: 'file1.ts:10',
                reasoning: 'Test',
                suggestion: 'Fix',
                context: 'Test',
              },
              {
                id: '2',
                file: 'file2.ts',
                type: 'bug',
                severity: 'high',
                confidence: 80,
                description: 'Test',
                location: 'file2.ts:20',
                reasoning: 'Test',
                suggestion: 'Fix',
                context: 'Test',
              },
            ],
            summary: {
              totalIssues: 2,
              critical: 0,
              high: 2,
              medium: 0,
              low: 0,
              byType: { bug: 2, security: 0, performance: 0, maintainability: 0 },
            },
          };
        return null;
      });
    });

    it('should generate summary with confidence breakdown', async () => {
      mockGenerateFix
        .mockResolvedValueOnce({
          issueId: '1',
          file: 'file1.ts',
          line: 10,
          originalCode: 'old',
          suggestedCode: 'fixed',
          explanation: 'Fix',
          confidence: 'high' as const,
          breaking: false,
          applied: false,
        })
        .mockResolvedValueOnce({
          issueId: '2',
          file: 'file2.ts',
          line: 20,
          originalCode: 'old',
          suggestedCode: 'fixed',
          explanation: 'Fix',
          confidence: 'medium' as const,
          breaking: false,
          applied: false,
        });

      const result = await generateFixes({ dryRun: true });

      expect(result.summary.highConfidence).toBe(1);
      expect(result.summary.mediumConfidence).toBe(1);
      expect(result.summary.lowConfidence).toBe(0);
    });

    it('should count breaking changes', async () => {
      mockGenerateFix
        .mockResolvedValueOnce({
          issueId: '1',
          file: 'file1.ts',
          line: 10,
          originalCode: 'old',
          suggestedCode: 'fixed',
          explanation: 'Fix',
          confidence: 'high' as const,
          breaking: true,
          applied: false,
        })
        .mockResolvedValueOnce({
          issueId: '2',
          file: 'file2.ts',
          line: 20,
          originalCode: 'old',
          suggestedCode: 'fixed',
          explanation: 'Fix',
          confidence: 'high' as const,
          breaking: false,
          applied: false,
        });

      const result = await generateFixes({ dryRun: true });

      expect(result.summary.breaking).toBe(1);
    });
  });

  describe('diff report generation', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.fixSummary()) return null;
        if (path === mockPaths.reviewSummary())
          return {
            timestamp: '2024-01-01',
            filesReviewed: 1,
            projectsReviewed: 1,
            issues: [
              {
                id: '1',
                file: 'file1.ts',
                type: 'bug',
                severity: 'high',
                confidence: 90,
                description: 'Test',
                location: 'file1.ts:10',
                reasoning: 'Test',
                suggestion: 'Fix',
                context: 'Test',
              },
            ],
            summary: {
              totalIssues: 1,
              critical: 0,
              high: 1,
              medium: 0,
              low: 0,
              byType: { bug: 1, security: 0, performance: 0, maintainability: 0 },
            },
          };
        return null;
      });

      mockGenerateFix.mockResolvedValue({
        issueId: '1',
        file: 'file1.ts',
        line: 10,
        originalCode: 'old',
        suggestedCode: 'fixed',
        explanation: 'Fix',
        confidence: 'high' as const,
        breaking: false,
        applied: false,
      });
    });

    it('should generate diff HTML report', async () => {
      await generateFixes({ dryRun: true });

      expect(mockGenerateDiffHTML).toHaveBeenCalled();
    });

    it('should handle diff generation failure gracefully', async () => {
      mockGenerateDiffHTML.mockRejectedValue(new Error('Diff generation failed'));

      await expect(generateFixes({ dryRun: true })).resolves.toBeDefined();
    });
  });

  describe('token usage tracking', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.fixSummary()) return null;
        if (path === mockPaths.reviewSummary())
          return {
            timestamp: '2024-01-01',
            filesReviewed: 1,
            projectsReviewed: 1,
            issues: [
              {
                id: '1',
                file: 'file1.ts',
                type: 'bug',
                severity: 'high',
                confidence: 90,
                description: 'Test',
                location: 'file1.ts:10',
                reasoning: 'Test',
                suggestion: 'Fix',
                context: 'Test',
              },
            ],
            summary: {
              totalIssues: 1,
              critical: 0,
              high: 1,
              medium: 0,
              low: 0,
              byType: { bug: 1, security: 0, performance: 0, maintainability: 0 },
            },
          };
        return null;
      });

      mockGenerateFix.mockResolvedValue({
        issueId: '1',
        file: 'file1.ts',
        line: 10,
        originalCode: 'old',
        suggestedCode: 'fixed',
        explanation: 'Fix',
        confidence: 'high' as const,
        breaking: false,
        applied: false,
      });
    });

    it('should track token usage', async () => {
      await generateFixes({ dryRun: true });

      expect(mockAddStageTokenStats).toHaveBeenCalledWith('fix', 10, 2000, 1000, 0, 0.1);
    });

    it('should handle cached tokens', async () => {
      mockAIProvider.cachedTokens = 500;

      await generateFixes({ dryRun: true });

      expect(mockAddStageTokenStats).toHaveBeenCalledWith('fix', 10, 2000, 1000, 500, 0.1);
    });

    it('should handle missing token stats', async () => {
      mockAIProvider.getTokenStats = undefined;

      await generateFixes({ dryRun: true });

      expect(mockAddStageTokenStats).not.toHaveBeenCalled();
    });
  });

  describe('metadata persistence', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.fixSummary()) return null;
        if (path === mockPaths.reviewSummary())
          return {
            timestamp: '2024-01-01',
            filesReviewed: 1,
            projectsReviewed: 1,
            issues: [],
            summary: {
              totalIssues: 0,
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
              byType: { bug: 0, security: 0, performance: 0, maintainability: 0 },
            },
          };
        return null;
      });
    });

    it('should save metadata to file', async () => {
      await generateFixes({ dryRun: true });

      expect(mockWriteMetadataFile).toHaveBeenCalledWith(
        mockPaths.fixSummary(),
        expect.any(Object),
      );
    });

    it('should include complete metadata', async () => {
      await generateFixes({ dryRun: true });

      expect(mockWriteMetadataFile).toHaveBeenCalledWith(
        mockPaths.fixSummary(),
        expect.objectContaining({
          timestamp: expect.any(String),
          issuesProcessed: expect.any(Number),
          suggestions: expect.any(Array),
          summary: expect.any(Object),
        }),
      );
    });
  });

  describe('logging', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.fixSummary()) return null;
        if (path === mockPaths.reviewSummary())
          return {
            timestamp: '2024-01-01',
            filesReviewed: 1,
            projectsReviewed: 1,
            issues: [
              {
                id: '1',
                file: 'file1.ts',
                type: 'bug',
                severity: 'high',
                confidence: 90,
                description: 'Test',
                location: 'file1.ts:10',
                reasoning: 'Test',
                suggestion: 'Fix',
                context: 'Test',
              },
            ],
            summary: {
              totalIssues: 1,
              critical: 0,
              high: 1,
              medium: 0,
              low: 0,
              byType: { bug: 1, security: 0, performance: 0, maintainability: 0 },
            },
          };
        return null;
      });

      mockGenerateFix.mockResolvedValue({
        issueId: '1',
        file: 'file1.ts',
        line: 10,
        originalCode: 'old',
        suggestedCode: 'fixed',
        explanation: 'Fix',
        confidence: 'high' as const,
        breaking: false,
        applied: false,
      });
    });

    it('should log fix summary', async () => {
      await generateFixes({ dryRun: true });

      expect(logger.info).toHaveBeenCalledWith('Fix Summary:');
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Total Suggestions'));
    });

    it('should log timing information', async () => {
      await generateFixes({ dryRun: true });

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Fix generation completed in'),
      );
    });
  });
});
