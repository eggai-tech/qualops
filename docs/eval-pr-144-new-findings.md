# New findings for eval: qualops-pr-144-bash-tool

Four issues were flagged by qualops on PR #144 (`feat-bash-tool`) in a review run on
2026-05-12. None are present in the existing
`evals/datasets/inbox/qualops-pr-144-bash-tool/slice.json`.

After analysis: **1 is fixed**, **1 is a known gap with a design doc** (no fix yet), **2 are false positives** (no fix).
See the slice.json additions at the bottom for the ready-to-merge JSON objects.

All line numbers refer to the pre-fix snapshot unless noted otherwise.

---

## 1. Timeout race does not kill the running shell command

| Field       | Value |
|-------------|-------|
| file        | `src/stages/review/agentic/tools/bash/exec.ts` |
| line        | 36 (pre-fix) / 42 (post-fix) |
| lineEnd     | 42 |
| type        | `security` |
| severity    | `high` |

**Description:**
`execBashCommand` uses `Promise.race` to implement a timeout: when the timeout
fires it resolves with `null` and the function returns immediately. However,
`session.exec` continues running in the persistent bash shell — it is never
interrupted. The ongoing command can produce side effects (file writes,
network calls, CPU consumption) after the caller has already received a
`timed_out` result. More critically, when the pending `writeAndWaitForSentinel`
eventually resolves it drains `stdoutBuf`/`stderrBuf`, which corrupts the
output buffer of the *next* command executed on the same session, causing it
to silently inherit stale output or miss its sentinel.

**Fix applied:** Two changes across `exec.ts` and `session-impl.ts`:

1. `session.interrupt()` is called immediately when the race resolves with
   `null`. It sets an `interrupting` flag, then sends `SIGINT` to the bash
   process. SIGINT kills the running command; bash then executes the sentinel
   echo lines and `writeAndWaitForSentinel` drains cleanly, clearing the flag.

2. An `interrupting` guard was added to `exec()`: any new command arriving
   in the window between SIGINT being sent and the sentinel being drained
   throws immediately rather than racing with the stale buffers. Once
   `writeAndWaitForSentinel` finishes draining it clears `interrupting`,
   and the session accepts new commands normally.

---

## 2. `checkPathAccess` misses paths in flag values and covers only 8 binaries

| Field       | Value |
|-------------|-------|
| file        | `src/stages/review/agentic/tools/bash/policy.ts` |
| line        | 561 |
| lineEnd     | 562 |
| type        | `security` |
| severity    | `medium` |

**Description:**
`checkPathAccess` has two structural weaknesses:

1. It filters path candidates with `args.filter(a => !a.startsWith('-'))`,
   dropping long-form flag values. `cp --target-directory=/etc/cron.d file`
   passes unchecked because the embedded path is inside a flag token.

2. The check only covers 8 hardcoded binaries (`cat`, `head`, `less`, `more`,
   `cp`, `mv`, `tee`, `ln`). Many other allowed binaries that take path
   arguments — `awk`, `sed`, `diff`, `jq`, `grep`, etc. — are not covered.
   In CI mode (no filesystem sandbox) the policy layer is the sole guard.

**No fix applied.** A naïve `flatMap` over `=`-split values was considered and
reverted: it misses space-separated flag values and pulls in non-path tokens.
A proper fix requires an argument-driven approach that scans all tokens for
path-like strings using `resolveWithinCwd` from `security.ts`, applied
universally rather than per-binary. See
[`docs/policy-path-checking-improvement.md`](policy-path-checking-improvement.md)
for the full design.

---

## 3. ~~`LD_LIBRARY_PATH` and `DYLD_LIBRARY_PATH` passed through via env-scrub allow list~~ — FALSE POSITIVE

| Field       | Value |
|-------------|-------|
| file        | `src/stages/review/agentic/tools/bash/env-scrub.ts` |
| line        | 45 |
| lineEnd     | 46 |
| type        | `security` |
| severity    | `medium` |

**Why this is a false positive:**

The threat model for qualops is: the *operator environment is trusted*; the
attack surface is a rogue AI model issuing bash commands. Against that model
this finding does not hold for two independent reasons:

1. **The inherited value is not attacker-controlled.** `LD_LIBRARY_PATH` and
   `DYLD_LIBRARY_PATH` in `_ALLOW_LIST` come from the operator's own process
   environment. For them to point to a malicious directory the operator's
   machine would already have to be compromised — which is outside qualops'
   threat model.

2. **The AI cannot inject its own value.** `checkEnvHijacking` in `policy.ts`
   (line 361) explicitly blocks any command containing `LD_LIBRARY_PATH=` or
   `DYLD_LIBRARY_PATH=` as an inline assignment. A rogue model cannot override
   the inherited value by issuing a command.

