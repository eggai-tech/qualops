import { readFile, writeFile } from 'node:fs/promises';

import type { FixSuggestion } from '../../../shared/types/index.ts';
import { createBackup } from './backup-manager';
import { applyMultipleFixes, applySafeFixes, applySingleFix, canApplyFix } from './fix-applier';

jest.mock('node:fs/promises');
jest.mock('../../../shared/utils/file-utils.ts');
jest.mock('../../../shared/utils/logger.ts');
jest.mock('./backup-manager');

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockCreateBackup = createBackup as jest.MockedFunction<typeof createBackup>;

describe('applySingleFix', () => {
  let mockSuggestion: FixSuggestion;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateBackup.mockResolvedValue('/backup/path.ts.backup');
    mockWriteFile.mockResolvedValue(undefined);

    mockSuggestion = {
      issueId: 'issue-1',
      file: '/project/test.ts',
      line: 10,
      originalCode: 'const x = 1;',
      suggestedCode: 'const x = 2;',
      explanation: 'Update value',
      confidence: 'high' as const,
      breaking: false,
      applied: false,
    };
  });

  describe('dry run mode', () => {
    it('should not modify files in dry run mode', async () => {
      const result = await applySingleFix(mockSuggestion, { dryRun: true });

      expect(result.success).toBe(true);
      expect(mockReadFile).not.toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockCreateBackup).not.toHaveBeenCalled();
    });

    it('should calculate changes in dry run mode', async () => {
      mockSuggestion.originalCode = 'line1\nline2\nline3';
      mockSuggestion.suggestedCode = 'line1\nmodified\nline3\nline4';

      const result = await applySingleFix(mockSuggestion, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.appliedChanges.linesAdded).toBe(1);
      expect(result.appliedChanges.linesModified).toBeGreaterThanOrEqual(0);
    });

    it('should return success for valid suggestion in dry run', async () => {
      const result = await applySingleFix(mockSuggestion, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.filePath).toBe('/project/test.ts');
    });
  });

  describe('exact match replacement', () => {
    it('should apply fix with exact match', async () => {
      const fileContent = 'function test() {\n  const x = 1;\n  return x;\n}';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
      expect(mockWriteFile).toHaveBeenCalledWith('/project/test.ts', expect.stringContaining('const x = 2;'));
    });

    it('should handle multiple occurrences using first match', async () => {
      const fileContent = 'const x = 1;\nconst y = 1;\nconst x = 1;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
      const writeCall = mockWriteFile.mock.calls[0];
      const newContent = writeCall[1] as string;
      const occurrences = (newContent.match(/const x = 2;/g) || []).length;
      expect(occurrences).toBe(1);
    });

    it('should normalize line endings before matching', async () => {
      const fileContent = 'function test() {\r\n  const x = 1;\r\n}';
      mockSuggestion.originalCode = 'const x = 1;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
    });

    it('should handle CRLF line endings', async () => {
      const fileContent = 'line1\r\nconst x = 1;\r\nline3';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
    });

    it('should handle CR line endings', async () => {
      const fileContent = 'line1\rconst x = 1;\rline3';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
    });
  });

  describe('fuzzy match replacement', () => {
    it('should apply fix with fuzzy match when exact match fails', async () => {
      const fileContent = 'function test() {\n    const x = 1;\n  return x;\n}';
      mockSuggestion.originalCode = '  const x = 1;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
    });

    it('should preserve indentation in fuzzy match', async () => {
      const fileContent = 'function test() {\n    const x = 1;\n  return x;\n}';
      mockSuggestion.originalCode = 'const x = 1;';
      mockSuggestion.suggestedCode = 'const x = 2;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
      const writeCall = mockWriteFile.mock.calls[0];
      const newContent = writeCall[1] as string;
      expect(newContent).toContain('    const x = 2;');
    });

    it('should handle tabs in indentation', async () => {
      const fileContent = 'function test() {\n\t\tconst x = 1;\n}';
      mockSuggestion.originalCode = 'const x = 1;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
    });

    it('should trim whitespace for fuzzy matching', async () => {
      const fileContent = '  const x = 1;  \n';
      mockSuggestion.originalCode = 'const x = 1;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
    });

    it('should preserve indentation when applying fuzzy match with spaces', async () => {
      const fileContent = '    const x = 1;';
      mockSuggestion.originalCode = 'const x = 1;';
      mockSuggestion.suggestedCode = 'const x = 2;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
      const writeCall = mockWriteFile.mock.calls[0];
      const newContent = writeCall[1] as string;
      expect(newContent).toContain('    const x = 2;');
    });

    it('should handle fuzzy match with leading whitespace on first line only', async () => {
      const fileContent = '    const x = 1;';
      mockSuggestion.originalCode = 'const x = 1;';
      mockSuggestion.suggestedCode = 'const x = 2;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
      const writeCall = mockWriteFile.mock.calls[0];
      const newContent = writeCall[1] as string;
      expect(newContent).toContain('    const x = 2;');
    });

    it('should apply fuzzy match for code with trailing whitespace', async () => {
      const fileContent = 'function test() {\n  const x = 1;  \n}';
      mockSuggestion.originalCode = '  const x = 1;  ';
      mockSuggestion.suggestedCode = 'const x = 2;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
    });
  });

  describe('backup creation', () => {
    it('should create backup by default', async () => {
      const fileContent = 'const x = 1;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(mockCreateBackup).toHaveBeenCalledWith('/project/test.ts', fileContent);
      expect(result.backupPath).toBe('/backup/path.ts.backup');
    });

    it('should skip backup when createBackup is false', async () => {
      const fileContent = 'const x = 1;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion, { createBackup: false });

      expect(mockCreateBackup).not.toHaveBeenCalled();
      expect(result.backupPath).toBeUndefined();
    });

    it('should include backup path in result', async () => {
      const fileContent = 'const x = 1;';
      mockReadFile.mockResolvedValue(fileContent);
      mockCreateBackup.mockResolvedValue('/custom/backup.ts');

      const result = await applySingleFix(mockSuggestion, { createBackup: true });

      expect(result.success).toBe(true);
      expect(result.backupPath).toBe('/custom/backup.ts');
    });
  });

  describe('change calculation', () => {
    it('should calculate lines added', async () => {
      const fileContent = 'const x = 1;';
      mockSuggestion.originalCode = 'const x = 1;';
      mockSuggestion.suggestedCode = 'const x = 1;\nconst y = 2;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
      expect(result.appliedChanges.linesAdded).toBe(1);
    });

    it('should calculate lines removed', async () => {
      const fileContent = 'const x = 1;\nconst y = 2;';
      mockSuggestion.originalCode = 'const x = 1;\nconst y = 2;';
      mockSuggestion.suggestedCode = 'const x = 1;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
      expect(result.appliedChanges.linesRemoved).toBe(1);
    });

    it('should calculate lines modified', async () => {
      const fileContent = 'const x = 1;\nconst y = 2;';
      mockSuggestion.originalCode = 'const x = 1;\nconst y = 2;';
      mockSuggestion.suggestedCode = 'const x = 3;\nconst y = 4;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
      expect(result.appliedChanges.linesModified).toBe(2);
    });

    it('should handle no changes', async () => {
      const fileContent = 'const x = 1;';
      mockSuggestion.originalCode = 'const x = 1;';
      mockSuggestion.suggestedCode = 'const x = 1;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
      expect(result.appliedChanges.linesAdded).toBe(0);
      expect(result.appliedChanges.linesRemoved).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should return error when file cannot be read', async () => {
      mockReadFile.mockRejectedValue(new Error('File not found'));

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should return error when file cannot be written', async () => {
      mockReadFile.mockResolvedValue('const x = 1;');
      mockWriteFile.mockRejectedValue(new Error('Permission denied'));

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });

    it('should return error when original code not found', async () => {
      mockReadFile.mockResolvedValue('const y = 2;');

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not locate original code in file');
    });

    it('should return error when suggestedCode is missing', async () => {
      mockSuggestion.suggestedCode = '';

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No suggested code provided');
    });

    it('should allow empty suggestedCode with force option', async () => {
      mockSuggestion.suggestedCode = '';
      mockReadFile.mockResolvedValue('const x = 1;');

      const result = await applySingleFix(mockSuggestion, { force: true });

      expect(result.success).toBe(true);
    });

    it('should handle non-Error exceptions', async () => {
      mockReadFile.mockRejectedValue('string error');

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle empty file', async () => {
      mockReadFile.mockResolvedValue('');
      mockSuggestion.originalCode = '';
      mockSuggestion.suggestedCode = 'const x = 1;';

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
    });

    it('should handle very large files', async () => {
      const largeContent = 'x'.repeat(1000000);
      mockReadFile.mockResolvedValue(largeContent + '\nconst x = 1;');

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
    });

    it('should handle unicode characters', async () => {
      const fileContent = 'const message = "你好世界";\nconst x = 1;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
    });

    it('should handle special regex characters in code', async () => {
      const fileContent = 'const regex = /[a-z]+/g;';
      mockSuggestion.originalCode = 'const regex = /[a-z]+/g;';
      mockSuggestion.suggestedCode = 'const regex = /[A-Za-z]+/g;';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
    });

    it('should handle multiline code blocks', async () => {
      const fileContent = 'function test() {\n  const x = 1;\n  return x;\n}';
      mockSuggestion.originalCode = 'function test() {\n  const x = 1;\n  return x;\n}';
      mockSuggestion.suggestedCode = 'function test() {\n  const x = 2;\n  return x;\n}';
      mockReadFile.mockResolvedValue(fileContent);

      const result = await applySingleFix(mockSuggestion);

      expect(result.success).toBe(true);
    });
  });
});

