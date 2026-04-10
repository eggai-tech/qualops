import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { getPackageRoot, initClaudeCommand } from '@/cli/commands/init-claude-command';
import { logger } from '@/shared/utils/logger';

jest.mock('@/shared/utils/logger');

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

  it('creates .qualopsrc.json', async () => {
    await initClaudeCommand();

    const configPath = join(tempDir, '.qualops', '.qualopsrc.json');
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.ai.reviewStage.provider).toBe('anthropic');
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
      throw new Error(
        `Required file qualops-llm.txt not found at ${llmSource} — this file must be present for init scaffolding.`,
      );
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
    expect(content).toContain('QualOps Setup Wizard');
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
  });

  it('--provider bedrock produces correct provider/model/pricing', async () => {
    await initClaudeCommand({ provider: 'bedrock' });

    const configPath = join(tempDir, '.qualops', '.qualopsrc.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));

    expect(config.ai.reviewStage.provider).toBe('bedrock');
    expect(config.ai.reviewStage.model).toBe('us.anthropic.claude-sonnet-4-6-v1:0');
    expect(config.ai.reviewStage.inputPerMillion).toBe(3);
    expect(config.ai.reviewStage.outputPerMillion).toBe(15);
  });
});
