/**
 * Heuristic mapping from command first-word to a purpose enum value.
 * Used on the Anthropic side where the built-in Bash tool does not have
 * a `purpose` field in its input schema.
 */

export type InferredPurpose = 'inspect' | 'diff' | 'search' | 'lint' | 'test' | 'build' | 'unknown';

const PURPOSE_MAP: Record<string, InferredPurpose> = {
  // inspect — read files, show metadata
  cat: 'inspect',
  head: 'inspect',
  tail: 'inspect',
  ls: 'inspect',
  stat: 'inspect',
  file: 'inspect',
  wc: 'inspect',
  hexdump: 'inspect',
  strings: 'inspect',
  readlink: 'inspect',
  realpath: 'inspect',

  // diff — compare versions
  diff: 'diff',
  'git diff': 'diff',
  delta: 'diff',
  patch: 'diff',

  // search — find in code
  grep: 'search',
  rg: 'search',
  ag: 'search',
  fgrep: 'search',
  egrep: 'search',
  find: 'search',
  fd: 'search',
  locate: 'search',
  ack: 'search',
  jq: 'search',
  yq: 'search',
  git: 'search', // git log, git grep, etc.

  // lint — static analysis
  eslint: 'lint',
  tslint: 'lint',
  tsc: 'lint',
  biome: 'lint',
  pylint: 'lint',
  flake8: 'lint',
  mypy: 'lint',
  ruff: 'lint',
  shellcheck: 'lint',
  hadolint: 'lint',
  clippy: 'lint',
  golangci: 'lint',
  rubocop: 'lint',
  prettier: 'lint',
  markdownlint: 'lint',

  // test — run test suites
  jest: 'test',
  vitest: 'test',
  mocha: 'test',
  jasmine: 'test',
  pytest: 'test',
  unittest: 'test',
  cargo: 'test',
  go: 'test',
  rspec: 'test',
  minitest: 'test',

  // build — compile / bundle
  tsc_build: 'build',
  webpack: 'build',
  vite: 'build',
  rollup: 'build',
  esbuild: 'build',
  parcel: 'build',
  swc: 'build',
  babel: 'build',
};

/**
 * Infers the purpose of a command from its binary name.
 * Falls back to 'unknown' if not recognized.
 */
export function inferPurpose(command: string): InferredPurpose {
  if (!command || command.trim() === '') return 'unknown';

  const binary = command.trim().split(/\s+/)[0]?.replace(/^.*\//, '') ?? '';
  return PURPOSE_MAP[binary] ?? 'unknown';
}