describe('applyMultipleFixes', () => {
  let mockSuggestions: FixSuggestion[];

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateBackup.mockResolvedValue('/backup/path.ts.backup');
    mockWriteFile.mockResolvedValue(undefined);

    mockSuggestions = [
      {
        issueId: 'issue-1',
        file: '/project/test1.ts',
        line: 10,
        originalCode: 'const x = 1;',
        suggestedCode: 'const x = 2;',
        explanation: 'Update value',
        confidence: 'high' as const,
        breaking: false,
        applied: false,
      },
      {
        issueId: 'issue-2',
        file: '/project/test2.ts',
        line: 20,
        originalCode: 'const y = 1;',
        suggestedCode: 'const y = 2;',
        explanation: 'Update value',
        confidence: 'high' as const,
        breaking: false,
        applied: false,
      },
    ];
  });

  it('should apply all fixes successfully', async () => {
    mockReadFile.mockResolvedValueOnce('const x = 1;').mockResolvedValueOnce('const y = 1;');

    const results = await applyMultipleFixes(mockSuggestions);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('should apply fixes sequentially', async () => {
    mockReadFile.mockResolvedValueOnce('const x = 1;').mockResolvedValueOnce('const y = 1;');

    const results = await applyMultipleFixes(mockSuggestions);

    expect(results).toHaveLength(2);
    expect(mockReadFile).toHaveBeenCalledTimes(2);
  });

  it('should mark suggestions as applied on success', async () => {
    mockReadFile.mockResolvedValueOnce('const x = 1;').mockResolvedValueOnce('const y = 1;');

    await applyMultipleFixes(mockSuggestions);

    expect(mockSuggestions[0].applied).toBe(true);
    expect(mockSuggestions[1].applied).toBe(true);
  });

  it('should not mark suggestions as applied on failure', async () => {
    mockReadFile.mockRejectedValue(new Error('File not found'));

    await applyMultipleFixes(mockSuggestions);

    expect(mockSuggestions[0].applied).toBe(false);
    expect(mockSuggestions[1].applied).toBe(false);
  });

  it('should continue processing after failures', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('File not found')).mockResolvedValueOnce('const y = 1;');

    const results = await applyMultipleFixes(mockSuggestions);

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[1].success).toBe(true);
  });

  it('should pass options to each fix', async () => {
    mockReadFile.mockResolvedValue('test');

    await applyMultipleFixes(mockSuggestions, { dryRun: true });

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should handle empty array', async () => {
    const results = await applyMultipleFixes([]);

    expect(results).toHaveLength(0);
  });

  it('should handle single suggestion', async () => {
    mockReadFile.mockResolvedValue('const x = 1;');

    const results = await applyMultipleFixes([mockSuggestions[0]]);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
  });

  it('should collect all results', async () => {
    mockReadFile.mockResolvedValue('const x = 1;');

    const results = await applyMultipleFixes(mockSuggestions);

    expect(results).toHaveLength(2);
    results.forEach((result) => {
      expect(result.filePath).toBeDefined();
      expect(result.appliedChanges).toBeDefined();
    });
  });

  it('should handle mixed success and failure', async () => {
    mockReadFile
      .mockResolvedValueOnce('const x = 1;')
      .mockRejectedValueOnce(new Error('Error'))
      .mockResolvedValueOnce('const z = 1;');

    const suggestions = [
      ...mockSuggestions,
      {
        issueId: 'issue-3',
        file: '/project/test3.ts',
        line: 30,
        originalCode: 'const z = 1;',
        suggestedCode: 'const z = 2;',
        explanation: 'Update value',
        confidence: 'high' as const,
        breaking: false,
        applied: false,
      },
    ];

    const results = await applyMultipleFixes(suggestions);

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[2].success).toBe(true);
  });
});

