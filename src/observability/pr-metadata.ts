export interface PRMetadata {
  repo?: string;
  prNumber?: string;
  prUrl?: string;
  headSha?: string;
  baseSha?: string;
  sessionId: string;
}

export function extractPRMetadata(
  sessionName: string,
  gitRefs?: { base: string; head: string },
): PRMetadata {
  const githubRepo = process.env.GITHUB_REPOSITORY;
  const gitlabRepo = process.env.CI_PROJECT_PATH;
  const repo = githubRepo || gitlabRepo;
  const prNumber =
    process.env.PR_NUMBER || process.env.GITHUB_PR_NUMBER || process.env.CI_MERGE_REQUEST_IID;
  let prUrl: string | undefined;
  if (repo && prNumber) {
    prUrl = githubRepo
      ? `https://github.com/${repo}/pull/${prNumber}`
      : `https://gitlab.com/${repo}/-/merge_requests/${prNumber}`;
  }
  const headSha = gitRefs?.head;
  const baseSha = gitRefs?.base;
  const sessionId = repo && headSha ? `${repo}:${headSha}` : sessionName;

  return { repo, prNumber, prUrl, headSha, baseSha, sessionId };
}
