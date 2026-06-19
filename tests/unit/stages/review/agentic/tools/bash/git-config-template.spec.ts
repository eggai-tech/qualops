import * as fs from 'fs';

import {
  cleanupGitConfig,
  getGitConfigContent,
  getGitConfigPath,
} from '@/stages/review/agentic/tools/bash/git-config-template';

describe('git-config-template', () => {
  afterEach(() => {
    cleanupGitConfig();
  });

  it('returns hardened security settings regardless of workspaceRoot', () => {
    const content = getGitConfigContent();
    expect(content).toContain('hooksPath = /dev/null');
    expect(content).toContain('fsmonitor = false');
    expect(content).toContain('helper = /bin/false');
  });

  it('CI root includes both /workspace/pr and /workspace/base as safe directories', () => {
    const content = getGitConfigContent('/workspace/pr');
    expect(content).toContain('directory = /workspace/pr');
    expect(content).toContain('directory = /workspace/base');
  });

  it('local root uses only the actual checkout path as safe directory', () => {
    const localRoot = '/home/runner/work/my-repo/my-repo';
    const content = getGitConfigContent(localRoot);
    expect(content).toContain(`directory = ${localRoot}`);
    expect(content).not.toContain('/workspace/pr');
    expect(content).not.toContain('/workspace/base');
  });

  it('getGitConfigPath writes a file containing the correct safe.directory', () => {
    const localRoot = '/home/runner/work/my-repo/my-repo';
    const p = getGitConfigPath(localRoot);
    expect(fs.existsSync(p)).toBe(true);
    const written = fs.readFileSync(p, 'utf8');
    expect(written).toContain(`directory = ${localRoot}`);
  });

  it('getGitConfigPath is idempotent for the same root', () => {
    const p1 = getGitConfigPath('/workspace/pr');
    const p2 = getGitConfigPath('/workspace/pr');
    expect(p1).toBe(p2);
  });

  it('cleanupGitConfig removes the temp file', () => {
    const p = getGitConfigPath();
    expect(fs.existsSync(p)).toBe(true);
    cleanupGitConfig();
    expect(fs.existsSync(p)).toBe(false);
  });

  it('cleanupGitConfig is a no-op when called without a path', () => {
    expect(() => cleanupGitConfig()).not.toThrow();
  });

  it('throws when workspaceRoot contains a newline (config injection attempt)', () => {
    expect(() => getGitConfigContent('/workspace/pr\n[core]\n\thooksPath = /tmp/evil')).toThrow(
      'Invalid workspaceRoot',
    );
  });

  it('throws when workspaceRoot contains other shell metacharacters', () => {
    expect(() => getGitConfigContent('/workspace/pr; rm -rf /')).toThrow('Invalid workspaceRoot');
  });
});
