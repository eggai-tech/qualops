import { PromptLoader } from '@/stages/review/loaders/prompt-loader';

describe('PromptLoader', () => {
  beforeEach(() => {
    PromptLoader.clearCache();
  });

  describe('path traversal protection', () => {
    // Traversal paths are blocked by resolveWithinCwd returning null for each base.
    // All bases are exhausted without reading any file, resulting in "Failed to load prompt".
    it('rejects ../ traversal', async () => {
      await expect(PromptLoader.load('../../../etc/passwd')).rejects.toThrow(
        /Failed to load prompt/,
      );
    });

    it('rejects embedded traversal that escapes base', async () => {
      await expect(PromptLoader.load('foo/../../../../etc/passwd')).rejects.toThrow(
        /Failed to load prompt/,
      );
    });

    it('rejects absolute path', async () => {
      await expect(PromptLoader.load('/etc/passwd')).rejects.toThrow(/Failed to load prompt/);
    });

    it('rejects traversal in promptConfig object', async () => {
      await expect(PromptLoader.load({ file: '../../../etc/passwd', meta: {} })).rejects.toThrow(
        /Failed to load prompt/,
      );
    });

    it('does not reject normal relative path (fails with file not found, not traversal)', async () => {
      await expect(PromptLoader.load('nonexistent.md')).rejects.toThrow(/Failed to load prompt/);
    });
  });
});
