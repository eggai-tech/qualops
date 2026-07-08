const EXPLICIT_DENY: ReadonlySet<string> = new Set([
  'GITHUB_TOKEN',
  'GITHUB_APP_TOKEN',
  'GH_TOKEN',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'NPM_TOKEN',
  'CODECOV_TOKEN',
]);

const DENY_SUFFIXES: readonly string[] = [
  '_TOKEN',
  '_SECRET',
  '_KEY',
  '_PASSWORD',
  '_PASS',
  '_CREDENTIAL',
  '_CREDENTIALS',
];

const DENY_PREFIXES: readonly string[] = ['AWS_', 'AZURE_', 'GCP_', 'GOOGLE_', 'VAULT_'];

const _ALLOW_LIST: ReadonlySet<string> = new Set([
  // Shell / process fundamentals
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  'XDG_RUNTIME_DIR',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',

  // Paths
  'PATH',
  'LD_LIBRARY_PATH',
  'DYLD_LIBRARY_PATH',
  'MANPATH',
  'PKG_CONFIG_PATH',
  'JAVA_HOME',
  'CARGO_HOME',
  'GOPATH',
  'GOROOT',
  'GOBIN',
  'RUSTUP_HOME',
  'PYENV_ROOT',
  'NVM_DIR',
  'NODE_PATH',
  'PYTHONPATH',

  // Build / CI environment metadata (non-secret)
  'CI',
  'RUNNER_NAME',
  'RUNNER_OS',
  'RUNNER_ARCH',
  'RUNNER_TEMP',
  'RUNNER_TOOL_CACHE',
  'RUNNER_WORKSPACE',
  'GITHUB_ACTIONS',
  'GITHUB_WORKSPACE',
  'GITHUB_REPOSITORY',
  'GITHUB_REF',
  'GITHUB_SHA',
  'GITHUB_RUN_ID',
  'GITHUB_RUN_NUMBER',
  'GITHUB_JOB',
  'GITHUB_EVENT_NAME',
  'GITHUB_HEAD_REF',
  'GITHUB_BASE_REF',
  'GITHUB_SERVER_URL',
  'GITHUB_API_URL',
  'GITHUB_GRAPHQL_URL',
  'GITHUB_ACTOR',
  'GITHUB_REPOSITORY_OWNER',

  // Node.js runtime
  'NODE_ENV',
  'NODE_OPTIONS',
  'NODE_NO_WARNINGS',
  'npm_config_registry',

  // Qualops-specific (non-secret)
  'QUALOPS_ENV_SCRUBBED',
  'QUALOPS_REVIEW_ID',
  'QUALOPS_SANDBOX_MODE',
  'QUALOPS_ALLOW_UNSANDBOXED',
  'QUALOPS_WORKSPACE',

  // Git overrides we set ourselves
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_GLOBAL',
  'GIT_CEILING_DIRECTORIES',
  'GIT_TERMINAL_PROMPT',
  'GIT_ASKPASS',

  // Display / terminal
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'COLORTERM',
  'NO_COLOR',
  'FORCE_COLOR',
]);

function isSecretLike(name: string): boolean {
  const upper = name.toUpperCase();
  if (EXPLICIT_DENY.has(name)) return true;
  for (const suffix of DENY_SUFFIXES) {
    if (upper.endsWith(suffix)) return true;
  }
  for (const prefix of DENY_PREFIXES) {
    if (upper.startsWith(prefix)) return true;
  }
  return false;
}

export interface ScrubResult {
  env: NodeJS.ProcessEnv;
  dropped: string[];
}

function injectGitSafetyOverrides(env: NodeJS.ProcessEnv, gitConfigPath?: string): void {
  env['GIT_CONFIG_NOSYSTEM'] = '1';
  env['GIT_TERMINAL_PROMPT'] = '0';
  env['GIT_ASKPASS'] = 'true'; // no-op credential helper — prevents interactive prompts
  env['GIT_CEILING_DIRECTORIES'] = '/workspace';
  if (gitConfigPath) {
    env['GIT_CONFIG_GLOBAL'] = gitConfigPath;
  }
}

export function scrubEnv(src: NodeJS.ProcessEnv, gitConfigPath?: string): ScrubResult {
  const result: NodeJS.ProcessEnv = {};
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(src)) {
    if (value === undefined) continue;
    if (isSecretLike(key)) {
      dropped.push(key);
      continue;
    }
    result[key] = value;
  }

  injectGitSafetyOverrides(result, gitConfigPath);
  result['QUALOPS_ENV_SCRUBBED'] = '1';

  return { env: result, dropped };
}

function replaceProcessEnv(replacement: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in replacement)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(replacement)) {
    process.env[key] = value;
  }
}

/**
 * Applies env scrub in-place to `process.env`.
 * IMPORTANT: Call this at the very top of cli.ts before any SDK imports.
 * Idempotent — returns early if QUALOPS_ENV_SCRUBBED is already set.
 */
export function applyEnvScrub(gitConfigPath?: string): void {
  if (process.env['QUALOPS_ENV_SCRUBBED'] === '1') return;

  const { env, dropped } = scrubEnv(process.env, gitConfigPath);

  replaceProcessEnv(env);

  if (dropped.length > 0 && process.env['QUALOPS_DEBUG_ENV_SCRUB'] === '1') {
    process.stderr.write(
      `[qualops/env-scrub] dropped ${dropped.length} secret env vars: ${dropped.join(', ')}\n`,
    );
  }
}

export function makeCleanEnv(
  gitConfigPath: string,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const { env } = scrubEnv(process.env, gitConfigPath);
  return { ...env, ...extra };
}
