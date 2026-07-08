/**
 * Builds the bash tool description for the given workspace root.
 *
 * The model constructs commands using the path in this description verbatim
 * (e.g. `cat <root>/src/auth.ts`), and the policy then enforces that those paths
 * stay within `workspaceRoot`. So the description must be derived from the SAME
 * root the policy uses — otherwise the model targets a path the policy denies
 * with `path-outside-workspace`, which is the bug this replaces.
 */
export function buildBashToolDescription(workspaceRoot: string): string {
  const root = workspaceRoot.replace(/\/+$/, '') || '/';

  return `
Execute a shell command to interrogate the codebase under review.

The code under review is at ${root}. File paths in the review are relative to it.
Use this tool to run linters, grep for patterns, inspect file contents, run tests, or compute diffs.

REQUIRED FIELDS:
- command: The shell command to run (no interactive tools, no background processes)
- description: Human-readable description of what you are doing and why
- purpose: One of: inspect | diff | search | lint | test | build

CONSTRAINTS (hard-enforced — commands violating these are rejected before execution):
- No network downloads: curl, wget, nc, ssh, etc. are blocked
- No package installs: npm install, pip, apt, brew, etc. are blocked
- No file deletion: rm, rmdir, shred are blocked
- No privilege escalation: sudo, su, doas are blocked
- No background processes: trailing & or nohup are blocked
- No interactive REPLs: bare python, node, psql without -c/-e are blocked
- No git write commands: push, fetch, commit, checkout, etc. are blocked
- No LD_PRELOAD or DYLD_INSERT_LIBRARIES

ALLOWED examples:
- grep -r "TODO" ${root}/src --include="*.ts"
- rg "password" ${root} -l
- git log --oneline -20
- git diff HEAD~1 HEAD -- src/
- tsc --noEmit
- eslint src/ --format json
- python3 -c "import ast; print(ast.dump(ast.parse(open('file.py').read())))"
- cat ${root}/src/auth.ts | head -100
- find ${root} -name "*.env*" -not -path "*/node_modules/*"
- jq '.dependencies' ${root}/package.json

OUTPUT:
- stdout/stderr are truncated at 64 KiB / 1500 lines (tail-keep strategy)
- ANSI escape sequences are stripped
- Secrets matching known patterns are redacted to [REDACTED]
- exit_code 1 from grep/rg means "no matches" (not an error); check semantic_hint
`.trim();
}
