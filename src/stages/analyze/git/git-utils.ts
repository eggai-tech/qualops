import { spawnSync } from 'node:child_process';

export function executeGitCommand(args: string[]): string {
  const result = spawnSync('git', args, {
    encoding: 'utf-8',
    stdio: 'pipe',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  return result.stdout.trim();
}

