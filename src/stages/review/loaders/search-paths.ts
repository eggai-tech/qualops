import { join, resolve } from 'node:path';

/**
 * Bundled asset base directory.
 * At runtime this file is at dist/stages/review/loaders/search-paths.js,
 * so three levels up lands at dist/, and then we navigate into dist/config/.
 * In the source tree (__dirname = src/stages/review/loaders/) the same relative
 * path resolves to src/config/, where the source files live — consistent in both
 * environments.
 */
const BUNDLED_CONFIG_BASE = resolve(__dirname, '..', '..', '..', 'config');

/**
 * Search path for prompt files, checked in priority order (first match wins).
 *
 * 1. User's project-local prompts (.qualops/prompts/) — highest priority
 * 2. Bundled defaults shipped with the package (dist/config/prompts/)
 */
export const PROMPT_SEARCH_PATHS: readonly string[] = [
  resolve(process.cwd(), '.qualops/prompts'),
  join(BUNDLED_CONFIG_BASE, 'prompts'),
];

/**
 * Search path for agent markdown files, checked in priority order (first match wins).
 *
 * 1. User's project-local agents (.qualops/agents/) — highest priority
 * 2. Bundled default agents shipped with the package (dist/config/agents/)
 */
export const AGENT_SEARCH_PATHS: readonly string[] = [
  resolve(process.cwd(), '.qualops/agents'),
  join(BUNDLED_CONFIG_BASE, 'agents'),
];
