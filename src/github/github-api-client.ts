import { Octokit } from '@octokit/rest';

interface GitHubEnv {
  GITHUB_TOKEN?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_API_URL?: string;
}

export class GitHubAPIClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor() {
    const env = process.env as GitHubEnv;

    const token = env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN environment variable is required');
    }

    const repository = env.GITHUB_REPOSITORY;
    if (!repository) {
      throw new Error('GITHUB_REPOSITORY environment variable is required (format: owner/repo)');
    }

    const [owner, repo] = repository.split('/');
    if (!owner || !repo) {
      throw new Error('GITHUB_REPOSITORY must be in format: owner/repo');
    }

    this.owner = owner;
    this.repo = repo;

    this.octokit = new Octokit({
      auth: token,
      baseUrl: env.GITHUB_API_URL || 'https://api.github.com',
    });
  }

  async withRetry<T>(operation: () => Promise<T>, maxRetries = 3, baseDelay = 1000): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const isLastAttempt = attempt === maxRetries;
        const isRetryable = error instanceof Error &&
          (error.message.includes('rate limit') ||
           error.message.includes('timeout') ||
           error.message.includes('503'));

        if (isLastAttempt || !isRetryable) {
          throw error;
        }

        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error('Retry logic failed unexpectedly');
  }

  async getPullRequest(prNumber: number) {
    return this.withRetry(async () => {
      const { data } = await this.octokit.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
      });
      return data;
    });
  }

  async listComments(prNumber: number) {
    return this.withRetry(async () => {
      const { data } = await this.octokit.issues.listComments({
        owner: this.owner,
        repo: this.repo,
        issue_number: prNumber,
      });
      return data;
    });
  }

  async createComment(prNumber: number, body: string) {
    return this.withRetry(async () => {
      const { data } = await this.octokit.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: prNumber,
        body,
      });
      return data;
    });
  }

  async updateComment(commentId: number, body: string) {
    return this.withRetry(async () => {
      const { data } = await this.octokit.issues.updateComment({
        owner: this.owner,
        repo: this.repo,
        comment_id: commentId,
        body,
      });
      return data;
    });
  }

  async createCheck(params: {
    name: string;
    head_sha: string;
    status?: 'queued' | 'in_progress' | 'completed';
    conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required';
    output?: {
      title: string;
      summary: string;
      text?: string;
      annotations?: Array<{
        path: string;
        start_line: number;
        end_line: number;
        annotation_level: 'notice' | 'warning' | 'failure';
        message: string;
        title?: string;
      }>;
    };
  }) {
    return this.withRetry(async () => {
      const { data } = await this.octokit.checks.create({
        owner: this.owner,
        repo: this.repo,
        ...params,
      });
      return data;
    });
  }
}
