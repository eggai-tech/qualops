/**
 * Synthesises a minimal ~/.gitconfig that hardens git against hook injection,
 * fsmonitor gadgets, file-protocol clones, and GPG signing.
 *
 * Write once per session start; pass the returned path as GIT_CONFIG_GLOBAL.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function buildGitConfigContent(workspaceRoot: string): string {
  // Validate before interpolating into the config file. A newline in the value
  // would break out of the [safe] section and allow arbitrary config injection
  // (e.g. overriding hooksPath). Only allow characters that are valid in an
  // absolute filesystem path; throw so the caller sees a clear error rather than
  // silently writing a malformed or compromised config file.
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(workspaceRoot)) {
    throw new Error(
      `[git-config-template] Invalid workspaceRoot — contains disallowed characters: ${JSON.stringify(workspaceRoot)}`,
    );
  }
  const root = workspaceRoot.replace(/\/+$/, '') || '/workspace/pr';
  // Always allow both the PR checkout and the base-branch checkout that CI
  // places alongside it (e.g. /workspace/pr + /workspace/base). In local
  // environments workspaceRoot is the actual checkout path and there is no
  // separate base dir, so we only add the root itself.
  const safeDirectories =
    root === '/workspace/pr'
      ? '\tdirectory = /workspace/pr\n\tdirectory = /workspace/base'
      : `\tdirectory = ${root}`;

  return `[core]
\tfsmonitor = false
\thooksPath = /dev/null
\tgitProxy = none
\tautocrlf = false
\tsymlinks = false

[gpg]
\tprogram = /bin/false

[transfer]
\tfsckObjects = true

[fetch]
\tfsckObjects = true

[receive]
\tfsckObjects = true
\tdenyCurrentBranch = refuse
\tdenyNonFastForwards = true

[protocol "file"]
\tallow = never

[protocol "ext"]
\tallow = never

[protocol "git"]
\tallow = never

[http]
\tsslVerify = true
\tfollowRedirects = false

[credential]
\thelper = /bin/false

[safe]
${safeDirectories}

[advice]
\tdetachedHead = false

[alias]
`;
}

let cachedPath: string | null = null;
let cachedRoot: string | null = null;

/**
 * Writes a hardened gitconfig to a stable tmpdir path and returns that path.
 * Idempotent: returns the same path on subsequent calls within the same process.
 * The safe.directory entry is derived from workspaceRoot so git commands work
 * in both CI (/workspace/pr) and local checkout environments.
 */
export function getGitConfigPath(workspaceRoot = '/workspace/pr'): string {
  if (cachedPath !== null && cachedRoot === workspaceRoot) return cachedPath;

  const content = buildGitConfigContent(workspaceRoot);
  const dir = path.join(os.tmpdir(), `qualops-git-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const configPath = path.join(dir, 'gitconfig');
  fs.writeFileSync(configPath, content, { encoding: 'utf8', mode: 0o600 });

  cachedPath = configPath;
  cachedRoot = workspaceRoot;
  return configPath;
}

/**
 * Returns the contents of the synthesised gitconfig for the given workspace root (useful for tests).
 */
export function getGitConfigContent(workspaceRoot = '/workspace/pr'): string {
  return buildGitConfigContent(workspaceRoot);
}

/**
 * Cleans up the temporary directory (call on process exit if desired).
 */
export function cleanupGitConfig(): void {
  if (cachedPath === null) return;
  try {
    const dir = path.dirname(cachedPath);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
  cachedPath = null;
}
