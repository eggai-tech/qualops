/**
 * Maps (binary, exitCode) pairs to semantic hints for model-facing output.
 *
 * This table helps the LLM understand that exit code 1 from grep/rg means
 * "no matches found" (not an error), rather than interpreting it as a failure.
 */

export type SemanticHint =
  | 'no_matches_found'
  | 'differences_found'
  | 'no_differences'
  | 'not_found'
  | 'permission_denied'
  | 'timeout'
  | 'success'
  | 'general_error'
  | 'syntax_error';

interface ExitEntry {
  hint: SemanticHint;
  description: string;
}

type ExitTable = Record<string, Record<number, ExitEntry>>;

const EXIT_TABLE: ExitTable = {
  grep: {
    0: { hint: 'success', description: 'One or more matches found' },
    1: { hint: 'no_matches_found', description: 'No matches found (not an error)' },
    2: { hint: 'general_error', description: 'grep error (bad pattern or unreadable file)' },
  },
  rg: {
    0: { hint: 'success', description: 'One or more matches found' },
    1: { hint: 'no_matches_found', description: 'No matches found (not an error)' },
    2: { hint: 'general_error', description: 'ripgrep error' },
  },
  ag: {
    0: { hint: 'success', description: 'One or more matches found' },
    1: { hint: 'no_matches_found', description: 'No matches found (not an error)' },
  },
  diff: {
    0: { hint: 'no_differences', description: 'Files are identical' },
    1: { hint: 'differences_found', description: 'Differences found (not an error)' },
    2: { hint: 'general_error', description: 'diff error (trouble reading files)' },
  },
  git: {
    0: { hint: 'success', description: 'Command succeeded' },
    1: { hint: 'differences_found', description: 'git diff found differences' },
    128: { hint: 'general_error', description: 'git fatal error (not a git repo, bad ref, etc.)' },
    129: { hint: 'syntax_error', description: 'git usage error (bad arguments)' },
  },
  find: {
    0: { hint: 'success', description: 'find completed (zero results is still exit 0)' },
    1: { hint: 'general_error', description: 'find error' },
  },
  test: {
    0: { hint: 'success', description: 'Test condition is true' },
    1: { hint: 'not_found', description: 'Test condition is false' },
  },
  '[': {
    0: { hint: 'success', description: 'Test condition is true' },
    1: { hint: 'not_found', description: 'Test condition is false' },
  },
  '[[': {
    0: { hint: 'success', description: 'Test condition is true' },
    1: { hint: 'not_found', description: 'Test condition is false' },
  },
  ls: {
    0: { hint: 'success', description: 'Directory/file listed successfully' },
    1: { hint: 'not_found', description: 'No such file or directory (or permission denied)' },
    2: { hint: 'general_error', description: 'ls error' },
  },
  cat: {
    0: { hint: 'success', description: 'File read successfully' },
    1: { hint: 'not_found', description: 'No such file or directory (or permission denied)' },
  },
  head: {
    0: { hint: 'success', description: 'File read successfully' },
    1: { hint: 'not_found', description: 'No such file or directory' },
  },
  tail: {
    0: { hint: 'success', description: 'File read successfully' },
    1: { hint: 'not_found', description: 'No such file or directory' },
  },
  wc: {
    0: { hint: 'success', description: 'Word/line count completed' },
    1: { hint: 'not_found', description: 'File not found' },
  },
  jq: {
    0: { hint: 'success', description: 'JSON processed successfully' },
    1: { hint: 'general_error', description: 'jq error (bad filter or invalid JSON)' },
    2: { hint: 'general_error', description: 'jq usage error' },
    3: { hint: 'no_matches_found', description: 'null output (path not found in JSON)' },
    5: { hint: 'general_error', description: 'jq system error' },
  },
  python3: {
    0: { hint: 'success', description: 'Script executed successfully' },
    1: { hint: 'general_error', description: 'Unhandled Python exception' },
    2: { hint: 'syntax_error', description: 'Python syntax error or usage error' },
  },
  node: {
    0: { hint: 'success', description: 'Script executed successfully' },
    1: { hint: 'general_error', description: 'Unhandled Node.js exception' },
  },
  tsc: {
    0: { hint: 'success', description: 'TypeScript compilation succeeded' },
    1: { hint: 'general_error', description: 'TypeScript compilation error' },
    2: { hint: 'syntax_error', description: 'TypeScript syntax error' },
  },
  eslint: {
    0: { hint: 'success', description: 'No lint errors' },
    1: { hint: 'general_error', description: 'Lint errors found' },
    2: { hint: 'general_error', description: 'eslint configuration error' },
  },
  jest: {
    0: { hint: 'success', description: 'All tests passed' },
    1: { hint: 'general_error', description: 'Test failures' },
  },
  vitest: {
    0: { hint: 'success', description: 'All tests passed' },
    1: { hint: 'general_error', description: 'Test failures' },
  },
};

/**
 * Returns a semantic hint for the given binary + exit code combination.
 * Returns undefined if no specific hint is registered.
 */
export function getSemanticHint(binary: string, exitCode: number): string | undefined {
  const binaryBase = binary.replace(/^.*\//, ''); // basename
  const entry = EXIT_TABLE[binaryBase]?.[exitCode];
  return entry?.description;
}

/**
 * Returns the SemanticHint enum value for the given binary + exit code.
 */
export function getSemanticHintCode(binary: string, exitCode: number): SemanticHint | undefined {
  const binaryBase = binary.replace(/^.*\//, '');
  return EXIT_TABLE[binaryBase]?.[exitCode]?.hint;
}
