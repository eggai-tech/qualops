/**
 * Structural command parser (Option B — regex-based for M0).
 *
 * Tokenises a shell command string into a sequence of "logical commands"
 * (the parts separated by top-level operators: ;, &&, ||, |, newline).
 * Does NOT perform full AST parsing — that is deferred to tree-sitter in M1.
 *
 * The key operation is stripping quoted substrings from the analysis copy
 * so that operators inside strings are not mistakenly treated as structural.
 */

export interface ParsedCommand {
  /** The raw text of this logical command (may span pipelines). */
  raw: string;
  /** The first word of the command (binary name). */
  binary: string;
  /** All arguments after the binary (split on whitespace, unquoted). */
  args: string[];
  /** True if the raw text contains unquoted redirection operators. */
  hasRedirection: boolean;
  /** True if the raw text contains unquoted variable/subshell expansions. */
  hasExpansion: boolean;
  /** True if the raw text ends with an unquoted background `&`. */
  hasBackground: boolean;
  /** True if the raw text contains unquoted NUL or literal newline. */
  hasControlChars: boolean;
}

export interface TokenisedShell {
  /** The raw input command string. */
  raw: string;
  /** Individual logical commands extracted from the input. */
  commands: ParsedCommand[];
  /** True if parsing detected a structural problem (e.g. unmatched quotes). */
  parseError: boolean;
  parseErrorMessage?: string;
}

/**
 * Strips ANSI-C quoted substrings ($'...') and replaces them with placeholders.
 * Must run before stripSingleQuoted so the $ prefix is consumed first,
 * preventing the inner single-quoted content from being mis-parsed.
 */
function stripAnsiCQuoted(input: string): string {
  return input.replace(/\$'[^']*'/g, "'__ANSI_C__'");
}

/**
 * Strips single-quoted substrings and replaces them with placeholders.
 * Content inside single quotes cannot contain variable expansions and
 * is literal — we don't want to false-positive on `$ inside them.
 */
function stripSingleQuoted(input: string): string {
  // Replace 'content' (not containing single quotes) with safe placeholder
  return input.replace(/'[^']*'/g, "'__SQ__'");
}

/**
 * Strips surrounding quotes from a word that is entirely quoted, returning
 * the inner literal value for path/policy checking purposes.
 * Handles: 'content', "content", and $'content' (ANSI-C quoting).
 * Does not expand escape sequences — returns raw inner bytes.
 */
function unquoteArg(arg: string): string {
  if (arg.length >= 2) {
    if ((arg.startsWith("'") && arg.endsWith("'")) || (arg.startsWith('"') && arg.endsWith('"'))) {
      return arg.slice(1, -1);
    }
    // ANSI-C quoting: $'content'
    if (arg.startsWith("$'") && arg.endsWith("'")) {
      return arg.slice(2, -1);
    }
  }
  return arg;
}

/**
 * Strips double-quoted substrings (best-effort — does not handle nested
 * escapes perfectly, which is fine for M0 deny-list checking).
 */
function stripDoubleQuoted(input: string): string {
  // Simple approach: replace "content" sequences, being conservative about
  // what we strip — only replace if the close-quote is on the same "line".
  return input.replace(/"(?:[^"\\]|\\.)*"/g, '"__DQ__"');
}

/**
 * Returns the "analysis copy" of a command: single- and double-quoted
 * substrings replaced with placeholders so we can reliably detect
 * top-level structural tokens.
 */
export function toAnalysisCopy(cmd: string): string {
  let s = cmd;
  // Iteratively strip to handle adjacent quoted strings.
  // ANSI-C quoting ($'...') must be stripped first so the $ prefix is consumed
  // before the inner content is processed by the single-quote stripper.
  for (let i = 0; i < 5; i++) {
    const prev = s;
    s = stripAnsiCQuoted(s);
    s = stripSingleQuoted(s);
    s = stripDoubleQuoted(s);
    if (s === prev) break;
  }
  return s;
}

/**
 * Splits a command string on top-level operators (;, &&, ||, |, newline)
 * and returns each logical segment. Operates on the analysis copy to
 * avoid splitting on operators inside quoted strings.
 */
