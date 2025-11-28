import { getDefaultReportRoot } from '@/shared/utils/report-root';

describe('getDefaultReportRoot', () => {
  it('should return the default report root directory name', () => {
    const result = getDefaultReportRoot();
    expect(result).toBe('.qualops/reports');
  });

  it('should always return a string', () => {
    const result = getDefaultReportRoot();
    expect(typeof result).toBe('string');
  });

  it('should return a non-empty string', () => {
    const result = getDefaultReportRoot();
    expect(result.length).toBeGreaterThan(0);
  });
});
