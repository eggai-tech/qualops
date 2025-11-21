import { enforceStageDependencies, STAGE_DEPENDENCIES, validateAndProcessStages } from '@/cli/parsers/argument-validator';
import { logger } from '@/shared/utils/logger';

jest.mock('@/shared/utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

describe('enforceStageDependencies', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return single stage without dependencies as-is', () => {
    const result = enforceStageDependencies(['analyze']);
    expect(result).toEqual(['analyze']);
  });

  it('should order stages respecting dependencies - review depends on analyze', () => {
    const result = enforceStageDependencies(['review', 'analyze']);
    expect(result).toEqual(['analyze', 'review']);
    expect(logger.info).toHaveBeenCalledWith('Stage order adjusted for dependencies: analyze,review');
  });

  it('should not log info when order is already correct', () => {
    const result = enforceStageDependencies(['analyze', 'review']);
    expect(result).toEqual(['analyze', 'review']);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('should order stages respecting dependencies - fix depends on review', () => {
    const result = enforceStageDependencies(['fix', 'review', 'analyze']);
    expect(result).toEqual(['analyze', 'review', 'fix']);
    expect(logger.info).toHaveBeenCalledWith('Stage order adjusted for dependencies: analyze,review,fix');
  });

  it('should order stages respecting dependencies - report depends on analyze and review', () => {
    const result = enforceStageDependencies(['report', 'review', 'analyze']);
    expect(result).toEqual(['analyze', 'review', 'report']);
    expect(logger.info).toHaveBeenCalledWith('Stage order adjusted for dependencies: analyze,review,report');
  });

  it('should order stages respecting dependencies - judge depends on report and fix', () => {
    const result = enforceStageDependencies(['judge', 'fix', 'report', 'review', 'analyze']);
    expect(result).toEqual(['analyze', 'review', 'report', 'fix', 'judge']);
    expect(logger.info).toHaveBeenCalledWith('Stage order adjusted for dependencies: analyze,review,report,fix,judge');
  });

  it('should warn when dependency is missing - review without analyze', () => {
    const result = enforceStageDependencies(['review']);
    expect(result).toEqual(['review']);
    expect(logger.warn).toHaveBeenCalledWith(
      "Stage 'review' depends on 'analyze' but it's not included. This may cause failures.",
    );
  });

  it('should warn when dependency is missing - fix without review', () => {
    const result = enforceStageDependencies(['fix']);
    expect(result).toEqual(['fix']);
    expect(logger.warn).toHaveBeenCalledWith(
      "Stage 'fix' depends on 'review' but it's not included. This may cause failures.",
    );
  });

  it('should warn when partial dependencies are missing - report without review', () => {
    const result = enforceStageDependencies(['report', 'analyze']);
    expect(result).toEqual(['analyze', 'report']);
    expect(logger.warn).toHaveBeenCalledWith(
      "Stage 'report' depends on 'review' but it's not included. This may cause failures.",
    );
  });

  it('should warn when partial dependencies are missing - report without analyze', () => {
    const result = enforceStageDependencies(['report', 'review']);
    expect(result).toEqual(['review', 'report']);
    expect(logger.warn).toHaveBeenCalledWith(
      "Stage 'report' depends on 'analyze' but it's not included. This may cause failures.",
    );
  });

  it('should warn for multiple missing dependencies - judge without report and fix', () => {
    const result = enforceStageDependencies(['judge']);
    expect(result).toEqual(['judge']);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('should handle empty array', () => {
    const result = enforceStageDependencies([]);
    expect(result).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('should handle stages without dependencies', () => {
    const result = enforceStageDependencies(['analyze']);
    expect(result).toEqual(['analyze']);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('should handle complex dependency chain correctly', () => {
    const result = enforceStageDependencies(['judge', 'analyze', 'fix', 'review', 'report']);
    expect(result).toEqual(['analyze', 'review', 'report', 'fix', 'judge']);
  });

  it('should handle duplicate stages', () => {
    const result = enforceStageDependencies(['analyze', 'analyze', 'review']);
    expect(result).toEqual(['analyze', 'review']);
  });

  it('should handle stages in reverse order', () => {
    const result = enforceStageDependencies(['judge', 'report', 'fix', 'review', 'analyze']);
    expect(result).toEqual(['analyze', 'review', 'report', 'fix', 'judge']);
  });

  it('should handle partial dependency satisfaction', () => {
    const result = enforceStageDependencies(['fix', 'analyze']);
    expect(result).toEqual(['fix', 'analyze']);
    expect(logger.warn).toHaveBeenCalledWith(
      "Stage 'fix' depends on 'review' but it's not included. This may cause failures.",
    );
  });

  it('should handle judge with only report dependency satisfied', () => {
    const result = enforceStageDependencies(['judge', 'report', 'analyze', 'review']);
    expect(result).toEqual(['analyze', 'review', 'report', 'judge']);
    expect(logger.warn).toHaveBeenCalledWith(
      "Stage 'judge' depends on 'fix' but it's not included. This may cause failures.",
    );
  });

  it('should handle judge with only fix dependency satisfied', () => {
    const result = enforceStageDependencies(['judge', 'fix', 'review', 'analyze']);
    expect(result).toEqual(['analyze', 'review', 'fix', 'judge']);
    expect(logger.warn).toHaveBeenCalledWith(
      "Stage 'judge' depends on 'report' but it's not included. This may cause failures.",
    );
  });

  it('should throw error on circular dependency', () => {
    const originalDeps = { ...STAGE_DEPENDENCIES };

    Object.keys(STAGE_DEPENDENCIES).forEach((key) => delete STAGE_DEPENDENCIES[key]);

    Object.assign(STAGE_DEPENDENCIES, {
      a: ['b'],
      b: ['a'],
    });

    expect(() => enforceStageDependencies(['a', 'b'])).toThrow('Circular dependency detected involving stage');

    Object.keys(STAGE_DEPENDENCIES).forEach((key) => delete STAGE_DEPENDENCIES[key]);
    Object.assign(STAGE_DEPENDENCIES, originalDeps);
  });

  it('should handle single stage with missing dependencies warning', () => {
    const result = enforceStageDependencies(['report']);
    expect(result).toEqual(['report']);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('should maintain correct order when stages added in random order', () => {
    const result = enforceStageDependencies(['fix', 'judge', 'analyze', 'report', 'review']);
    expect(result).toEqual(['analyze', 'review', 'fix', 'report', 'judge']);
  });
});

describe('validateAndProcessStages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should validate and process valid stages', () => {
    const result = validateAndProcessStages(['analyze', 'review']);
    expect(result).toEqual(['analyze', 'review']);
  });

  it('should throw error for invalid stages', () => {
    expect(() => validateAndProcessStages(['invalid'])).toThrow(
      'Invalid stages: invalid. Valid stages are: analyze, review, fix, report, judge',
    );
  });

  it('should reorder stages based on dependencies', () => {
    const result = validateAndProcessStages(['review', 'analyze']);
    expect(result).toEqual(['analyze', 'review']);
    expect(logger.info).toHaveBeenCalledWith('Stage order adjusted for dependencies: analyze,review');
  });

  it('should validate before processing dependencies', () => {
    expect(() => validateAndProcessStages(['invalid', 'analyze'])).toThrow(
      'Invalid stages: invalid. Valid stages are: analyze, review, fix, report, judge',
    );
  });

  it('should handle empty array', () => {
    const result = validateAndProcessStages([]);
    expect(result).toEqual([]);
  });

  it('should handle all valid stages', () => {
    const result = validateAndProcessStages(['analyze', 'review', 'fix', 'report', 'judge']);
    expect(result).toEqual(['analyze', 'review', 'fix', 'report', 'judge']);
  });

  it('should handle stages with missing dependencies and warn', () => {
    const result = validateAndProcessStages(['review']);
    expect(result).toEqual(['review']);
    expect(logger.warn).toHaveBeenCalledWith(
      "Stage 'review' depends on 'analyze' but it's not included. This may cause failures.",
    );
  });

  it('should reorder complex dependency chains', () => {
    const result = validateAndProcessStages(['judge', 'analyze', 'fix', 'review', 'report']);
    expect(result).toEqual(['analyze', 'review', 'report', 'fix', 'judge']);
  });

  it('should reject mixed valid and invalid stages', () => {
    expect(() => validateAndProcessStages(['analyze', 'invalid', 'review'])).toThrow();
  });

  it('should handle duplicate valid stages', () => {
    const result = validateAndProcessStages(['analyze', 'analyze']);
    expect(result).toEqual(['analyze']);
  });
});

describe('STAGE_DEPENDENCIES constant', () => {
  it('should have correct dependencies for review', () => {
    expect(STAGE_DEPENDENCIES.review).toEqual(['analyze']);
  });

  it('should have correct dependencies for fix', () => {
    expect(STAGE_DEPENDENCIES.fix).toEqual(['review']);
  });

  it('should have correct dependencies for report', () => {
    expect(STAGE_DEPENDENCIES.report).toEqual(['analyze', 'review']);
  });

  it('should have correct dependencies for judge', () => {
    expect(STAGE_DEPENDENCIES.judge).toEqual(['report', 'fix']);
  });

  it('should not have dependencies for analyze', () => {
    expect(STAGE_DEPENDENCIES.analyze).toBeUndefined();
  });

  it('should have exactly 4 stage entries', () => {
    const keys = Object.keys(STAGE_DEPENDENCIES);
    expect(keys).toHaveLength(4);
  });
});
