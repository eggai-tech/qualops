# TDR: Evals from Real PR Issues

**Status**: Draft
**Date**: 2026-05-08

---

## Problem

When a developer reviews a PR and spots a bug that QualOps missed, there is currently no fast path to turn that real-world miss into a regression test. The options available are:

1. Add a case to `evals/datasets/typescript-bugs.jsonl` — but that requires constructing synthetic file content and a diff by hand.
2. Add a CRB case — but CRB requires cloning the full repo at a specific commit and wiring up `git.repo_path` / `git.head_sha` metadata, which is heavy even for one bug.

Neither option is designed for the "I just saw this, let me capture it now" workflow. The result is that real misses go unrecorded and QualOps does not learn from them.

---

## Goal

A developer who finds a real miss should be able to:

1. Capture the relevant files and the diff in under five minutes.
2. Commit a self-contained eval case that runs end-to-end through the existing harness — including all agentic tools — without needing the full repo history.
3. Have that case scored for recall automatically on every eval run.

---

## Constraints

- The eval must be **fully processable by the existing qualops harness** (`runReviewForItem` → `runReviewMultiFile` / `runReview` → `AgenticExecutor` / `PipelineExecutor` / `FileReviewer`).
- The agentic executor uses `cwd` to answer tool calls (file reads, grep, etc.). The subset must behave like a real repo directory — files must be present at the same paths they have in the real repo.
- Context footprint must be **much smaller than the full repo**. The goal is the minimal set of files needed for the agent to reproduce the reasoning that leads to the finding.
- No new harness code should be required for the common case. The dataset format already supports `diff`, `fullContent`, `git.repo_path`, and `git.head_sha`. The new case type reuses these slots.

---

## Proposed Format: "slice" eval case

A slice is a directory that acts as a minimal repo substitute. It lives at:

```
evals/datasets/inbox/<slug>/
  slice.json          # metadata + expected findings
  repo/               # file tree rooted here, mirrors repo paths
    <file-tree>/
```

### `slice.json` schema

```jsonc
{
  // Unique ID for the eval case, used as caseId in Langfuse
  "id": "sentry-pr-12345-missing-null-check",

  // Human context — not used by the harness, useful for debugging
  "prUrl": "https://github.com/getsentry/sentry/pull/12345",
  "prTitle": "feat: add new endpoint for widget data",
  "capturedAt": "2026-05-08",
  "capturedBy": "valdis",

  // Language tag passed to the reviewer
  "language": "python",

  // The unified diff of the PR (only the relevant hunks — can be trimmed)
  "diff": "diff --git a/src/sentry/api/endpoints/widget.py ...\n...",

  // Expected findings — same schema as typescript-bugs.jsonl `expected[]`
  "expected": [
    {
      "file": "src/sentry/api/endpoints/widget.py",
      "line": 42,
      "lineEnd": 42,
      "type": "bug",
      "severity": "high",
      "description": "findById() can return None; accessing .data on line 42 will raise AttributeError"
    }
  ]
}
```

The file tree lives under `repo/` inside the slug directory, mirroring the real repo paths. For example, if the PR touched `src/sentry/api/endpoints/widget.py` and the context needed is `src/sentry/models/widget.py`, the slice contains both:

```
evals/datasets/inbox/sentry-pr-12345-missing-null-check/
  slice.json
  repo/
    src/
      sentry/
        api/
          endpoints/
            widget.py          # file at the PR's head commit
        models/
          widget.py            # context file that reveals the None return
```

---

## How the harness runs it

The `repo/` subdirectory acts as `cwd` for the agentic executor, exactly like a full cloned repo does today. No harness changes are required:

1. `upload-datasets.js` gains a `--source=inbox` mode that reads each `slice.json`, builds a dataset item with `source: 'slice'`, sets `git.repo_path` to `<slug>/repo/` (relative to `QUALOPS_ROOT`), omits `git.head_sha` (so no worktree is created — the slice itself is the checkout), and sets `diff` from `slice.json`.

2. `reviewer.js` already handles the case where `git.head_sha` is absent: it uses `repoPath` directly as `cwd`. The `repo/` directory satisfies this.

3. The agentic executor runs with `cwd = <slug>/repo/`, so grep/read tool calls resolve against the slice files at their original repo-relative paths, not the full repo. The agent sees only the files the developer placed there.

