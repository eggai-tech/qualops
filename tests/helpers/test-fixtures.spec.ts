import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { addFile, createMockAIProvider, createTestProject } from '@tests/helpers/test-fixtures';

describe('test-fixtures', () => {
  const TEST_DIR = join(__dirname, '../../../test-output/test-fixtures-tests');

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('createTestProject', () => {
    it('should create a test project with cleanup function', () => {
      const project = createTestProject(TEST_DIR, 'test-project');

      expect(project.root).toContain('test-project');
      expect(project.files).toBeInstanceOf(Map);
      expect(typeof project.cleanup).toBe('function');
      expect(existsSync(project.root)).toBe(true);

      project.cleanup();
      expect(existsSync(project.root)).toBe(false);
    });

    it('should create baseDir if it does not exist', () => {
      const nonExistentBase = join(TEST_DIR, 'non-existent', 'nested', 'path');
      expect(existsSync(nonExistentBase)).toBe(false);

      const project = createTestProject(nonExistentBase, 'test-project');

      expect(existsSync(nonExistentBase)).toBe(true);
      expect(existsSync(project.root)).toBe(true);

      project.cleanup();
    });

    it('should create separate projects with different names', () => {
      const project1 = createTestProject(TEST_DIR, 'project1');
      const project2 = createTestProject(TEST_DIR, 'project2');

      expect(project1.root).not.toBe(project2.root);
      expect(existsSync(project1.root)).toBe(true);
      expect(existsSync(project2.root)).toBe(true);

      project1.cleanup();
      project2.cleanup();
    });
  });

  describe('addFile', () => {
    it('should add a file to the project', () => {
      const project = createTestProject(TEST_DIR, 'test-project');
      addFile(project, 'src/test.ts', 'export const test = true;');

      const filePath = join(project.root, 'src/test.ts');
      expect(existsSync(filePath)).toBe(true);
      expect(project.files.has('src/test.ts')).toBe(true);
      expect(project.files.get('src/test.ts')).toBe('export const test = true;');

      project.cleanup();
    });

    it('should create nested directories for file path', () => {
      const project = createTestProject(TEST_DIR, 'test-project');
      addFile(project, 'src/deep/nested/file.ts', 'content');

      const filePath = join(project.root, 'src/deep/nested/file.ts');
      expect(existsSync(filePath)).toBe(true);

      project.cleanup();
    });

    it('should add multiple files to the project', () => {
      const project = createTestProject(TEST_DIR, 'test-project');
      addFile(project, 'file1.ts', 'content1');
      addFile(project, 'file2.ts', 'content2');

      expect(project.files.size).toBe(2);
      expect(project.files.get('file1.ts')).toBe('content1');
      expect(project.files.get('file2.ts')).toBe('content2');

      project.cleanup();
    });
  });

  describe('createMockAIProvider', () => {
    it('should create a mock AI provider with all required methods', () => {
      const provider = createMockAIProvider();

      expect(provider.name).toBe('mock');
      expect(typeof provider.initialize).toBe('function');
      expect(typeof provider.complete).toBe('function');
      expect(typeof provider.completeWithStructure).toBe('function');
      expect(typeof provider.invoke).toBe('function');
      expect(typeof provider.isAvailable).toBe('function');
      expect(typeof provider.getModelName).toBe('function');
      expect(typeof provider.getMaxTokens).toBe('function');
      expect(typeof provider.getTokenStats).toBe('function');
      expect(typeof provider.resetTokenStats).toBe('function');
    });

    it('should return mocked values for provider methods', async () => {
      const provider = createMockAIProvider();

      expect(await provider.initialize()).toBeUndefined();
      expect(await provider.complete()).toEqual({
        content: 'Mock AI response',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });
      expect(await provider.completeWithStructure()).toEqual({});
      expect(await provider.invoke()).toBe('Mock response');
      expect(provider.isAvailable()).toBe(true);
      expect(provider.getModelName()).toBe('claude-sonnet-4-20250514');
      expect(provider.getMaxTokens()).toBe(4000);
    });

    it('should return token stats with expected structure', () => {
      const provider = createMockAIProvider();
      const stats = provider.getTokenStats();

      expect(stats).toHaveProperty('invocationCount');
      expect(stats).toHaveProperty('totalInputTokens');
      expect(stats).toHaveProperty('totalOutputTokens');
      expect(stats).toHaveProperty('totalTokens');
      expect(stats).toHaveProperty('estimatedCost');
      expect(stats).toHaveProperty('startTime');
      expect(stats.startTime).toBeInstanceOf(Date);
    });
  });
});