describe('applySafeFixes', () => {
  let mockSuggestions: FixSuggestion[];

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateBackup.mockResolvedValue('/backup/path.ts.backup');
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('const x = 1;');

    mockSuggestions = [
      {
        issueId: 'issue-1',
        file: '/project/test1.ts',
        line: 10,
        originalCode: 'const x = 1;',
        suggestedCode: 'const x = 2;',
        explanation: 'Safe fix',
        confidence: 'high' as const,
        breaking: false,
        applied: false,
      },
      {
        issueId: 'issue-2',
        file: '/project/test2.ts',
        line: 20,
        originalCode: 'const y = 1;',
        suggestedCode: 'const y = 2;',
        explanation: 'Medium confidence fix',
        confidence: 'medium',
        breaking: false,
        applied: false,
      },
      {
        issueId: 'issue-3',
        file: '/project/test3.ts',
        line: 30,
        originalCode: 'const z = 1;',
        suggestedCode: 'const z = 2;',
        explanation: 'Breaking fix',
        confidence: 'high',
        breaking: true,
        applied: false,
      },
      {
        issueId: 'issue-4',
        file: '/project/test4.ts',
        line: 40,
        originalCode: 'const a = 1;',
        suggestedCode: '',
        explanation: 'No suggestion',
        confidence: 'high' as const,
        breaking: false,
        applied: false,
      },
    ];
  });

  it('should apply only high confidence, non-breaking fixes', async () => {
    const results = await applySafeFixes(mockSuggestions);

    expect(results).toHaveLength(1);
    expect(results[0].filePath).toBe('/project/test1.ts');
  });

  it('should filter out medium confidence fixes', async () => {
    const results = await applySafeFixes(mockSuggestions);

    const appliedFiles = results.map((r) => r.filePath);
    expect(appliedFiles).not.toContain('/project/test2.ts');
  });

  it('should filter out breaking fixes', async () => {
    const results = await applySafeFixes(mockSuggestions);

    const appliedFiles = results.map((r) => r.filePath);
    expect(appliedFiles).not.toContain('/project/test3.ts');
  });

  it('should filter out fixes without suggested code', async () => {
    const results = await applySafeFixes(mockSuggestions);

    const appliedFiles = results.map((r) => r.filePath);
    expect(appliedFiles).not.toContain('/project/test4.ts');
  });

  it('should handle all safe suggestions', async () => {
    const safeSuggestions = mockSuggestions.filter((s) => s.confidence === 'high' && !s.breaking && s.suggestedCode);

    const results = await applySafeFixes(mockSuggestions);

    expect(results).toHaveLength(safeSuggestions.length);
  });

  it('should handle no safe suggestions', async () => {
    const unsafeSuggestions = mockSuggestions.filter((s) => s.confidence !== 'high' || s.breaking);

    const results = await applySafeFixes(unsafeSuggestions);

    expect(results).toHaveLength(0);
  });

  it('should pass options to apply function', async () => {
    await applySafeFixes(mockSuggestions, { dryRun: true });

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should handle empty array', async () => {
    const results = await applySafeFixes([]);

    expect(results).toHaveLength(0);
  });

  it('should handle low confidence fixes', async () => {
    const lowConfidenceSuggestion: FixSuggestion = {
      issueId: 'issue-5',
      file: '/project/test5.ts',
      line: 50,
      originalCode: 'const b = 1;',
      suggestedCode: 'const b = 2;',
      explanation: 'Low confidence',
      confidence: 'low' as const,
      breaking: false,
      applied: false,
    };

    const results = await applySafeFixes([...mockSuggestions, lowConfidenceSuggestion]);

    const appliedFiles = results.map((r) => r.filePath);
    expect(appliedFiles).not.toContain('/project/test5.ts');
  });
});