4. Scoring runs through the existing `crb_recall` scorer against `expected[]` from `slice.json`, the same as qualops-source cases.

---

## Capture workflow (developer steps)

When a developer finds a miss:

```
# 1. Create the slice directory
mkdir -p evals/datasets/inbox/<slug>

# 2. Export the relevant diff (trim to the interesting hunks if the PR is large)
git -C <repo> diff <base>..<head> -- <files> > /tmp/pr.diff

# 3. Copy only the files needed — the changed file(s) plus any context files
#    that make the bug visible (typically 1-3 files total)
cp -r <repo>/<path> evals/datasets/inbox/<slug>/repo/<path>

# 4. Write slice.json — describe the miss and the expected finding
#    (template below)

# 5. Commit and run
npm run eval:upload -- --source=inbox
npm run eval -- --dataset=qualops/inbox
```

The developer writes a `slice.json` from the template. The most important fields are `diff` and `expected`.

### Template

```jsonc
{
  "id": "",
  "prUrl": "",
  "prTitle": "",
  "capturedAt": "YYYY-MM-DD",
  "capturedBy": "",
  "language": "",
  "diff": "",
  "expected": [
    {
      "file": "",
      "line": 0,
      "lineEnd": 0,
      "type": "bug",
      "severity": "high",
      "description": ""
    }
  ]
}
```

---

## File selection guidelines

The goal is the context that makes the bug findable — not the minimum number of files, and not the whole repo. Slice size will vary widely depending on the PR.

| Include | Omit |
|---|---|
| Every file touched in the diff | Unrelated files in the same directory that the PR did not touch |
| Files that the changed code depends on, if the bug requires understanding them (upstream dependencies) | The full transitive import graph beyond what the reasoning path actually needs |
| Files that depend on the changed code, if the bug manifests at a call site (downstream consumers) | Build artifacts, lock files, generated migration files |
| Config files referenced by the changed code, if the bug is config-related | Unrelated docs and assets |
| Architecture docs or `README`s if the miss was a domain-knowledge gap | — |
| Test files if the miss is about missing test coverage or incorrect test assertions | — |

**The right question is: which files does the agent need to reach the same conclusion a human reviewer did?**

If the agent needs to grep for a symbol and that symbol lives in a file not in the slice, add that file. A slice that is too thin produces a false recall failure — the agent cannot find the bug because context is missing, not because QualOps is broken. Err on the side of including more files rather than fewer.

---

## Scoring

Slice cases are scored using the existing `crb_recall` scorer. A finding is matched if:

- The detected issue's description semantically overlaps the `expected` description (LLM judge).
- The detected file matches `expected.file`.
- The detected line falls within `[expected.line - 5, expected.lineEnd + 5]` (existing line-accuracy tolerance).

Because inbox cases are captured from real missed bugs, the recall baseline starts at 0 for every new case. Improvement over time is the signal.

---

## Dataset naming

Slice cases are uploaded to a dedicated Langfuse dataset: `qualops/inbox`. This keeps them separate from the synthetic `qualops` dataset and the large CRB datasets, while being selectable individually for fast iteration:

```
npm run eval -- --dataset=qualops/inbox
npm run eval -- --dataset=qualops/inbox --severity=high,critical
```

---

## What is intentionally out of scope

- **Automatic capture tooling** (browser extension, CLI wizard). Manual capture is fast enough and keeps the format simple.
- **Syncing inbox cases with the upstream PR repo**. The slice is a snapshot; it does not track upstream changes.
- **Slices for false positives**. A false-positive case would require a different scorer (precision, not recall). That is a separate problem.
- **Multi-PR cases**. Each inbox case covers one PR and one finding. If a PR has multiple independent misses, create one case per finding or group tightly related findings in a single case.

---

## Implementation tasks

1. Add `--source=inbox` mode to `upload-datasets.js` — reads `evals/datasets/inbox/*/slice.json`, builds items with `source: 'slice'`, uploads to `qualops/inbox`.
2. Confirm `reviewer.js` `resolveRepoCwd` handles a slice path (no `head_sha`, `repo_path` is a relative path inside the project). Should work today; verify with one real slice.
3. Add `slice.json` template to `evals/datasets/inbox/README.md` (or `CONTRIBUTING.md`).
4. Add `eval:upload:inbox` and `eval:inbox` npm scripts.
5. Capture the first real slice from an observed miss to validate end-to-end.
