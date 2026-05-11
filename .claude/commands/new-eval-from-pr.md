# Extract PR to eval inbox

You are helping capture a missed code review finding from a real pull request and turn it into a
repeatable eval case in `evals/datasets/inbox/`.

## What you are creating

A self-contained directory at `evals/datasets/inbox/<slug>/` containing:
- `slice.json` — metadata and expected findings
- `prompt/` — the review prompt file active when QualOps ran, at the base snapshot SHA
- `repo/` — a subset of the repo file tree at the PR's base snapshot, providing enough context
  for the agentic reviewer to reproduce the finding

The `repo/` directory mirrors real repo paths (e.g. `repo/src/api/widget.py`) and acts as `cwd`
for the agentic executor during eval runs.

## slice.json schema

```jsonc
{
  "id": "<slug>",                     // unique, kebab-case, used as caseId in Langfuse
  "prUrl": "<GitHub PR URL>",
  "prTitle": "<PR title>",
  "capturedAt": "<YYYY-MM-DD>",
  "capturedBy": "<GitHub username or name>",
  "language": "<primary language of the changed files>",
  "baseSha": "<SHA used for file contents — earliest accessible pre-rebase commit, or head>",

  // All prompts active when QualOps ran on this PR, stored at their repo-relative paths
  // inside prompt/. The sha pins the exact version captured.
  // prompt/ contains: .qualopsrc.json (inline systemPrompts), prompt files referenced by
  // passes, subagents/definitions.ts (built-in subagent prompts), and .qualops/agents/*.md
  // (custom agents) if any were present.
  "reviewPromptSha": "<sha at which prompts were captured>",
  "reviewPromptDir": "prompt/",

  // Provider and model QualOps used when it ran on this PR (from .qualopsrc.json in CI).
  // Provenance only — the eval runner uses its own preset at run time.
  "capturedWithProvider": "<anthropic | openai | ...>",
  "capturedWithModel": "<model id>",

  "diff": "<unified diff — full PR diff or trimmed to the relevant hunks>",

  // Real issues present at baseSha that QualOps missed — recall target for scoring.
  "expected": [
    {
      "file": "<repo-relative file path>",
      "line": 0,
      "lineEnd": 0,
      "type": "bug | security | performance | maintainability",
      "severity": "critical | high | medium | low",
      "description": "<concise, specific description of the issue>"
    }
  ],

  // Real issues present at baseSha that are outside the scope of the review prompt —
  // e.g. a correctness bug when the prompt is security-focused.
  // Not used by the recall scorer; preserved so the full picture is recorded.
  "outOfScope": [
    {
      "file": "<repo-relative file path>",
      "line": 0,
      "lineEnd": 0,
      "type": "bug | security | performance | maintainability",
      "severity": "critical | high | medium | low",
      "description": "<description of the real issue>",
      "reason": "<why this is outside the prompt's scope>"
    }
  ],

  // Issues QualOps reported (or that came up in review) that were confirmed as false
  // positives. Not used by the recall scorer; used for precision/noise analysis and
  // prompt improvement.
  "falsePositives": [
    {
      "file": "<repo-relative file path>",
      "line": 0,
      "lineEnd": 0,
      "type": "bug | security | performance | maintainability",
      "severity": "critical | high | medium | low",
      "description": "<the description produced>",
      "reason": "<why this is a false positive>"
    }
  ]
}
```

Classification rules:
- `expected` — real issue, present at baseSha, in scope for the prompt. Recall scorer uses this.
- `outOfScope` — real issue, present at baseSha, but outside what the prompt targets. Preserved for completeness.
- `falsePositives` — not a real issue, or real but incorrectly framed. Not scored for recall.
- Uncertain / unclassified — leave out of all arrays.

## Step-by-step process

### Step 1 — Identify the PR

Ask the user for the PR URL if not already provided. Then fetch:
- PR title, description, changed files, and diff
- All review comments (inline and top-level) — these are your primary source of truth for what
  was found and what was missed
- The QualOps bot comment if present (the `<!-- qualops-analysis-comment -->` comment) — this
  tells you what QualOps did find

Use `gh` CLI:
```bash
gh pr view <number> --repo <owner/repo> --json title,body,files,comments
gh api repos/<owner/repo>/pulls/<number>/comments   # inline review comments
gh api repos/<owner/repo>/pulls/<number>/reviews    # review submissions
```


### Step 2 — Collect findings from all sources

#### 2a — Determine which commits to use

QualOps may have run multiple times as commits were pushed to the PR. Earlier runs are the most
valuable because they reflect the original state of the code before any review-driven fixes were
applied — issues caught or missed at that point are the cleanest signal.

**Try the branch commit history first:**
```bash
gh pr view <number> --repo <owner/repo> --json commits \
  --jq '.commits | sort_by(.committedDate) | .[0]'
```

This works for linear histories but fails if the branch was rebased or force-pushed — the
pre-rebase commits are no longer reachable from the branch tip.

