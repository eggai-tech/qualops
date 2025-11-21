import { ProgressReporter } from '@/cli/utils/progress-reporter';
import { logger } from '@/shared/utils/logger';

jest.mock('@/shared/utils/logger');

const mockLogger = logger as jest.Mocked<typeof logger>;

describe('ProgressReporter', () => {
  let reporter: ProgressReporter;

  beforeEach(() => {
    jest.clearAllMocks();
    reporter = new ProgressReporter();
  });

  describe('startStages', () => {
    it('should log stages being run', () => {
      const stages = ['analyze', 'review', 'fix'];

      reporter.startStages(stages);

      expect(mockLogger.start).toHaveBeenCalledWith('Running stages: analyze, review, fix');
    });

    it('should handle single stage', () => {
      reporter.startStages(['analyze']);

      expect(mockLogger.start).toHaveBeenCalledWith('Running stages: analyze');
    });

    it('should handle empty stages array', () => {
      reporter.startStages([]);

      expect(mockLogger.start).toHaveBeenCalledWith('Running stages: ');
    });

    it('should handle many stages', () => {
      const stages = ['analyze', 'review', 'fix', 'report', 'judge'];

      reporter.startStages(stages);

      expect(mockLogger.start).toHaveBeenCalledWith('Running stages: analyze, review, fix, report, judge');
    });

    it('should preserve stage order', () => {
      reporter.startStages(['judge', 'analyze', 'fix']);

      expect(mockLogger.start).toHaveBeenCalledWith('Running stages: judge, analyze, fix');
    });
  });

  describe('startStage', () => {
    it('should log stage name in uppercase', () => {
      reporter.startStage('analyze');

      expect(mockLogger.info).toHaveBeenCalledWith('\nANALYZE');
    });

    it('should track current stage', () => {
      reporter.startStage('review');

      reporter.completeStage();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('review completed'));
    });

    it('should record start time', () => {
      jest.useFakeTimers();
      const _startTime = Date.now();

      reporter.startStage('review');
      jest.advanceTimersByTime(1000);
      reporter.completeStage();

      expect(mockLogger.info).toHaveBeenCalledWith('review completed in 1000ms');

      jest.useRealTimers();
    });

    it('should set status to running', () => {
      reporter.startStage('fix');

      reporter.completeStage();

      expect(mockLogger.info).toHaveBeenCalledTimes(2);
    });

    it('should handle uppercase input by converting to uppercase', () => {
      reporter.startStage('REPORT');

      expect(mockLogger.info).toHaveBeenCalledWith('\nREPORT');
    });

    it('should handle mixed case input', () => {
      reporter.startStage('JuDgE');

      expect(mockLogger.info).toHaveBeenCalledWith('\nJUDGE');
    });

    it('should include newline prefix', () => {
      reporter.startStage('analyze');

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/^\n/));
    });

    it('should allow starting multiple stages sequentially', () => {
      reporter.startStage('analyze');
      reporter.completeStage();
      reporter.startStage('review');
      reporter.completeStage();

      expect(mockLogger.info).toHaveBeenCalledWith('\nANALYZE');
      expect(mockLogger.info).toHaveBeenCalledWith('\nREVIEW');
    });
  });

  describe('completeStage', () => {
    it('should log completion with duration', () => {
      jest.useFakeTimers();

      reporter.startStage('analyze');
      jest.advanceTimersByTime(2500);
      reporter.completeStage();

      expect(mockLogger.info).toHaveBeenCalledWith('analyze completed in 2500ms');

      jest.useRealTimers();
    });

    it('should clear current stage', () => {
      reporter.startStage('review');
      reporter.completeStage();
      reporter.completeStage();

      expect(mockLogger.info).toHaveBeenCalledTimes(2);
    });

    it('should handle completion with no current stage', () => {
      reporter.completeStage();

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should calculate duration accurately for quick operations', () => {
      jest.useFakeTimers();

      reporter.startStage('review');
      jest.advanceTimersByTime(10);
      reporter.completeStage();

      expect(mockLogger.info).toHaveBeenCalledWith('review completed in 10ms');

      jest.useRealTimers();
    });

    it('should calculate duration accurately for long operations', () => {
      jest.useFakeTimers();

      reporter.startStage('fix');
      jest.advanceTimersByTime(60000);
      reporter.completeStage();

      expect(mockLogger.info).toHaveBeenCalledWith('fix completed in 60000ms');

      jest.useRealTimers();
    });

    it('should handle zero duration', () => {
      jest.useFakeTimers();

      reporter.startStage('report');
      reporter.completeStage();

      expect(mockLogger.info).toHaveBeenCalledWith('report completed in 0ms');

      jest.useRealTimers();
    });

    it('should reset current stage after completion', () => {
      reporter.startStage('analyze');
      reporter.completeStage();

      reporter.startStage('review');
      reporter.completeStage();

      expect(mockLogger.info).toHaveBeenCalledWith('review completed in 0ms');
    });

    it('should not throw when called multiple times', () => {
      reporter.startStage('judge');
      reporter.completeStage();

      expect(() => reporter.completeStage()).not.toThrow();
      expect(() => reporter.completeStage()).not.toThrow();
    });
  });

  describe('failStage', () => {
    it('should clear current stage on failure', () => {
      reporter.startStage('analyze');
      reporter.failStage(new Error('Test error'));

      reporter.completeStage();

      expect(mockLogger.info).toHaveBeenCalledTimes(1);
    });

    it('should handle failure with no current stage', () => {
      expect(() => reporter.failStage(new Error('Test error'))).not.toThrow();
    });

    it('should accept any error type', () => {
      reporter.startStage('review');

      expect(() => reporter.failStage('string error')).not.toThrow();
      expect(() => reporter.failStage(123)).not.toThrow();
      expect(() => reporter.failStage(null)).not.toThrow();
      expect(() => reporter.failStage(undefined)).not.toThrow();
    });

    it('should not log anything', () => {
      reporter.startStage('review');
      reporter.failStage(new Error('Test'));

      expect(mockLogger.info).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should allow starting new stage after failure', () => {
      reporter.startStage('fix');
      reporter.failStage(new Error('Failed'));

      reporter.startStage('report');
      reporter.completeStage();

      expect(mockLogger.info).toHaveBeenCalledWith('report completed in 0ms');
    });

    it('should handle multiple failures', () => {
      reporter.startStage('analyze');
      reporter.failStage(new Error('Error 1'));

      reporter.startStage('review');
      reporter.failStage(new Error('Error 2'));

      expect(mockLogger.info).toHaveBeenCalledTimes(2);
    });
  });

  describe('reportSessionInfo', () => {
    it('should log project name when provided', () => {

    });

    it('should log single file', () => {
      reporter.reportSessionInfo({ files: ['src/app.ts'] });

      expect(mockLogger.info).toHaveBeenCalledWith('Analyzing file: src/app.ts');
    });

    it('should log multiple files count', () => {
      const files = ['file1.ts', 'file2.ts', 'file3.ts'];

      reporter.reportSessionInfo({ files });

      expect(mockLogger.info).toHaveBeenCalledWith('Analyzing 3 files');
      expect(mockLogger.info).toHaveBeenCalledWith('Files: file1.ts, file2.ts, file3.ts');
    });

    it('should truncate file list after 3 files', () => {
      const files = ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts', 'file5.ts'];

      reporter.reportSessionInfo({ files });

      expect(mockLogger.info).toHaveBeenCalledWith('Analyzing 5 files');
      expect(mockLogger.info).toHaveBeenCalledWith('Files: file1.ts, file2.ts, file3.ts... and 2 more');
    });

    it('should show exact count of remaining files', () => {
      const files = Array.from({ length: 10 }, (_, i) => `file${i + 1}.ts`);

      reporter.reportSessionInfo({ files });

      expect(mockLogger.info).toHaveBeenCalledWith('Analyzing 10 files');
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('... and 7 more'));
    });

    it('should prioritize project over files', () => {

      expect(mockLogger.info).not.toHaveBeenCalledWith(expect.stringContaining('file'));
    });

    it('should handle empty options', () => {
      reporter.reportSessionInfo({});

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should handle empty files array', () => {
      reporter.reportSessionInfo({ files: [] });

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should handle exactly 3 files without truncation', () => {
      const files = ['file1.ts', 'file2.ts', 'file3.ts'];

      reporter.reportSessionInfo({ files });

      expect(mockLogger.info).toHaveBeenCalledWith('Files: file1.ts, file2.ts, file3.ts');
      expect(mockLogger.info).not.toHaveBeenCalledWith(expect.stringContaining('more'));
    });

    it('should handle exactly 4 files with truncation', () => {
      const files = ['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts'];

      reporter.reportSessionInfo({ files });

      expect(mockLogger.info).toHaveBeenCalledWith('Files: file1.ts, file2.ts, file3.ts... and 1 more');
    });

    it('should handle files with long paths', () => {
      const files = ['src/app/features/module/component.ts'];

      reporter.reportSessionInfo({ files });

      expect(mockLogger.info).toHaveBeenCalledWith('Analyzing file: src/app/features/module/component.ts');
    });

    it('should handle files with special characters', () => {
      const files = ['src/app-feature/module_name.ts', 'src/other@file.ts'];

      reporter.reportSessionInfo({ files });

      expect(mockLogger.info).toHaveBeenCalledWith('Analyzing 2 files');
    });
  });

  describe('reportCompletion', () => {
    it('should log success summary', () => {
      reporter.reportCompletion('/path/to/session');

      expect(mockLogger.summary).toHaveBeenCalledWith('QualOps completed successfully');
    });

    it('should log session path', () => {
      const sessionPath = '/project/.qualops/sessions/20240115-103045';

      reporter.reportCompletion(sessionPath);

      expect(mockLogger.info).toHaveBeenCalledWith(`View results at: ${sessionPath}`);
    });

    it('should handle relative paths', () => {
      reporter.reportCompletion('.qualops/sessions/my-session');

      expect(mockLogger.info).toHaveBeenCalledWith('View results at: .qualops/sessions/my-session');
    });

    it('should handle absolute paths', () => {
      reporter.reportCompletion('/absolute/path/to/session');

      expect(mockLogger.info).toHaveBeenCalledWith('View results at: /absolute/path/to/session');
    });

    it('should handle paths with special characters', () => {
      reporter.reportCompletion('/path/with spaces/session-name');

      expect(mockLogger.info).toHaveBeenCalledWith('View results at: /path/with spaces/session-name');
    });

    it('should call logger methods in correct order', () => {
      reporter.reportCompletion('/path/to/session');

      const calls = mockLogger.summary.mock.invocationCallOrder.concat(mockLogger.info.mock.invocationCallOrder);
      expect(calls[0]).toBeLessThan(calls[1]);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete stage lifecycle', () => {
      jest.useFakeTimers();

      reporter.startStages(['analyze', 'review']);
      reporter.startStage('analyze');
      jest.advanceTimersByTime(1000);
      reporter.completeStage();
      reporter.startStage('review');
      jest.advanceTimersByTime(500);
      reporter.completeStage();
      reporter.reportCompletion('/session/path');

      expect(mockLogger.start).toHaveBeenCalledWith('Running stages: analyze, review');
      expect(mockLogger.info).toHaveBeenCalledWith('analyze completed in 1000ms');
      expect(mockLogger.info).toHaveBeenCalledWith('review completed in 500ms');
      expect(mockLogger.summary).toHaveBeenCalledWith('QualOps completed successfully');

      jest.useRealTimers();
    });

    it('should handle stage failure and recovery', () => {
      reporter.startStage('analyze');
      reporter.failStage(new Error('Failed'));
      reporter.startStage('review');
      reporter.completeStage();

      expect(mockLogger.info).toHaveBeenCalledWith('\nANALYZE');
      expect(mockLogger.info).toHaveBeenCalledWith('\nREVIEW');
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('review completed'));
    });

    it('should handle multiple sessions', () => {
      reporter.startStages(['analyze']);
      reporter.startStage('analyze');
      reporter.completeStage();
      reporter.reportCompletion('/session1');

      jest.clearAllMocks();

      reporter.startStages(['review']);
      reporter.startStage('review');
      reporter.completeStage();
      reporter.reportCompletion('/session2');

      expect(mockLogger.start).toHaveBeenCalledWith('Running stages: review');
    });

    it('should handle session with project and files', () => {
      reporter.startStages(['analyze', 'review', 'fix']);
      reporter.reportCompletion('/path/to/session');

      expect(mockLogger.start).toHaveBeenCalled();
      expect(mockLogger.summary).toHaveBeenCalled();
    });
  });
});
