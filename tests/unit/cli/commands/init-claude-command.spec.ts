import { existsSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { Provider } from '@/cli/commands/init-claude-command';
import {
  generateDefaultConfig,
  getPackageRoot,
  initClaudeCommand,
} from '@/cli/commands/init-claude-command';
import { logger } from '@/shared/utils/logger';
import { validateConfig } from '@/shared/utils/validate-config';

jest.mock('@/shared/utils/logger');

describe('validateConfig', () => {
  it('accepts a valid minimal config', () => {
    const config = generateDefaultConfig('anthropic');
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects config missing required ai field', () => {
    const config = {
      review: {
        pipeline: [
          {
            name: 'test',
            enabled: true,
            passes: [{ name: 'p', enabled: true, prompt: 'x.md' }],
          },
        ],
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('ai'))).toBe(true);
  });

  it('rejects config with invalid provider', () => {
    const config = {
      ai: {
        reviewStage: {
          provider: 'invalid-provider',
          model: 'some-model',
          inputPerMillion: 1,
          outputPerMillion: 1,
        },
      },
      review: {
        pipeline: [
          {
            name: 'test',
            enabled: true,
            passes: [{ name: 'p', enabled: true, prompt: 'x.md' }],
          },
        ],
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('provider'))).toBe(true);
  });
});

describe('initClaudeCommand', () => {
  let tempDir: string;
  let originalCwd: () => string;
  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), 'qualops-test-'));
    originalCwd = process.cwd;
    process.cwd = () => tempDir;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('generates valid .qualopsrc.json that passes schema validation', async () => {
    await initClaudeCommand();

    const configPath = join(tempDir, '.qualops', '.qualopsrc.json');
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
  });

  it('does NOT overwrite existing .qualopsrc.json', async () => {
    const qualopsDir = join(tempDir, '.qualops');
    mkdirSync(qualopsDir, { recursive: true });
    const configPath = join(qualopsDir, '.qualopsrc.json');
    writeFileSync(configPath, '{"existing": true}');

    await initClaudeCommand();

    const content = readFileSync(configPath, 'utf-8');
    expect(JSON.parse(content)).toEqual({ existing: true });
    expect(logger.warn).toHaveBeenCalledWith(
      '.qualops/.qualopsrc.json already exists — skipping config generation',
    );
  });

  it('copies qualops-llm.txt', async () => {
    const packageRoot = getPackageRoot();
    const llmSource = join(packageRoot, 'qualops-llm.txt');
    if (!existsSync(llmSource)) {
      // Skip if the source doesn't exist in the build environment
      return;
    }

    await initClaudeCommand();

    const localLlm = join(tempDir, '.qualops', 'qualops-llm.txt');
    expect(existsSync(localLlm)).toBe(true);
  });

  it('creates .claude/commands/qualops-setup.md', async () => {
    await initClaudeCommand();

    const commandFile = join(tempDir, '.claude', 'commands', 'qualops-setup.md');
    expect(existsSync(commandFile)).toBe(true);

    const content = readFileSync(commandFile, 'utf-8');
    expect(content).toContain('QualOps Setup Customizer');
    expect(content).toContain('$file:.qualops/qualops-llm.txt');
  });

  it('creates default quality prompt file', async () => {
    await initClaudeCommand();

    const promptFile = join(tempDir, '.qualops', 'prompts', 'review', 'quality.md');
    expect(existsSync(promptFile)).toBe(true);

    const content = readFileSync(promptFile, 'utf-8');
    expect(content).toContain('Code Quality Review');
  });

  it('--provider openai produces correct provider/model/pricing', async () => {
    await initClaudeCommand({ provider: 'openai' });

    const configPath = join(tempDir, '.qualops', '.qualopsrc.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));

    expect(config.ai.reviewStage.provider).toBe('openai');
    expect(config.ai.reviewStage.model).toBe('gpt-4.1');
    expect(config.ai.reviewStage.inputPerMillion).toBe(2);
    expect(config.ai.reviewStage.outputPerMillion).toBe(8);

    const result = validateConfig(config);
    expect(result.valid).toBe(true);
  });

  it('--provider bedrock produces correct provider/model/pricing', async () => {
    await initClaudeCommand({ provider: 'bedrock' });

    const configPath = join(tempDir, '.qualops', '.qualopsrc.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));

    expect(config.ai.reviewStage.provider).toBe('bedrock');
    expect(config.ai.reviewStage.model).toBe('us.anthropic.claude-sonnet-4-6-v1:0');
    expect(config.ai.reviewStage.inputPerMillion).toBe(3);
    expect(config.ai.reviewStage.outputPerMillion).toBe(15);

    const result = validateConfig(config);
    expect(result.valid).toBe(true);
  });
});

describe('generateDefaultConfig', () => {
  const providers: Provider[] = ['anthropic', 'openai', 'bedrock'];

  it.each(providers)('generates valid config for provider %s', (provider) => {
    const config = generateDefaultConfig(provider);
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
  });
});
