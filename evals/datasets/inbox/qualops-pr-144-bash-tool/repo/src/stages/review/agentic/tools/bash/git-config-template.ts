/**
 * Synthesises a minimal ~/.gitconfig that hardens git against hook injection,
 * fsmonitor gadgets, file-protocol clones, and GPG signing.
 *
 * Write once per session start; pass the returned path as GIT_CONFIG_GLOBAL.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const GIT_CONFIG_CONTENT = `
[core]
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
\tdirectory = /workspace/pr
\tdirectory = /workspace/base

[advice]
\tdetachedHead = false

[alias]
`.trimStart();

let cachedPath: string | null = null;

/**
 * Writes a hardened gitconfig to a stable tmpdir path and returns that path.
 * Idempotent: returns the same path on subsequent calls within the same process.
 */
export function getGitConfigPath(): string {
  if (cachedPath !== null) return cachedPath;

  const dir = path.join(os.tmpdir(), `qualops-git-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const configPath = path.join(dir, 'gitconfig');
  fs.writeFileSync(configPath, GIT_CONFIG_CONTENT, { encoding: 'utf8', mode: 0o600 });

  cachedPath = configPath;
  return configPath;
}

/**
 * Returns the contents of the synthesised gitconfig (useful for tests).
 */
export function getGitConfigContent(): string {
  return GIT_CONFIG_CONTENT;
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