**If the branch history does not go back far enough, use the GitHub Actions run history.**
GitHub records the exact `head_sha` each workflow run was triggered on, including runs on
commits that were later rebased away. Fetch all QualOps runs for this PR:
```bash
# List all workflow runs triggered by this PR, sorted oldest first
gh api "repos/<owner/repo>/actions/runs?event=pull_request&per_page=100" \
  --jq "[.workflow_runs[] | select(.pull_requests[].number == <pr-number>)]
        | sort_by(.created_at)"
```

The oldest entry's `head_sha` is the SHA QualOps first ran on — this is your best candidate
for the **base snapshot**, as it predates any review-driven fixes.

**Verify the objects are still accessible** (GitHub retains unreachable objects for ~90 days
after a force-push, but not indefinitely):
```bash
gh api repos/<owner/repo>/commits/<base-sha> --jq '.sha' 2>/dev/null \
  && echo "accessible" || echo "GC'd — fall back to head"
```

Use the earliest accessible SHA as the **base snapshot**. If no pre-rebase SHA is accessible,
fall back to the PR's current head commit and note the limitation.

Add the resolved base snapshot SHA to `slice.json` as `"baseSha"` so the provenance is recorded:
```jsonc
"baseSha": "<sha used for file contents and finding applicability checks>"
```

#### 2b — Collect all QualOps bot runs

Fetch all issue comments and find every `<!-- qualops-analysis-comment -->` block — there may be
more than one if the check ran on multiple pushes:
```bash
gh api repos/<owner/repo>/issues/<number>/comments \
  --jq '[.[] | select(.body | contains("qualops-analysis-comment"))]'
```

Union all findings across all bot runs. For each finding, check whether the flagged code still
exists in the **base snapshot** (preferably) or head. If the code was changed or removed before
the snapshot you are using, exclude that finding — it is no longer applicable.

#### 2c — Collect human reviewer findings

1. **Inline PR review comments** — human reviewer findings, including issues QualOps missed
2. **PR review approvals/change requests with body text** — may contain summary findings
3. **The PR description itself** — sometimes authors self-identify risks

#### 2d — Ask the user interactively

Present the consolidated candidate list (all bot findings still applicable + human findings) and
ask:
- "Are there any issues found during this PR review that aren't reflected above?"
- "Which of the QualOps findings were confirmed as real issues?"
- "Which QualOps findings were dismissed as false positives, and why?"
- "Is there any out-of-band context (Slack, verbal discussion) about issues found in this PR?"