describe('canApplyFix', () => {
  let mockSuggestion: FixSuggestion;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSuggestion = {
      issueId: 'issue-1',
      file: '/project/test.ts',
      line: 10,
      originalCode: 'const x = 1;',
      suggestedCode: 'const x = 2;',
      explanation: 'Update value',
      confidence: 'high' as const,
      breaking: false,
      applied: false,
    };
  });

  describe('exact match detection', () => {
    it('should return true for exact match', async () => {
      mockReadFile.mockResolvedValue('const x = 1;');

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should detect match in larger file', async () => {
      mockReadFile.mockResolvedValue('function test() {\n  const x = 1;\n  return x;\n}');

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(true);
    });

    it('should handle normalized line endings', async () => {
      mockReadFile.mockResolvedValue('const x = 1;\r\n');

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(true);
    });
  });

  describe('fuzzy match detection', () => {
    it('should return true for fuzzy match', async () => {
      mockReadFile.mockResolvedValue('  const x = 1;  ');

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(true);
    });

    it('should detect match with different indentation', async () => {
      mockReadFile.mockResolvedValue('    const x = 1;');

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(true);
    });

    it('should detect match with tabs', async () => {
      mockReadFile.mockResolvedValue('\t\tconst x = 1;');

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(true);
    });

    it('should detect trimmed match when exact match fails', async () => {
      mockReadFile.mockResolvedValue('  const x = 1;  \n');
      mockSuggestion.originalCode = 'const x = 1;';

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(true);
    });
  });

  describe('match failure', () => {
    it('should return false when code not found', async () => {
      mockReadFile.mockResolvedValue('const y = 2;');

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(false);
      expect(result.reason).toContain('Original code not found');
    });

    it('should provide reason for failure', async () => {
      mockReadFile.mockResolvedValue('different content');

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('may have been modified');
    });

    it('should handle file modifications', async () => {
      mockReadFile.mockResolvedValue('const x = 3;');

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(false);
      expect(result.reason).toContain('Original code not found');
    });
  });

  describe('error handling', () => {
    it('should return false when file cannot be read', async () => {
      mockReadFile.mockRejectedValue(new Error('File not found'));

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(false);
      expect(result.reason).toContain('File access error');
    });

    it('should include error message in reason', async () => {
      mockReadFile.mockRejectedValue(new Error('Permission denied'));

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(false);
      expect(result.reason).toContain('Permission denied');
    });

    it('should handle non-Error exceptions', async () => {
      mockReadFile.mockRejectedValue('string error');

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle empty file', async () => {
      mockReadFile.mockResolvedValue('');
      mockSuggestion.originalCode = '';

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(true);
    });

    it('should handle multiline original code', async () => {
      mockSuggestion.originalCode = 'line1\nline2\nline3';
      mockReadFile.mockResolvedValue('line1\nline2\nline3');

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(true);
    });

    it('should handle special characters', async () => {
      mockSuggestion.originalCode = 'const regex = /[a-z]+/;';
      mockReadFile.mockResolvedValue('const regex = /[a-z]+/;');

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(true);
    });

    it('should handle unicode content', async () => {
      mockSuggestion.originalCode = 'const msg = "你好";';
      mockReadFile.mockResolvedValue('const msg = "你好";');

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(true);
    });

    it('should handle very long files', async () => {
      const longContent = 'x'.repeat(100000) + '\nconst x = 1;';
      mockReadFile.mockResolvedValue(longContent);

      const result = await canApplyFix(mockSuggestion);

      expect(result.canApply).toBe(true);
    });
  });
});