The env-scrub allow list's purpose is to prevent *secret* env vars (tokens,
keys, passwords) from leaking to the subprocess — not to strip benign path
variables. Removing `LD_LIBRARY_PATH` from the allow list would serve no
security purpose and could break tools that depend on it (e.g. native Node
addons, compiled binaries in the workspace).

**No fix applied.** Revert was made after initial incorrect fix.

---

## 4. ~~`extraDenyPatterns` compiles `RegExp` without error handling~~ — FALSE POSITIVE

| Field       | Value |
|-------------|-------|
| file        | `src/stages/review/agentic/tools/bash/policy.ts` |
| line        | 620 |
| lineEnd     | 620 |
| type        | `bug` |
| severity    | `medium` |

**Why this is a false positive:**

`extraDenyPatterns` is a field on the internal `PolicyConfig` interface. It is
only referenced in `policy.ts` — nothing in the codebase populates it from an
operator-supplied config file or external input. The patterns are written by
qualops developers and would fail visibly at development time. There is no
code path where a user or operator can supply a malformed regex string at
runtime.

**No fix applied.** Revert was made after initial incorrect fix.

---

## slice.json additions (ready to merge)

### Add to `expected`

```json
{
  "file": "src/stages/review/agentic/tools/bash/exec.ts",
  "line": 36,
  "lineEnd": 42,
  "type": "security",
  "severity": "high",
  "description": "Promise.race timeout fires but session.exec continues running in the persistent bash shell. The timed-out command keeps executing with side effects; when it eventually resolves, writeAndWaitForSentinel drains and clears stdoutBuf/stderrBuf, corrupting the output buffer of the next command on the same session. A secondary race exists: any new exec() call arriving before the stale sentinel drains will mix its output with the timed-out command's buffered output."
},
{
  "file": "src/stages/review/agentic/tools/bash/policy.ts",
  "line": 561,
  "lineEnd": 562,
  "type": "security",
  "severity": "medium",
  "description": "checkPathAccess filters path candidates with args.filter(a => !a.startsWith('-')), silently dropping long-form flag values like --target-directory=/etc. Additionally the check covers only 8 hardcoded binaries; awk, sed, diff, grep and other allowed binaries that accept path arguments are not covered. In CI mode (no filesystem sandbox) the policy layer is the sole guard."
},
{
  "file": "src/stages/review/agentic/tools/bash/policy.ts",
  "line": 310,
  "lineEnd": 406,
  "type": "security",
  "severity": "high",
  "description": "checkGitCommand uses args.find() to locate the -c flag, stopping at the first match. A command with multiple -c flags (e.g. git log -c safe.key=val -c core.hooksPath=/evil) passes the check if the first -c pair is benign — the second dangerous pair is never inspected."
},
{
  "file": "src/stages/review/agentic/tools/bash/policy.ts",
  "line": 338,
  "lineEnd": 390,
  "type": "security",
  "severity": "medium",
  "description": "checkPackageManager reads the subcommand from args[0], assuming it is always the first token. Flags before the subcommand (e.g. npm --loglevel=silent install) place a flag at args[0], so the denied subcommand install is never seen and the command is allowed through."
},
```

### Add to `falsePositives`

```json
{
  "file": "src/stages/review/agentic/tools/bash/policy.ts",
  "line": 620,
  "lineEnd": 620,
  "type": "bug",
  "severity": "medium",
  "description": "new RegExp(pattern) is called for each extraDenyPatterns entry without a try/catch. A malformed pattern throws a SyntaxError that propagates uncaught out of evaluatePolicy.",
  "reason": "extraDenyPatterns is an internal PolicyConfig field populated only by qualops developer code, never from operator-supplied config or external input. A broken regex would fail visibly at development time. There is no runtime path where a user or operator can supply a malformed pattern."
},
{
  "file": "src/stages/review/agentic/tools/bash/env-scrub.ts",
  "line": 45,
  "lineEnd": 46,
  "type": "security",
  "severity": "medium",
  "description": "LD_LIBRARY_PATH and DYLD_LIBRARY_PATH are in the env-scrub allow list and passed to the sandbox subprocess, allowing a rogue AI to exploit an attacker-controlled library path inherited from the parent process.",
  "reason": "The operator environment is trusted in qualops' threat model; the attack surface is the AI issuing commands. The inherited value comes from the operator's own process and is not attacker-controlled. More importantly, the AI cannot inject its own value: checkEnvHijacking in policy.ts (line 361) explicitly blocks any command containing LD_LIBRARY_PATH= or DYLD_LIBRARY_PATH= as an inline assignment. The env-scrub allow list exists to prevent secret leakage, not to strip benign path variables."
}
```
