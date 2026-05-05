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

  it('getGitConfigContent returns the hardened config string', () => {
    const content = getGitConfigContent();
    expect(content).toContain('hooksPath = /dev/null');
    expect(content).toContain('fsmonitor = false');
    expect(content).toContain('helper = /bin/false');
  });

  it('getGitConfigPath writes a file and returns its path', () => {
    const p = getGitConfigPath();
    expect(fs.existsSync(p)).toBe(true);
    const written = fs.readFileSync(p, 'utf8');
    expect(written).toContain('hooksPath = /dev/null');
  });

  it('getGitConfigPath is idempotent — same path on repeated calls', () => {
    const p1 = getGitConfigPath();
    const p2 = getGitConfigPath();
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
});
