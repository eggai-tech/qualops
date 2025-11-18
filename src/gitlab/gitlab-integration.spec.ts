import { existsSync, readdirSync, readFileSync } from 'fs';

jest.mock('fs');
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockReaddirSync = readdirSync as jest.MockedFunction<typeof readdirSync>;

global.fetch = jest.fn();

import { GitLabIntegration } from './gitlab-integration';

interface QualOpsResult {
  summary: {
    totalIssues: number;
    criticalSeverity: number;
    highSeverity: number;
    mediumSeverity: number;
    lowSeverity: number;
    filesAnalyzed: number;
  };
  reportPath: string;
  issues: Array<{
    file: string;
    line: number;
    severity: string;
    message: string;
    category: string;
  }>;
}

describe('GitLabIntegration', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    originalEnv = { ...process.env };

    process.env.CI_PROJECT_ID = '123';
    process.env.CI_MERGE_REQUEST_IID = '456';
    process.env.CI_JOB_TOKEN = 'test-token';
    process.env.CI_API_V4_URL = 'https://gitlab.example.com/api/v4';
    process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA = 'base-sha';
    process.env.CI_COMMIT_SHA = 'head-sha';
    process.env.CI_PIPELINE_ID = '789';
    process.env.CI_PROJECT_URL = 'https://gitlab.example.com/project';
    // Ensure GITLAB_ACCESS_TOKEN is not set, so tests use JOB-TOKEN header
    delete process.env.GITLAB_ACCESS_TOKEN;

    jest.clearAllMocks();
    mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should initialize with GitLab environment variables', () => {
      const integration = new GitLabIntegration() as unknown as {
        env: Record<string, string>;
        apiUrl: string;
        headers: Record<string, string>;
      };
      expect(integration.env.CI_PROJECT_ID).toBe('123');
      expect(integration.apiUrl).toBe('https://gitlab.example.com/api/v4/projects/123');
      expect(integration.headers['JOB-TOKEN']).toBe('test-token');
    });

    it('should load config from .qualopsrc.json', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          gitlab: {
            enabled: true,
            postComments: true,
            blockPipeline: true,
          },
        }),
      );

      const integration = new GitLabIntegration() as unknown as {
        config: { enabled: boolean; blockPipeline: boolean };
      };
      expect(integration.config.enabled).toBe(true);
      expect(integration.config.blockPipeline).toBe(true);
    });

    it('should handle malformed JSON in config', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('invalid json');

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const integration = new GitLabIntegration() as unknown as { config: Record<string, unknown> };

      expect(integration.config).toEqual({});
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load .qualopsrc.json'),
        expect.anything(),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('postMergeRequestComment', () => {
    it('should post comment successfully when no existing comment found', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          statusText: 'OK',
        } as Response);

      const integration = new GitLabIntegration();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await integration.postMergeRequestComment('Test comment');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://gitlab.example.com/api/v4/projects/123/merge_requests/456/notes?per_page=100&page=1',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://gitlab.example.com/api/v4/projects/123/merge_requests/456/notes',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'JOB-TOKEN': 'test-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ body: '<!-- qualops-analysis-comment -->\nTest comment' }),
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith('Posted QualOps summary to merge request');

      consoleSpy.mockRestore();
    });

    it('should update existing comment when found', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { id: 999, body: '<!-- qualops-analysis-comment -->\nOld comment' },
            { id: 1000, body: 'Some other comment' },
          ],
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          statusText: 'OK',
        } as Response);

      const integration = new GitLabIntegration();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await integration.postMergeRequestComment('Updated comment');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://gitlab.example.com/api/v4/projects/123/merge_requests/456/notes?per_page=100&page=1',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://gitlab.example.com/api/v4/projects/123/merge_requests/456/notes/999',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'JOB-TOKEN': 'test-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ body: '<!-- qualops-analysis-comment -->\nUpdated comment' }),
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith('Updated existing QualOps comment on merge request');

      consoleSpy.mockRestore();
    });

    it('should handle missing merge request IID', async () => {
      delete process.env.CI_MERGE_REQUEST_IID;

      const integration = new GitLabIntegration();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await integration.postMergeRequestComment('Test comment');

      expect(mockFetch).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('No merge request IID found, skipping comment posting');

      consoleSpy.mockRestore();
    });

    it('should handle API failure when posting new comment', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          statusText: 'Unauthorized',
        } as Response);

      const integration = new GitLabIntegration();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await integration.postMergeRequestComment('Test comment');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to post/update comment on merge request after all retries:',
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle API failure when updating existing comment', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: 999, body: '<!-- qualops-analysis-comment -->\nOld comment' }],
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          statusText: 'Forbidden',
        } as Response);

      const integration = new GitLabIntegration();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await integration.postMergeRequestComment('Test comment');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to post/update comment on merge request after all retries:',
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('postInlineComment', () => {
    const testIssue = {
      file: 'src/test.ts',
      line: 42,
      severity: 'high',
      message: 'Test issue',
      category: 'Security',
    };

    it('should post inline comment successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      } as Response);

      const integration = new GitLabIntegration();
      const result = await integration.postInlineComment(testIssue, 'base-sha', 'head-sha');

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/merge_requests/456/discussions',
        {
          method: 'POST',
          headers: expect.any(Object),
          body: expect.stringContaining('🟠 **HIGH**: Security'),
        },
      );
    });

    it('should return false when merge request IID is missing', async () => {
      delete process.env.CI_MERGE_REQUEST_IID;

      const integration = new GitLabIntegration();
      const result = await integration.postInlineComment(testIssue, 'base-sha', 'head-sha');

      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle API failure and return false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
        text: async () => 'Error response',
      } as Response);

      const integration = new GitLabIntegration();
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = await integration.postInlineComment(testIssue, 'base-sha', 'head-sha');

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to post inline comment for src/test.ts:42'),
      );

      consoleSpy.mockRestore();
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const integration = new GitLabIntegration();
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = await integration.postInlineComment(testIssue, 'base-sha', 'head-sha');

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to post inline comment for src/test.ts:42 -'),
        'Network error',
      );

      consoleSpy.mockRestore();
    });

    it('should use correct emoji for each severity', async () => {
      mockFetch.mockResolvedValue({ ok: true } as Response);

      const integration = new GitLabIntegration();

      await integration.postInlineComment({ ...testIssue, severity: 'critical' }, 'base', 'head');
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('🔴 **CRITICAL**'),
        }),
      );

      await integration.postInlineComment({ ...testIssue, severity: 'high' }, 'base', 'head');
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('🟠 **HIGH**'),
        }),
      );

      await integration.postInlineComment({ ...testIssue, severity: 'medium' }, 'base', 'head');
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('🟡 **MEDIUM**'),
        }),
      );

      await integration.postInlineComment({ ...testIssue, severity: 'low' }, 'base', 'head');
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('🟢 **LOW**'),
        }),
      );
    });
  });

  describe('getArtifactDownloadUrl', () => {
    it('should fetch and return artifact URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { name: 'other-job', id: 111 },
          { name: 'qualops', id: 222 },
        ],
      } as Response);

      const integration = new GitLabIntegration();
      const url = await integration.getArtifactDownloadUrl();

      expect(url).toBe('https://gitlab.example.com/project/-/jobs/222/artifacts/download');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/pipelines/789/jobs',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should return null if qualops job not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ name: 'other-job', id: 111 }],
      } as Response);

      const integration = new GitLabIntegration();
      const url = await integration.getArtifactDownloadUrl();

      expect(url).toBeNull();
    });

    it('should handle API failures and network errors', async () => {
      const integration = new GitLabIntegration();
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      mockFetch.mockResolvedValueOnce({
        ok: false,
      } as Response);

      let url = await integration.getArtifactDownloadUrl();
      expect(url).toBeNull();

      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      url = await integration.getArtifactDownloadUrl();

      expect(url).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith('Failed to get artifact download URL:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });

  describe('generateCommentFromResults', () => {
    const mockResults = {
      summary: {
        totalIssues: 10,
        criticalSeverity: 2,
        highSeverity: 3,
        mediumSeverity: 3,
        lowSeverity: 2,
        filesAnalyzed: 50,
      },
      reportPath: '/path/to/report',
      issues: [
        { file: 'test1.ts', line: 1, severity: 'critical', message: 'Critical issue', category: 'Security' },
        { file: 'test2.ts', line: 2, severity: 'high', message: 'High issue', category: 'Bug' },
        { file: 'test3.ts', line: 3, severity: 'medium', message: 'Medium issue', category: 'Style' },
      ],
    };

    it('should generate comment with FAILED status for critical issues', () => {
      const integration = new GitLabIntegration();
      const comment = integration.generateCommentFromResults(mockResults, null);

      expect(comment).toContain('**Status: FAILED**');
      expect(comment).toContain('Total Issues:** 10');
      expect(comment).toContain('Critical:** 2 🔴');
      expect(comment).toContain('High:** 3 🟠');
      expect(comment).toContain('Action Required');
      expect(comment).toContain('**5** critical/high severity issues');
    });

    it('should generate comment with WARNINGS status for only medium/low issues', () => {
      const integration = new GitLabIntegration();
      const resultsWithoutCritical = {
        ...mockResults,
        summary: {
          ...mockResults.summary,
          criticalSeverity: 0,
          highSeverity: 0,
        },
      };

      const comment = integration.generateCommentFromResults(resultsWithoutCritical, null);

      expect(comment).toContain('**Status: WARNINGS**');
      expect(comment).not.toContain('Action Required');
    });

    it('should generate comment with PASSED status for no issues', () => {
      const integration = new GitLabIntegration();
      const noIssuesResults = {
        summary: {
          totalIssues: 0,
          criticalSeverity: 0,
          highSeverity: 0,
          mediumSeverity: 0,
          lowSeverity: 0,
          filesAnalyzed: 50,
        },
        reportPath: '/path',
        issues: [],
      };

      const comment = integration.generateCommentFromResults(noIssuesResults, null);

      expect(comment).toContain('**Status: PASSED**');
      expect(comment).toContain('No issues found');
    });

    it('should include artifact download link when provided or show fallback', () => {
      const integration = new GitLabIntegration();

      const commentWithUrl = integration.generateCommentFromResults(
        mockResults,
        'https://gitlab.example.com/artifacts/download',
      );

      expect(commentWithUrl).toContain('Download complete analysis report');
      // URL is sanitized/escaped for markdown safety
      expect(commentWithUrl).toContain('https:&#x2F;&#x2F;gitlab.example.com&#x2F;artifacts&#x2F;download');
      expect(commentWithUrl).toContain('Detailed HTML reports');
      expect(commentWithUrl).toContain('Session-based analysis results (JSON)');

      const commentWithoutUrl = integration.generateCommentFromResults(mockResults, null);
      expect(commentWithoutUrl).toContain('Download the complete report from the pipeline job artifacts');
    });
  });

  describe('parseQualOpsResults', () => {
    it('should parse and aggregate results from all sessions', () => {
      mockExistsSync.mockImplementation(() => true);

      mockReaddirSync.mockReturnValue([
        { name: 'session1', isDirectory: () => true },
        { name: 'session2', isDirectory: () => true },
      ] as unknown as ReturnType<typeof readdirSync>);

      mockReadFileSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes('session1/overall-report.json')) {
          return JSON.stringify({
            summary: { totalIssues: 5, critical: 1, high: 2, medium: 1, low: 1 },
          });
        } else if (pathStr.includes('session1/review-summary.json')) {
          return JSON.stringify({
            issues: [{ file: 'file1.ts', location: '1', severity: 'high', description: 'Issue 1', type: 'Bug' }],
          });
        } else if (pathStr.includes('session1/analysis.json')) {
          return JSON.stringify({
            filePaths: ['file1.ts', 'file2.ts'],
          });
        } else if (pathStr.includes('session2/overall-report.json')) {
          return JSON.stringify({
            summary: { totalIssues: 3, critical: 0, high: 1, medium: 1, low: 1 },
          });
        } else if (pathStr.includes('session2/review-summary.json')) {
          return JSON.stringify({
            issues: [{ file: 'file3.ts', location: '10', severity: 'medium', description: 'Issue 2', type: 'Style' }],
          });
        } else if (pathStr.includes('session2/analysis.json')) {
          return JSON.stringify({
            filePaths: ['file2.ts', 'file3.ts'],
          });
        }
        return '{}';
      });

      const integration = new GitLabIntegration();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const results = integration.parseQualOpsResults('reports');

      expect(results).toBeDefined();
      expect(results).not.toBeNull();
      expect((results as QualOpsResult).summary.totalIssues).toBe(8);
      expect((results as QualOpsResult).summary.criticalSeverity).toBe(1);
      expect((results as QualOpsResult).summary.highSeverity).toBe(3);
      expect((results as QualOpsResult).summary.mediumSeverity).toBe(2);
      expect((results as QualOpsResult).summary.lowSeverity).toBe(2);
      expect((results as QualOpsResult).summary.filesAnalyzed).toBe(3);
      expect((results as QualOpsResult).issues).toHaveLength(2);
      expect(consoleSpy).toHaveBeenCalledWith('Parsed 2 session(s) with 8 total issues');

      consoleSpy.mockRestore();
    });

    it('should handle missing sessions directory', () => {
      mockExistsSync.mockReturnValue(false);

      const integration = new GitLabIntegration();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const results = integration.parseQualOpsResults('reports');

      expect(results).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith('No sessions directory found');

      consoleSpy.mockRestore();
    });

    it('should handle empty sessions directory', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      const integration = new GitLabIntegration();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const results = integration.parseQualOpsResults('reports');

      expect(results).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith('No session folders found');

      consoleSpy.mockRestore();
    });

    it('should skip session folders without overall-report.json', () => {
      mockExistsSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes('session1/overall-report.json')) {
          return false;
        }
        return true;
      });

      mockReaddirSync.mockReturnValue([
        { name: 'session1', isDirectory: () => true },
        { name: 'session2', isDirectory: () => true },
      ] as unknown as ReturnType<typeof readdirSync>);

      mockReadFileSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes('session2/overall-report.json')) {
          return JSON.stringify({
            summary: { totalIssues: 1, critical: 0, high: 0, medium: 1, low: 0 },
          });
        }
        if (pathStr.includes('session2/analysis.json')) {
          return JSON.stringify({
            filePaths: ['file1.ts'],
          });
        }
        return '{}';
      });

      const integration = new GitLabIntegration();
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const results = integration.parseQualOpsResults('reports');

      expect(results).toBeDefined();
      expect(consoleSpy).toHaveBeenCalledWith('No overall-report.json found in session folder: session1');

      consoleSpy.mockRestore();
    });

    it('should handle malformed JSON in one session and continue with others', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'session1', isDirectory: () => true },
        { name: 'session2', isDirectory: () => true },
      ] as unknown as ReturnType<typeof readdirSync>);

      mockReadFileSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes('session1')) {
          return 'invalid json';
        } else if (pathStr.includes('session2/overall-report.json')) {
          return JSON.stringify({
            summary: { totalIssues: 2, critical: 0, high: 1, medium: 1, low: 0 },
          });
        } else if (pathStr.includes('session2/analysis.json')) {
          return JSON.stringify({
            filePaths: ['file1.ts'],
          });
        }
        return '{}';
      });

      const integration = new GitLabIntegration();
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const results = integration.parseQualOpsResults('reports');

      expect(results).toBeDefined();
      expect(results).not.toBeNull();
      expect((results as QualOpsResult).summary.totalIssues).toBe(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse session session1'),
        expect.anything(),
      );

      consoleSpy.mockRestore();
    });

    it('should handle directory read errors', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const integration = new GitLabIntegration();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const results = integration.parseQualOpsResults('reports');

      expect(results).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to read sessions directory:', 'Permission denied');

      consoleErrorSpy.mockRestore();
    });
  });

  describe('run', () => {
    const mockOverallReport = {
      summary: {
        totalIssues: 5,
        critical: 1,
        high: 2,
        medium: 1,
        low: 1,
      },
    };

    const mockReviewSummary = {
      issues: [
        { file: 'test.ts', location: '1', severity: 'critical', description: 'Issue', type: 'Security' },
        { file: 'test.ts', location: '5', severity: 'high', description: 'Issue', type: 'Bug' },
      ],
    };

    const mockAnalysis = {
      filePaths: ['test.ts'],
    };

    beforeEach(() => {
      process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA = 'head-sha';
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([{ name: 'session1', isDirectory: () => true }] as unknown as ReturnType<
        typeof readdirSync
      >);
      mockReadFileSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes('overall-report.json')) {
          return JSON.stringify(mockOverallReport);
        } else if (pathStr.includes('review-summary.json')) {
          return JSON.stringify(mockReviewSummary);
        } else if (pathStr.includes('analysis.json')) {
          return JSON.stringify(mockAnalysis);
        }
        return '{}';
      });
    });

    it('should skip when not in GitLab CI environment', async () => {
      delete process.env.CI_PROJECT_ID;

      const integration = new GitLabIntegration();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await integration.run();

      expect(consoleSpy).toHaveBeenCalledWith('Not running in GitLab CI environment, skipping integration');
      expect(mockFetch).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should skip when no results found', async () => {
      mockExistsSync.mockReturnValue(false);

      const integration = new GitLabIntegration();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await integration.run();

      expect(consoleSpy).toHaveBeenCalledWith('No QualOps results found, skipping comment posting');

      consoleSpy.mockRestore();
    });

    it('should post inline comments and summary', async () => {
      // Mock testMergeRequestAccess
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ iid: 456, title: 'Test MR' }) } as Response);

      // Mock getArtifactDownloadUrl
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);

      // Mock getExistingInlineComments (called from run)
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);

      // Mock postInlineComment (2 issues, 2 calls - though filtered by getChangedLines)
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => '' } as Response);
      mockFetch.mockResolvedValueOnce({ ok: true, text: async () => '' } as Response);

      // Mock getExistingQualOpsComment
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);

      // Mock postMergeRequestComment
      mockFetch.mockResolvedValueOnce({ ok: true } as Response);

      const integration = new GitLabIntegration();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      await integration.run();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('QualOps Analysis Complete'));

      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should track inline comment failures', async () => {
      // Mock testMergeRequestAccess
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ iid: 456, title: 'Test MR' }) } as Response);

      // Mock getArtifactDownloadUrl
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);

      // Mock getExistingInlineComments
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);

      // Mock getExistingQualOpsComment
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);

      // Mock postMergeRequestComment
      mockFetch.mockResolvedValueOnce({ ok: true } as Response);

      const integration = new GitLabIntegration();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      await integration.run();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('QualOps Analysis Complete'));

      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should exit with code 1 when blockPipeline is enabled and critical issues exist', async () => {
      jest.clearAllMocks();

      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([{ name: 'session1', isDirectory: () => true }] as unknown as ReturnType<
        typeof readdirSync
      >);
      mockReadFileSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes('.qualopsrc.json')) {
          return JSON.stringify({ gitlab: { blockPipeline: true } });
        } else if (pathStr.includes('overall-report.json')) {
          return JSON.stringify(mockOverallReport);
        } else if (pathStr.includes('review-summary.json')) {
          return JSON.stringify(mockReviewSummary);
        } else if (pathStr.includes('analysis.json')) {
          return JSON.stringify(mockAnalysis);
        }
        return '{}';
      });

      mockFetch.mockResolvedValue({ ok: true, json: async () => [] } as Response);

      const integration = new GitLabIntegration() as unknown as {
        config: { blockPipeline: boolean };
        run: () => Promise<void>;
      };

      expect(integration.config.blockPipeline).toBe(true);

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      await integration.run();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline blocked: Found 1 critical and 2 high severity issues'),
      );
      expect(exitSpy).toHaveBeenCalledWith(1);

      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('should not exit when no critical/high issues even if blockPipeline is true', async () => {
      const overallReportWithoutCritical = {
        summary: {
          totalIssues: 2,
          critical: 0,
          high: 0,
          medium: 1,
          low: 1,
        },
      };

      mockReaddirSync.mockReturnValue([{ name: 'session1', isDirectory: () => true }] as unknown as ReturnType<
        typeof readdirSync
      >);
      mockExistsSync.mockImplementation((path) => {
        const pathStr = String(path);
        // Return false for judge-decision.json so it doesn't trigger a false positive
        if (pathStr.includes('judge-decision.json')) {
          return false;
        }
        return true;
      });
      mockReadFileSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes('.qualopsrc.json')) {
          return JSON.stringify({ gitlab: { blockPipeline: true } });
        } else if (pathStr.includes('overall-report.json')) {
          return JSON.stringify(overallReportWithoutCritical);
        } else if (pathStr.includes('review-summary.json')) {
          return JSON.stringify({ issues: [] });
        } else if (pathStr.includes('analysis.json')) {
          return JSON.stringify(mockAnalysis);
        }
        return '{}';
      });

      mockFetch.mockResolvedValue({ ok: true, json: async () => [] } as Response);

      const integration = new GitLabIntegration();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      await integration.run();

      expect(exitSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });
});
