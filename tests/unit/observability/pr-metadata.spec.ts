import { extractPRMetadata } from '@/observability';

describe('extractPRMetadata', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.CI_PROJECT_PATH;
    delete process.env.PR_NUMBER;
    delete process.env.GITHUB_PR_NUMBER;
    delete process.env.CI_MERGE_REQUEST_IID;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns sessionName as sessionId when no CI env vars are set', () => {
    const meta = extractPRMetadata('local-session');
    expect(meta.sessionId).toBe('local-session');
    expect(meta.repo).toBeUndefined();
    expect(meta.prNumber).toBeUndefined();
  });

  it('extracts GitHub Actions metadata', () => {
    process.env.GITHUB_REPOSITORY = 'org/repo';
    process.env.PR_NUMBER = '42';

    const meta = extractPRMetadata('session', { base: 'base-sha', head: 'head-sha' });
    expect(meta.repo).toBe('org/repo');
    expect(meta.prNumber).toBe('42');
    expect(meta.prUrl).toBe('https://github.com/org/repo/pull/42');
    expect(meta.headSha).toBe('head-sha');
    expect(meta.baseSha).toBe('base-sha');
    expect(meta.sessionId).toBe('org/repo:head-sha');
  });

  it('extracts GitLab CI metadata', () => {
    process.env.CI_PROJECT_PATH = 'group/project';
    process.env.CI_MERGE_REQUEST_IID = '7';

    const meta = extractPRMetadata('session', { base: 'b', head: 'h' });
    expect(meta.repo).toBe('group/project');
    expect(meta.prNumber).toBe('7');
    expect(meta.prUrl).toBe('https://gitlab.com/group/project/-/merge_requests/7');
    expect(meta.sessionId).toBe('group/project:h');
  });

  it('prefers GitHub over GitLab when both are set', () => {
    process.env.GITHUB_REPOSITORY = 'gh-org/gh-repo';
    process.env.CI_PROJECT_PATH = 'gl-group/gl-project';

    const meta = extractPRMetadata('session');
    expect(meta.repo).toBe('gh-org/gh-repo');
  });

  it('falls back to sessionName when repo is set but no headSha', () => {
    process.env.GITHUB_REPOSITORY = 'org/repo';
    const meta = extractPRMetadata('my-session');
    expect(meta.sessionId).toBe('my-session');
  });
});
