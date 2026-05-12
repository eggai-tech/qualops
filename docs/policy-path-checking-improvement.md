# Policy: path argument checking in `checkPathAccess`

## Current state

`checkPathAccess` in `policy.ts` attempts to block file-access commands from
reaching paths outside the workspace. The current implementation has two
structural weaknesses that make it an incomplete defence.

### Weakness 1 — paths embedded in flag values are not inspected

The current code collects path candidates with:

```ts
const pathArgs = args.filter((a) => !a.startsWith('-'));
```

This drops every token that begins with `-`, including long-form flags of the
form `--flag=value`. A command like:

```
cp --target-directory=/etc/cron.d file
mv --backup=/tmp/evil src
```

passes unchecked because `--target-directory=/etc/cron.d` is discarded before
any path validation occurs. The embedded absolute path is never seen.

A naïve fix (`flatMap` over `=`-split values) was considered but rejected
because it is still incomplete — it would miss space-separated flag values
(`cp --target-directory /etc file`) and would also pull in non-path values
(e.g. `--suffix=~`, `--attributes=rw`) that happen to contain `/`.

### Weakness 2 — the binary allowlist is narrow and gives false confidence

`checkPathAccess` only applies to 8 binaries:
`cat`, `head`, `less`, `more`, `cp`, `mv`, `tee`, `ln`.

Many other allowed binaries also take file path arguments:
`awk`, `sed`, `tr`, `sort`, `wc`, `diff`, `patch`, `xargs`, `find`, `grep`,
`cut`, `jq`, `python3 -c`, `node -e`, etc. None of these are in the list.
In CI mode — where there is no filesystem-level sandbox (no bwrap, no Seatbelt)
— this means the policy layer is the sole guard and it covers only a fraction
of the surface.

## Proposed solution

Rather than maintaining a binary allowlist with hand-rolled argument parsing,
path checking should be **argument-driven**: scan every token in a command
for strings that look like filesystem paths and validate each one against the
workspace root using the existing `resolveWithinCwd` from
`src/shared/utils/security.ts`.

### Step 1 — add a `looksLikePath` heuristic to `security.ts`

```ts
/**
 * Returns true if `token` looks like a filesystem path — either absolute
 * (starts with '/') or a relative sequence that contains '/' (e.g. './foo',
 * '../bar', 'subdir/file'). Single-word tokens without a slash are not
 * treated as paths (they are flag names, binary names, or plain arguments).
 */
export function looksLikePath(token: string): boolean {
  return token.startsWith('/') || token.includes('/');
}
```

### Step 2 — replace `checkPathAccess` with `checkPathsInArgs`

Extract all path-like tokens from every argument — positional and flag values
alike — and validate each against the workspace root:

```ts
function extractPathCandidates(args: string[]): string[] {
  const candidates: string[] = [];
  for (const arg of args) {
    if (!arg.startsWith('-')) {
      // Positional arg — always a candidate if it looks like a path.
      if (looksLikePath(arg)) candidates.push(arg);
    } else {
      // Flag: extract value from --flag=value form.
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const value = arg.slice(eqIdx + 1);
        if (looksLikePath(value)) candidates.push(value);
      }
      // Space-separated --flag value is handled because the value will appear
      // as the next positional arg in the args array — it starts with no '-'
      // and is caught by the first branch above.
    }
  }
  return candidates;
}

function checkPathsInArgs(
  binaryBase: string,
  args: string[],
  workspaceRoot?: string,
): PolicyOutcome | null {
  const candidates = extractPathCandidates(args);
  for (const p of candidates) {
    const base = workspaceRoot ?? DEFAULT_WORKSPACE_ROOTS[0]!;
    if (resolveWithinCwd(base, p) === null) {
      return deny(
        'path-outside-workspace',
        `${binaryBase} argument references a path outside the workspace: ${p}`,
      );
    }
  }
  return null;
}
```

### Step 3 — apply universally, not per-binary

Call `checkPathsInArgs` for **all** commands that are not already handled by a
more specific check (git, package managers, shell invocations, interactive
REPLs). Remove the hardcoded binary list. This means the check applies to
`awk`, `sed`, `diff`, `jq`, `python3`, `node`, and everything else that the
hard-deny list does not already block.

```ts
// In checkSingleCommand, replace the current checkPathAccess call:
if ((result = checkPathsInArgs(binaryBase, args, config.workspaceRoot))) return result;
```

### Caveats to address during implementation

- **`~` and `-` expansion**: these are handled by the shell before args reach
  the policy layer (they appear as expanded strings). Confirm this with the
  parser before removing the explicit `~`/`-` checks in `isAllowedCdTarget`.
- **False positives on non-path arguments**: a token like `1/2` (arithmetic)
  or `application/json` (MIME type) would match `looksLikePath`. In practice
  these are uncommon in the allowed binary set; if they occur the heuristic
  can be tightened (e.g. require the token to start with `/`, `./`, or `../`,
  or to contain a path separator followed by a non-digit).
- **`tee` and `less` are in HARD_DENY_BINARIES**: they are already blocked
  before `checkPathAccess` is reached. They can be removed from any
  per-binary list in the new implementation.

## Current status

The naïve `flatMap` fix (splitting on `=`) was reverted. The weaknesses above
are documented here pending a proper implementation. In the meantime, the CI
sandbox (rlimits + network proxy) provides partial mitigation; the Seatbelt
(macOS) and bwrap (Linux) modes provide full filesystem confinement.
