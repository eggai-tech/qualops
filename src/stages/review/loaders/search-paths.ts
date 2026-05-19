import { join, resolve } from 'node:path';

import { resolveWithinCwd } from '../../../shared/utils/security';

/**
 * Bundled asset base directory.
 * At runtime this file is at dist/stages/review/loaders/search-paths.js,
 * so three levels up lands at dist/, and then we navigate into dist/config/.
 * In the source tree (__dirname = src/stages/review/loaders/) the same relative
 * path resolves to src/config/, where the source files live — consistent in both
 * environments.
 */
const BUNDLED_CONFIG_BASE = resolve(__dirname, '..', '..', '..', 'config');

const PROJECT_PROMPT_BASES: readonly string[] = [resolve(process.cwd(), '.qualops/prompts')];
const LIBRARY_PROMPT_BASES: readonly string[] = [join(BUNDLED_CONFIG_BASE, 'prompts')];

/**
 * Resolves a user-supplied prompt filename against all search paths in priority order
 * (project paths first, library paths second). Returns the first validated absolute path,
 * or null if the filename escapes every base or is not found in any of them.
 *
 * Project paths anchor to process.cwd(); library paths anchor to their own base.
 */
export function resolvePromptPath(promptPath: string): string | null {
  const cwd = process.cwd();
  for (const base of PROJECT_PROMPT_BASES) {
    const full = resolveWithinCwd(cwd, join(base, promptPath));
    if (full) return full;
  }
  for (const base of LIBRARY_PROMPT_BASES) {
    const full = resolveWithinCwd(base, promptPath);
    if (full) return full;
  }
  return null;
}

/**
 * All prompt search base directories in priority order, for use in error messages.
 */
export const ALL_PROMPT_SEARCH_PATHS: readonly string[] = [
  ...PROJECT_PROMPT_BASES,
  ...LIBRARY_PROMPT_BASES,
];

/**
 * Resolves the custom agents directory: uses the config-supplied agentsDir if provided
 * (validated against cwd for path traversal), otherwise falls back to .qualops/agents.
 * Returns null if the config-supplied path escapes the project directory.
 */
export function resolveCustomAgentsDir(cwd: string, agentsDir?: string): string | null {
  if (agentsDir) return resolveWithinCwd(cwd, agentsDir);
  return resolve(cwd, '.qualops/agents');
}

/**
 * Resolves a built-in subagent markdown file by name from the package's bundled agents
 * directory. Returns the absolute path if it stays within the library base, or null.
 */
export function resolveBuiltinAgentPath(agentName: string): string | null {
  const base = join(BUNDLED_CONFIG_BASE, 'agents');
  return resolveWithinCwd(base, `${agentName}.md`);
}
