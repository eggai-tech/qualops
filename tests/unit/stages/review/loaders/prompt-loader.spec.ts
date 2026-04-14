import { PromptLoader } from '@/stages/review/loaders/prompt-loader';

describe('PromptLoader', () => {
  beforeEach(() => {
    PromptLoader.clearCache();
  });

  describe('path traversal protection', () => {
    it('rejects ../ traversal', async () => {
      await expect(PromptLoader.load('../../../etc/passwd')).rejects.toThrow(
        /resolves outside the prompts directory/,
      );
    });

    it('rejects embedded traversal that escapes base', async () => {
      await expect(PromptLoader.load('foo/../../../../etc/passwd')).rejects.toThrow(
        /resolves outside the prompts directory/,
      );
    });

    it('rejects absolute path', async () => {
      await expect(PromptLoader.load('/etc/passwd')).rejects.toThrow(
        /resolves outside the prompts directory/,
      );
    });

    it('rejects traversal in promptConfig object', async () => {
      await expect(PromptLoader.load({ file: '../../../etc/passwd', meta: {} })).rejects.toThrow(
        /resolves outside the prompts directory/,
      );
    });

    it('does not reject normal relative path (fails with file not found, not traversal)', async () => {
      await expect(PromptLoader.load('nonexistent.md')).rejects.toThrow(/Failed to load prompt/);
      await expect(PromptLoader.load('nonexistent.md')).rejects.not.toThrow(
        /resolves outside the prompts directory/,
      );
    });
  });
});