From the answers, classify each candidate into one of five buckets:
- **true positive missed by QualOps, in scope** → `expected`
- **true positive missed by QualOps, outside prompt scope** → `outOfScope` (real bug, but the
  prompt doesn't target it — e.g. a correctness issue when the prompt is security-focused)
- **true positive caught by QualOps** → noted but not in any array
- **false positive** → `falsePositives`
- **uncertain** → excluded from all arrays

### Step 3 — Determine the slug

Derive a slug from the repo name and PR number: `<repo>-pr-<number>-<short-description>`.
Example: `qualops-pr-144-policy-path-traversal`

Ask the user to confirm or adjust it.

### Step 4 — Select files for repo/

Work finding-by-finding through `expected` (and `outOfScope`). For each finding ask three
questions:

**1. What does the flagged code call or import?**
Files that the flagged lines directly use — imported utilities, types, interfaces, base classes.
Include these if the reviewer needs to understand them to see the issue. Skip if the import is
obvious from its name alone.

**2. What calls the flagged code?**
Callers/consumers that show how the vulnerable path is actually reached — e.g. the executor
that passes `workspaceRoot` into the driver, the session that logs before redacting. Include
when the bug only manifests at a call site or when severity depends on how the code is invoked.

**3. What files are needed to assess severity or rule out a FP?**
"Assessment files" — files that a reviewer would read to judge whether the issue is real and
how bad it is. Examples:
- Other sandbox mode implementations (`none.ts`, `ci.ts`) to assess whether a bypass is
  exploitable in practice
- The downstream mechanism that might already catch the issue
- A config or template file that the flagged code claims "is checked further below"
- Type definitions that clarify what attacker-controlled inputs look like

After answering all three questions for every finding, add:
- Every file touched in the PR diff that hasn't already been included
- Config files, schema files, or architecture docs if the miss was a domain-knowledge gap

Omit:
- Build artifacts, lock files, generated migration files
- The full transitive import graph — only what the reasoning path actually needs
- Test files, unless the finding is specifically about missing or incorrect test coverage

Fetch file contents at `baseSha`:
```bash
git show <baseSha>:<path>
```

Present the proposed file list to the user and ask:
- "Are there any files missing that a reviewer would need to spot or assess these issues?"
- "Are there any files in this list that are clearly irrelevant?"

### Step 5 — Capture all prompts

The findings are produced by the union of everything that ran, so capture all prompt sources.
Store each file at its **repo-relative path** inside `prompt/` — this mirrors the real repo
layout and makes provenance obvious without inventing a naming scheme.

The standard set to collect:

| Source | Repo path | What it contains |
|---|---|---|
| Pipeline config | `.qualops/.qualopsrc.json` | Inline `systemPrompt` strings for agentic passes |
| File-by-file pass prompt | `.qualops/prompts/<name>/review-system-message.md` | The pass prompt (one file per pass) |
| Built-in subagent prompts | `src/stages/review/agentic/subagents/definitions.ts` | All built-in subagent prompt strings |
| Custom agents (optional) | `.qualops/agents/*.md` | Custom/override agent prompts |

Fetch each at `baseSha` and write to `prompt/<same-repo-relative-path>`:

```bash
# Pipeline config — always include
git show <baseSha>:.qualops/.qualopsrc.json > prompt/.qualops/.qualopsrc.json

# File-by-file pass prompts — check .qualopsrc.json for review.pipeline[].passes[].prompt
git show <baseSha>:.qualops/prompts/<name>/review-system-message.md \
  > "prompt/.qualops/prompts/<name>/review-system-message.md"

# Built-in subagent prompts — always include for agentic pipelines
git show <baseSha>:src/stages/review/agentic/subagents/definitions.ts \
  > prompt/src/stages/review/agentic/subagents/definitions.ts

# Custom agents — only if the directory exists at baseSha
git show <baseSha>:.qualops/agents 2>/dev/null \
  && git show <baseSha>:.qualops/agents/<name>.md > "prompt/.qualops/agents/<name>.md"
```

Record in `slice.json`:
```jsonc
"reviewPromptSha": "<baseSha>",
"reviewPromptDir": "prompt/"
```

Also record the provider and model from `.qualopsrc.json` at `baseSha`:
```jsonc
"capturedWithProvider": "<provider>",
"capturedWithModel": "<model id>"
```

### Step 6 — Build the diff

Use the full PR diff or, if the PR is large and only some files are relevant to the findings,
trim to the hunks that contain or lead to the issue. Include enough `@@` hunk context that the
reviewer can orient itself.

Fetch with:
```bash
curl -s -H "Accept: application/vnd.github.v3.diff" \
  "https://api.github.com/repos/<owner/repo>/pulls/<number>"
```

### Step 7 — Verify each finding against the code at baseSha

Before writing, do a skeptical second-pass re-evaluation of every candidate in `expected`,
`outOfScope`, and `falsePositives`. For each one:

1. **Fetch the actual file at `baseSha`** and read the relevant lines. Do not rely on memory
   from earlier in the conversation — the code may differ from what you expect.
2. **Verify the issue is present.** If the code was already fixed before `baseSha`, or the
   stated mechanism doesn't work as described (e.g. a check downstream already catches it),
   the finding is not applicable at this snapshot — remove or reclassify it.
3. **Verify false positive reasoning.** Project docs (security iteration logs, post-mortems) may
   document FP dismissals, but those dismissals can be wrong — verify the reasoning against the
   actual code at `baseSha`. A dismissed finding whose dismissal logic is incorrect should be
   reclassified as real.
4. **Consider prompt scope for borderline cases.** A finding that is security-adjacent but
   primarily covered by a downstream mechanism (e.g. the sandbox) belongs in `expected` at
   `low` severity, not in `falsePositives` — a reviewer who flags it is correct.

Present a classification summary to the user and call out any items whose classification changed
from the initial assessment, with the reason.

### Step 8 — Write the files

1. Create `evals/datasets/inbox/<slug>/` directory
2. Create `prompt/` subdirectory and write the prompt file there
3. Write `slice.json` with the confirmed metadata and all arrays
4. Copy each selected file into `evals/datasets/inbox/<slug>/repo/<repo-relative-path>`,
   preserving the directory structure

After writing, show the user the directory tree and `slice.json` and ask for a final confirmation
before finishing.

### Step 9 — Summarise

Present a findings report grouped by commit so the user can see the full picture and decide
whether additional evals are needed for other commits.

**Base snapshot (`<baseSha>`)** — the commit this eval is built on:
| Finding | Source | Classification | In eval |
|---|---|---|---|
| `<file>:<line> — <description>` | QualOps run / human review | true positive missed (in scope) / true positive missed (out of scope) / true positive caught / false positive | expected / outOfScope / — / falsePositives |

**Other commits** — findings that were reported on different commits and are NOT included in this
eval because the code at the base snapshot differs:
| Finding | Commit | Source | Note |
|---|---|---|---|
| `<file>:<line> — <description>` | `<short-sha>` | QualOps run #N / reviewer | e.g. "code changed before base snapshot" / "introduced in later commit" |

If there are findings in the "other commits" table that look like independent, still-relevant
issues, tell the user:
> "These findings were on a different commit version. If the underlying issue is distinct from
> what's captured in this eval, they may be worth a separate inbox entry. You can run
> `/new-eval-from-pr` again and specify that commit as the target."

Finally:
- Confirm the slug and location: `evals/datasets/inbox/<slug>/`
- Next step: `npm run eval:upload -- --source=inbox && npm run eval -- --dataset=qualops/inbox`
