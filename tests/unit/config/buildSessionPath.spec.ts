import { existsSync, readFileSync } from 'node:fs';

import { buildSessionPath } from '@/config/buildSessionPath';

jest.mock('node:fs');

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

describe('buildSessionPath', () => {
  it('should build session paths', () => {
    const sessionPath = buildSessionPath('test-session', '.qualops/reports');
    expect(sessionPath.base()).toContain('test-session');
    expect(sessionPath.analysis()).toContain('analysis.json');
    expect(sessionPath.reviewSummary()).toContain('review-summary.json');
    expect(sessionPath.fixSummary()).toContain('fix-suggestions.json');
    expect(sessionPath.overallReport()).toContain('overall-report.json');
    expect(sessionPath.judgeDecision()).toContain('judge-decision.json');
    expect(sessionPath.cache()).toContain('qualops-cache.json');
    expect(sessionPath.extractLog()).toContain('extract-log.json');
    expect(sessionPath.diffReport()).toContain('diff-report.html');
    expect(sessionPath.tokenStats()).toContain('token-stats.json');
    expect(sessionPath.metadata()).toContain('metadata.json');
    expect(sessionPath.sessionReport()).toContain('report.html');
    expect(sessionPath.errorLog('review')).toContain('error-review.json');
    expect(sessionPath.timingStats()).toContain('timing-stats.json');
  });

  it('should use reportRoot parameter for sessions directory', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        paths: {
          sessionsDir: '.qualops/reports/custom-sessions',
        },
      }),
    );
    const sessionPath = buildSessionPath('test-session', '.qualops/reports/custom');
    expect(sessionPath.base()).toContain('.qualops/reports/custom/sessions');
    expect(sessionPath.base()).toContain('test-session');
  });
});