describe('integration scenarios', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateBackup.mockResolvedValue('/backup/path.ts.backup');
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('should handle complete workflow for single fix', async () => {
    const suggestion: FixSuggestion = {
      issueId: 'issue-1',
      file: '/project/test.ts',
      line: 10,
      originalCode: 'const x = 1;',
      suggestedCode: 'const x = 2;',
      explanation: 'Update value',
      confidence: 'high' as const,
      breaking: false,
      applied: false,
    };

    mockReadFile.mockResolvedValue('const x = 1;');

    const canApply = await canApplyFix(suggestion);
    expect(canApply.canApply).toBe(true);

    const result = await applySingleFix(suggestion);
    expect(result.success).toBe(true);
    expect(suggestion.applied).toBe(false);
  });

  it('should handle batch processing with mixed results', async () => {
    const suggestions: FixSuggestion[] = [
      {
        issueId: 'issue-1',
        file: '/project/test1.ts',
        line: 10,
        originalCode: 'const x = 1;',
        suggestedCode: 'const x = 2;',
        explanation: 'Fix 1',
        confidence: 'high' as const,
        breaking: false,
        applied: false,
      },
      {
        issueId: 'issue-2',
        file: '/project/test2.ts',
        line: 20,
        originalCode: 'const y = 1;',
        suggestedCode: 'const y = 2;',
        explanation: 'Fix 2',
        confidence: 'medium' as const,
        breaking: false,
        applied: false,
      },
    ];

    mockReadFile.mockResolvedValue('const x = 1;');

    const safeResults = await applySafeFixes(suggestions);
    expect(safeResults).toHaveLength(1);

    const allResults = await applyMultipleFixes(suggestions);
    expect(allResults).toHaveLength(2);
  });

  it('should handle file with multiple potential matches', async () => {
    const suggestion: FixSuggestion = {
      issueId: 'issue-1',
      file: '/project/test.ts',
      line: 10,
      originalCode: 'const x = 1;',
      suggestedCode: 'const x = 2;',
      explanation: 'Update value',
      confidence: 'high' as const,
      breaking: false,
      applied: false,
    };

    mockReadFile.mockResolvedValue('const x = 1;\nconst x = 1;\nconst x = 1;');

    const result = await applySingleFix(suggestion);
    expect(result.success).toBe(true);

    const writeCall = mockWriteFile.mock.calls[0];
    const newContent = writeCall[1] as string;
    const replacements = (newContent.match(/const x = 2;/g) || []).length;
    expect(replacements).toBe(1);
  });
});