export function splitOnOperators(cmd: string): string[] {
  const analysis = toAnalysisCopy(cmd);
  const segments: string[] = [];
  let start = 0;

  for (let i = 0; i < analysis.length; i++) {
    const ch = analysis[i];
    const next = analysis[i + 1];

    if (ch === '\n') {
      segments.push(cmd.slice(start, i).trim());
      start = i + 1;
    } else if (ch === ';') {
      segments.push(cmd.slice(start, i).trim());
      start = i + 1;
    } else if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
      segments.push(cmd.slice(start, i).trim());
      start = i + 2;
      i++; // skip second char
    } else if (ch === '|' && next !== '|') {
      // pipeline — keep as part of same logical command for policy checking
      // (we parse each pipeline stage separately below)
      segments.push(cmd.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = cmd.slice(start).trim();
  if (tail) segments.push(tail);

  return segments.filter(Boolean);
}

/**
 * Parses a single logical command (no structural operators) into its
 * binary and arguments. Strips leading environment assignments.
 */
export function parseLogicalCommand(raw: string): ParsedCommand {
  const analysis = toAnalysisCopy(raw);

  const hasRedirection =
    /(?:^|[^<>])[<>](?![<>])/.test(analysis) || />>/.test(analysis) || /<</.test(analysis);
  const hasExpansion =
    /\$\{/.test(analysis) ||
    /\$\(/.test(analysis) ||
    /`/.test(analysis) ||
    /\$[A-Za-z_]/.test(analysis) ||
    /\$[0-9#@*?!-]/.test(analysis);
  const hasBackground = /&\s*$/.test(analysis);
  const hasControlChars = /\\0|\\x00|\u0000/.test(raw) || /\n/.test(analysis.replace(/\\n/g, ''));

  // Strip leading env var assignments (FOO=bar BAZ=qux cmd ...)
  const withoutEnvAssigns = raw.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+)*/, '');
  const words = withoutEnvAssigns.trim().split(/\s+/);
  // Unquote binary and args so path checks operate on the actual string value.
  // e.g. '/usr/bin/cat' → /usr/bin/cat, $'...' args handled via toAnalysisCopy already.
  const binary = unquoteArg(words[0] ?? '');
  const args = words.slice(1).map(unquoteArg);

  return {
    raw,
    binary,
    args,
    hasRedirection,
    hasExpansion,
    hasBackground,
    hasControlChars,
  };
}

/**
 * Collects every value associated with any of the named flags across the
 * entire args array. Handles all three forms:
 *   -c value          (space-separated)
 *   -c=value          (equals-form, short flag)
 *   --flag=value      (equals-form, long flag)
 *   -cVALUE           (short flag with attached value, e.g. git -ccore.x=y)
 *   --flag value      (space-separated, long flag)
 *
 * Pass the flag prefix exactly as it appears (e.g. '-c', '--command').
 */
export function flagValues(args: string[], ...flags: string[]): string[] {
  const results: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    for (const flag of flags) {
      if (a === flag) {
        // space-separated: -c value  /  --flag value
        if (i + 1 < args.length) results.push(args[i + 1]!);
      } else if (a.startsWith(flag + '=')) {
        // equals-form: -c=value  /  --flag=value
        results.push(a.slice(flag.length + 1));
      } else if (
        flag.length === 2 &&
        flag[0] === '-' &&
        flag[1] !== '-' &&
        a.startsWith(flag) &&
        a.length > 2
      ) {
        // short-flag with attached value: -cVALUE  (flag is '-c')
        results.push(a.slice(2));
      }
    }
  }
  return results;
}

/**
 * Returns the first positional argument — a token that is not a flag and
 * not a value consumed by a preceding flag. Scans the full args array so
 * flags in any position (before or after positional args) are skipped.
 *
 * Skipping rules:
 *   --flag=value   self-contained; advance by 1
 *   --flag value   long flag consumes next token; advance by 2
 *   -f             short flag, conservatively advance by 1 (may or may not
 *                  consume the next token — we err on the safe side and do
 *                  not skip the next token, so a misidentified "value" token
 *                  becomes a candidate positional and is checked normally)
 */
export function firstPositional(args: string[]): string | undefined {
  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (!a.startsWith('-')) return a; // positional found
    if (a.includes('=')) {
      i++;
      continue;
    } // --flag=value: self-contained
    if (a.startsWith('--')) {
      i += 2;
      continue;
    } // --flag value: skip value token
    i++; // short flag: advance conservatively
  }
  return undefined;
}

/**
 * Top-level tokeniser: splits the command on structural operators,
 * then parses each segment.
 */
export function tokenise(cmd: string): TokenisedShell {
  if (!cmd || cmd.trim() === '') {
    return { raw: cmd, commands: [], parseError: false };
  }

  // Sanity check: unmatched quotes
  const singleCount = (cmd.match(/(?<!\\)'/g) ?? []).length;
  if (singleCount % 2 !== 0) {
    return {
      raw: cmd,
      commands: [],
      parseError: true,
      parseErrorMessage: 'Unmatched single quote',
    };
  }

  const segments = splitOnOperators(cmd);
  const commands = segments.map(parseLogicalCommand);

  return { raw: cmd, commands, parseError: false };
}
