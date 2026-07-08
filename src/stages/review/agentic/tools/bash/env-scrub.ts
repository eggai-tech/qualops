const EXPLICIT_DENY: ReadonlySet<string> = new Set([
  // Secrets
  'GITHUB_TOKEN',
  'GITHUB_APP_TOKEN',
  'GH_TOKEN',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'NPM_TOKEN',
  'CODECOV_TOKEN',
  // Shell startup file injection — sourced automatically before commands run.
  // bash reads BASH_ENV for every non-interactive shell; --norc does NOT suppress it.
  // ENV is the POSIX sh / dash / ksh equivalent.
  'BASH_ENV',
  'ENV',
  // Node.js: --require/--loader in NODE_OPTIONS executes arbitrary code on every invocation.
  // Intentionally absent from _ALLOW_LIST despite being a common env var.
  'NODE_OPTIONS',
  // Interpreter startup file / option injection
  'PYTHONSTARTUP', // Python sources this file on startup
  'RUBYOPT', // Ruby: -r loads arbitrary files
  'PERL5OPT', // Perl: -M loads arbitrary modules
  // JVM agent injection — -javaagent: loads and executes arbitrary bytecode
  'JAVA_TOOL_OPTIONS',
  'JDK_JAVA_OPTIONS',
  '_JAVA_OPTIONS',
  'GRADLE_OPTS',
  'MAVEN_OPTS',
  // Dynamic linker injection — shared library preloaded into every spawned binary
  'LD_PRELOAD', // Linux: preload arbitrary shared library
  'LD_AUDIT', // Linux: audit interface; same injection risk as LD_PRELOAD
  'DYLD_INSERT_LIBRARIES', // macOS: equivalent of LD_PRELOAD
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

/**
 * Documentation-only list of env vars that are safe to pass through to the bash subprocess.
 * This constant is NOT currently wired into scrubEnv — the actual filtering is done by
 * EXPLICIT_DENY + isSecretLike (deny-list approach, everything else passes through).
 *
 * Notable absences from this list that are intentional:
 * - BASH_ENV / ENV — startup file injection; in EXPLICIT_DENY
 * - NODE_OPTIONS — --require/--loader code execution; in EXPLICIT_DENY
 * - LD_PRELOAD / DYLD_INSERT_LIBRARIES — shared library injection; in EXPLICIT_DENY
 * LD_LIBRARY_PATH / DYLD_LIBRARY_PATH appear below because they only affect library search
 * paths (no startup execution), and checkEnvHijacking in policy.ts blocks AI-injected values.
 */
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
  // Bash exports functions via BASH_FUNC_<name>%% environment entries.
  // Bash reads and loads these on startup regardless of --norc/--noprofile.
  if (name.startsWith('BASH_FUNC_') && name.endsWith('%%')) return true;
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

function injectGitSafetyOverrides(
  env: NodeJS.ProcessEnv,
  gitConfigPath?: string,
  workspaceRoot?: string,
): void {
  env['GIT_CONFIG_NOSYSTEM'] = '1';
  env['GIT_TERMINAL_PROMPT'] = '0';
  env['GIT_ASKPASS'] = 'true'; // no-op credential helper — prevents interactive prompts
  // GIT_CEILING_DIRECTORIES stops git from traversing up past the workspace root
  // looking for a .git directory. Must be the PARENT of workspaceRoot so that git
  // can still find the .git dir inside the checkout itself.
  const ceiling = workspaceRoot ? workspaceRoot.replace(/\/[^/]+\/?$/, '') || '/' : '/workspace';
  env['GIT_CEILING_DIRECTORIES'] = ceiling;
  if (gitConfigPath) {
    env['GIT_CONFIG_GLOBAL'] = gitConfigPath;
  }
}

export function scrubEnv(
  src: NodeJS.ProcessEnv,
  gitConfigPath?: string,
  workspaceRoot?: string,
): ScrubResult {
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

  injectGitSafetyOverrides(result, gitConfigPath, workspaceRoot);
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
  workspaceRoot?: string,
): NodeJS.ProcessEnv {
  const { env } = scrubEnv(process.env, gitConfigPath, workspaceRoot);
  return { ...env, ...extra };
}
