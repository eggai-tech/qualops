import {
  type ParsedStageOptions,
  parseStageOptions,
  type QualOpsOptions,
  STAGES,
  validateStages,
} from '@/cli/parsers/option-parser';

describe('parseStageOptions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-15T10:30:45.123Z').getTime());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return all stages when no stages option is provided', () => {
    const options: QualOpsOptions = { base: '.' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.stages).toEqual([...STAGES]);
    expect(result.sessionName).toBe('20240115-103045');
  });

  it('should return all stages when stages option is "all"', () => {
    const options: QualOpsOptions = { base: '.', stages: 'all' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.stages).toEqual([...STAGES]);
    expect(result.sessionName).toBe('20240115-103045');
  });

  it('should parse single stage', () => {
    const options: QualOpsOptions = { base: '.', stages: 'analyze' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.stages).toEqual(['analyze']);
  });

  it('should parse comma-separated stages', () => {
    const options: QualOpsOptions = { base: '.', stages: 'analyze,review,fix' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.stages).toEqual(['analyze', 'review', 'fix']);
  });

  it('should trim whitespace from stages', () => {
    const options: QualOpsOptions = { base: '.', stages: ' analyze , review , fix ' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.stages).toEqual(['analyze', 'review', 'fix']);
  });

  it('should filter out empty stage strings', () => {
    const options: QualOpsOptions = { base: '.', stages: 'analyze,,review,,' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.stages).toEqual(['analyze', 'review']);
  });

  it('should handle stage with leading and trailing whitespace', () => {
    const options: QualOpsOptions = { base: '.', stages: '  all  ' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.stages).toEqual([...STAGES]);
  });

  it('should use custom session name when provided', () => {
    const options: QualOpsOptions = { base: '.', name: 'my-custom-session' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.sessionName).toBe('my-custom-session');
  });

  it('should generate session name from current date when name not provided', () => {
    const options: QualOpsOptions = { base: '.' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.sessionName).toBe('20240115-103045');
  });

  it('should handle empty stages string after trim', () => {
    const options: QualOpsOptions = { base: '.', stages: '   ' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.stages).toEqual([]);
  });

  it('should handle stages with only commas', () => {
    const options: QualOpsOptions = { base: '.', stages: ',,,' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.stages).toEqual([]);
  });

  it('should preserve stage order', () => {
    const options: QualOpsOptions = { base: '.', stages: 'report,analyze,fix' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.stages).toEqual(['report', 'analyze', 'fix']);
  });

  it('should handle mixed valid and invalid stages without validation', () => {
    const options: QualOpsOptions = { base: '.', stages: 'analyze,invalid,review' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.stages).toEqual(['analyze', 'invalid', 'review']);
  });

  it('should handle all stage types', () => {
    const options: QualOpsOptions = { base: '.', stages: 'analyze,review,fix,report,judge' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.stages).toEqual(['analyze', 'review', 'fix', 'report', 'judge']);
  });

  it('should handle duplicate stages', () => {
    const options: QualOpsOptions = { base: '.', stages: 'analyze,analyze,review,review' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.stages).toEqual(['analyze', 'analyze', 'review', 'review']);
  });

  it('should generate consistent session name format', () => {
    jest.setSystemTime(new Date('2023-12-31T23:59:59.999Z').getTime());
    const options: QualOpsOptions = { base: '.' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.sessionName).toBe('20231231-235959');
  });

  it('should handle different timestamp formats', () => {
    jest.setSystemTime(new Date('2024-01-01T00:00:00.000Z').getTime());
    const options: QualOpsOptions = { base: '.' };
    const result: ParsedStageOptions = parseStageOptions(options);

    expect(result.sessionName).toBe('20240101-000000');
  });
});

describe('validateStages', () => {
  it('should not throw error for valid stages', () => {
    expect(() => validateStages(['analyze'])).not.toThrow();
    expect(() => validateStages(['analyze', 'review'])).not.toThrow();
    expect(() => validateStages([...STAGES])).not.toThrow();
  });

  it('should throw error for single invalid stage', () => {
    expect(() => validateStages(['invalid'])).toThrow(
      'Invalid stages: invalid. Valid stages are: analyze, review, fix, report, judge',
    );
  });

  it('should throw error for multiple invalid stages', () => {
    expect(() => validateStages(['invalid1', 'invalid2'])).toThrow(
      'Invalid stages: invalid1, invalid2. Valid stages are: analyze, review, fix, report, judge',
    );
  });

  it('should throw error for mix of valid and invalid stages', () => {
    expect(() => validateStages(['analyze', 'invalid', 'review'])).toThrow(
      'Invalid stages: invalid. Valid stages are: analyze, review, fix, report, judge',
    );
  });

  it('should validate all valid stage types', () => {
    expect(() => validateStages(['analyze'])).not.toThrow();
    expect(() => validateStages(['review'])).not.toThrow();
    expect(() => validateStages(['fix'])).not.toThrow();
    expect(() => validateStages(['report'])).not.toThrow();
    expect(() => validateStages(['judge'])).not.toThrow();
  });

  it('should handle empty array', () => {
    expect(() => validateStages([])).not.toThrow();
  });

  it('should be case-sensitive', () => {
    expect(() => validateStages(['Analyze'])).toThrow();
    expect(() => validateStages(['ANALYZE'])).toThrow();
    expect(() => validateStages(['aNaLyZe'])).toThrow();
  });

  it('should not allow stage with extra whitespace', () => {
    expect(() => validateStages([' analyze '])).toThrow();
    expect(() => validateStages(['analyze '])).toThrow();
    expect(() => validateStages([' analyze'])).toThrow();
  });

  it('should reject similar but incorrect stage names', () => {
    expect(() => validateStages(['analyse'])).toThrow();
    expect(() => validateStages(['reviewer'])).toThrow();
    expect(() => validateStages(['fixed'])).toThrow();
  });

  it('should handle multiple valid stages in any order', () => {
    expect(() => validateStages(['judge', 'analyze', 'fix', 'review'])).not.toThrow();
    expect(() => validateStages(['report', 'review', 'analyze'])).not.toThrow();
  });

  it('should allow duplicate valid stages', () => {
    expect(() => validateStages(['analyze', 'analyze'])).not.toThrow();
  });

  it('should reject empty string as stage', () => {
    expect(() => validateStages([''])).toThrow();
  });

  it('should provide helpful error message with all valid options', () => {
    let error: Error | undefined;

    try {
      validateStages(['wrong']);
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('Invalid stages: wrong');
    expect(error?.message).toContain('analyze, review, fix, report, judge');
  });
});

describe('STAGES constant', () => {
  it('should contain exactly 5 stages', () => {
    expect(STAGES).toHaveLength(5);
  });

  it('should contain all expected stages in correct order', () => {
    expect(STAGES).toEqual(['analyze', 'review', 'fix', 'report', 'judge']);
  });
});
