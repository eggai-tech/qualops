# 02 — Pipeline Specification

**Status:** Draft spec for human review · Terms per [01-goals-and-glossary.md](01-goals-and-glossary.md). Evidence for every mechanism: appendix B (industry/research), appendix A (defects this design fixes, cited as F-nn), appendix E (destructure/context/cost research, 2026-07-09).

## 1. The Finding (core data contract)

```ts
interface Finding {
  schemaVersion: number
  fingerprint: string            // §2 — stable identity
  status: 'candidate' | 'filtered' | 'refuted' | 'artifact-only'
        | 'admitted' | 'published' | 'addressed' | 'dismissed' | 'suppressed'
  file: string
  anchor: { startLine: number; endLine: number; snippet: string }
  category: Category             // one vocabulary, defined in contracts
  severity: 'critical' | 'high' | 'medium' | 'low'
  description: string
  fixProposal?: { search: string; replace: string; safety: 'mechanical' | 'needs-review' }
  evidence: Evidence[]           // required for admission
  generator: { reviewer: string; model: string; sample: number }
  generatorConfidence?: number   // 1–10, DIAGNOSTIC ONLY — never used for gating
  verification?: {
    verdict: 'confirmed' | 'refuted' | 'needs-more-evidence'
    confidence: number           // 0–100 — the only confidence that gates
    reasoning: string
    verifierModel: string
  }
  rejectReason?: RejectReason    // set whenever status is a rejection state
  provenance: { promptHash: string; configHash: string; contextLedgerRef: string }
}

type Evidence =
  | { kind: 'code-citation'; file: string; lines: [number, number]; snippet: string }
  | { kind: 'check'; command: string; output: string }      // via the bash sandbox
  | { kind: 'trace'; steps: string[] }                       // data-flow narration with cited hops
```

The full finding history (all statuses, including rejected candidates) is persisted per run as artifacts. Only `admitted` findings are ever published; `refuted` and `artifact-only` findings remain available for eval capture and the transparency panel.

## 2. Fingerprint

```
fingerprint = sha256(filePath + category + normalize(description) + normalize(anchor.snippet))[0..16]
```

`normalize` = lowercase, collapse whitespace and numbers. Line numbers are **not** hashed. Requirements:

- **FP-1** Two findings differing only in line position (drift) produce the same fingerprint.
- **FP-2** Two distinct findings on the same line produce different fingerprints (fixes F-27's `file:line` collision).
- **FP-3** The same finding from different reviewers/samples/runs produces the same fingerprint (exact dedup = hash-set lookup).
- **FP-4** Published comments embed the fingerprint as a hidden marker (`<!-- qualops:finding:<fp> -->`) for cross-run re-identification.
- **FP-5** Re-anchoring after a push locates `anchor.snippet` nearest the previous position; a finding whose snippet no longer exists is a candidate for auto-resolution (§7).

## 3. Pipeline stages

```
INTAKE → GENERATE → FILTER → VERIFY → ADMIT → PUBLISH → LEARN
```

Fix proposals, reporting, and the gate consume the pipeline's output (§8–§10). Legacy stage mapping for migration: analyze→Intake; review→Generate+Filter+Verify+Admit; fix→Fix proposals; report→Reporting; judge→Gate.

### 3.1 Intake (deterministic end to end — zero tokens)

Intake **destructures** the PR into tiered **change-units**, each carrying a pre-assembled **context pack** (terms: 01 §4). Evidence for every mechanism: appendix E. Destructuring scopes *context and reviewer selection only* — it is never a generation plan (D14; the deterministic lane TDR 0005 left open).

- **a) Diff hygiene**: lockfiles, minified, generated, and source-map files are excluded by default; **database migrations are never excluded**. Exclusions are configurable and always reported.
- **b) Hunk classification** via AST edit-script (tree-sitter before/after parse): `format-only | comment-only | rename | signature-change | logic-change`. Ambiguous/unparseable hunks conservatively default to `logic-change` — never silently down-classified. `format-only`/`comment-only` hunks are ledger-recorded and **never reach an LLM** — silence on no-op changes costs zero tokens (serves `spurious_rate`, 05 §2). Move-vs-rewrite is known-unreliable in AST diffing; unclear = `logic-change` (heuristic upgrades: backlog).
- **c) Change-unit grouping**: connected components over deterministic edges — def-use/symbol references (tree-sitter symbol table), import relations, same-file affinity; commit metadata adds *soft* edge weights only (commit hygiene is unreliable — never hard boundaries). Component size capped (~8 files, spike-validated); ungroupable leftovers form one **residual unit**, so no hunk is ever unreviewed. Known accuracy bound: pure-graph grouping ≈70–85% in the commit-level literature, and PR-level composition is our own hypothesis to validate on eval slices (appendix E §2, §6) — acceptable because a grouping error only mis-scopes context, never drops work. **v1 groups at file granularity** (= the previously specified import-graph clustering); hunk-level grouping is promoted by eval evidence (07-backlog).
- **d) Tiering — per change-unit**: `trivial` (≈ ≤10 changed lines, or only `rename`/low-risk classes) → one generalist checklist reviewer on a budget model; `normal` → the configured reviewer set; `full` (large units or sensitive paths) → all matching reviewers incl. agent-mode escalation (D13) on the strongest configured model. `sensitivePaths` (auth, crypto, CI config…) always force `full`. PR-level tier (for reporting) = max over units.
- **e) Impact set — per change-unit**: the changed symbols plus their relations in **both directions** — dependencies (imports/callees) *and* callers/references of changed exported symbols (the direction breaking-change FPs come from) — via language-native analysis: TS LanguageService `findReferences` + dependency-cruiser (TS/JS), PyCG (Python), `go/callgraph` (Go), tree-sitter symbol graph as the polyglot floor. Heavy index builds (CodeQL, SCIP, Joern) are excluded by the minutes-budget and zero-infrastructure (01 §2) constraints.
- **f) Context pack — per change-unit, byte-budgeted**: candidates ranked by personalized PageRank over the symbol graph, **seeded from the unit's changed symbols**, 1–2 hops (aider repo-map method); selected unchanged files enter as bounded **anchor-window digests** (initial caps: ≤6 files, ~4KB each — spike-validated), explicitly labeled *context only, never a review target*. Overflow follows a **priority ladder**: named optional items dropped one at a time in fixed order, each drop ledger-recorded; **source and diff are never silently truncated** — a unit that cannot fit is split, or the run errors loudly (principle #6). Prompt layout is cache-aware: stable repo-level preamble first, per-unit material last (cache-read ≈0.1× input price; appendix E §4).

### 3.2 Generate (recall stage)

- Reviewers are selected **per change-unit**: tier + `paths:` globs + the unit's change classes (e.g. the security reviewer runs only on units touching auth/input paths; no reviewer sees `format-only`/`comment-only` units). Matching reviewers run **in parallel** across units. Reviewer definition and selection: [04-configuration-spec.md](04-configuration-spec.md). Execution: `checklist` reviewers via the `CompletionPort`, `agent` reviewers via the `AgentRunPort` ([03-architecture-spec.md](03-architecture-spec.md) §4a) — business logic never touches the harness backend.
- **Default execution is a single-shot holistic call per change-unit** (D13): line-numbered changed source + diff + the unit's context pack — whole-unit reasoning, one pass (the spike's probes: holistic out-recalled multi-step decomposition; a second pass hurt precision and was reverted — appendix E §5). **Agent-mode review is the escalation tier**, not the default: `full`-tier units, `sensitivePaths`, and languages where the impact analysis has known recall gaps (dynamic dispatch, reflection). Evidence: fixed retrieval-grounded pipelines beat agentic scaffolds on accuracy *and* cost, and improve with model swaps at zero architecture cost (appendix E §3).
- Generation prompts are deliberately **aggressive** ("investigate every suspicious pattern") — precision is downstream's job (D1).
- Output schemas enforce **reasoning-before-conclusion** field order (−51% FP evidence, appendix B).
- Optional **sampling**: N passes with shuffled input order; per-finding vote counts recorded. Off by default (cost); recommended for `strict` profile.
- Structured-output failures get one repair retry (re-prompt with the validation error), then surface as a visible run notice — never a silent empty result (fixes F-16).
- Prose-dialect models run the same stages; their findings are normalized best-effort at the LLM boundary and marked where verification cannot be supported.

### 3.3 Filter (deterministic, zero tokens)

Order matters; each drop records its RejectReason:

1. **Scope**: the anchor must lie in a changed file and overlap the changed lines (hunk range ± small tolerance) — hard filter; was prose-only (F-11). **Cause-anchoring rule**: a defect *caused* by the change but manifesting in unchanged code (e.g. a changed signature breaking an unchanged caller) must be anchored to the causing changed line — reviewers anchor to cause, not symptom (prompt-enforced, filter-checked). Findings that cannot be re-anchored into the diff become `artifact-only`, never published.
2. **Citation check**: `anchor.snippet` must exist at/near the cited line; findings citing nonexistent code are dropped.
3. **Exact dedup**: fingerprint hash-set across all reviewers/samples/files (F-12).
4. **Category excludes**: configured hard list (e.g. style-owned-by-linter, theoretical DoS) — the prompt "NOT to flag" lists made enforceable.
5. **Vote threshold** (if sampling enabled): findings seen in ≥2 samples proceed.
6. **Linter suppression**: findings matching a rule a configured linter already reported are dropped (deterministic tools own deterministic problems).

### 3.4 Verify (precision stage)

One verifier invocation per surviving candidate:

- **Context asymmetry**: input = the claim + a freshly retrieved code slice (+ read-only tool access); the generator's reasoning is withheld. **The slice is assembled deterministically**: the anchor's enclosing declaration plus one def-use hop from the intake impact set (§3.1e) — the dependency-sliced-context pattern with the strongest published FP-mitigation evidence (appendix E §3). Verification calls share the cached repo preamble and may run via batch API (latency is cheap here; cache-read × batch ≈ 0.05× list price — appendix E §4).
- The verifier must attach at least one `Evidence` item and state the concrete failure scenario, or refute. Optional executed checks run in the existing bash sandbox.
- Output: verdict + confidence 0–100 (D1). Verdict aliases (`false-positive` → `refuted`, etc.) are normalized at the LLM boundary.
- **Cross-model option**: verifier from a different provider family (D9), configurable.
- A single **global near-duplicate pass** (LLM) merges semantically-equal confirmed findings across files (replaces the per-file dedup calls).
- Cost control: verification respects the run's `maxUsd` budget; on exhaustion, unverified candidates become `artifact-only` with a run notice — completed work is never discarded (fixes F-17).

### 3.5 Admit (deterministic)

In order, each with RejectReason: verification verdict must be `confirmed` → `confidence ≥ verification.minConfidence` (default 80, calibrated per [05-quality-spec.md](05-quality-spec.md)) → severity ≥ the reviewer's/profile's floor (linter-confirmed deterministic findings may bypass the floor) → feedback-memory suppression (§9) → volume budget (max inline findings per PR, severity-prioritized; overflow → artifact-only, counted in the summary).

### 3.6 Publish — see §7. · Learn — see §9.

## 4. LLM boundary (normative for all model I/O)

All model output — structured, prose, tool results, agent results — passes through one funnel: JSON recovery ladder (fences, truncation, control chars, trailing commas) → loose `Model*Schema` (`z.preprocess`: enum alias maps, snake_case fallbacks, string→number coercion, nested-location unwrapping, `.catch(undefined)`, truncate-before-parse) → `normalize()` → strict contract. No code outside this module parses model output. Recovered-vs-failed parses are observable per run. (Architecture placement: [03-architecture-spec.md](03-architecture-spec.md) §4.)

## 5. Prompt governance

- Prompt output sections are **generated from the contracts** (or CI asserts prompt/schema agreement) — drift like F-21/F-22 becomes structurally impossible.
- Reviewer prompts carry the platform-owned invisible parts (output schema, response format); users never write or violate them.
- Every reviewer prompt should include a "do NOT flag" section; `qualops doctor` warns when missing.
- User-controlled text (PR title/body/comments) is sanitized — structural delimiters stripped — before any prompt assembly (prompt-injection defense).

## 6. Error, exit, and telemetry contract

- All failures normalize to a `StructuredError { code, category, recoverable, exitCode, details }` with provider subcodes (`provider_rate_limited`, `provider_auth`, `provider_context_length`, `provider_adapter_missing`). Messages and details pass redaction before any sink.
- One exit point: telemetry is flushed before every exit (fixes F-2). Exit codes: `0` success/gate-passed · `1` gate failed (fixes F-1) · `2` configuration error · `3` provider/runtime error (documented table in user docs).
- Non-critical stage failures record an error artifact and continue; critical ones abort after flush.
- Default logging is redaction-safe by construction (key-pattern drop of prompt/secret-like fields); content capture exists only as explicit observability opt-in (D11).

## 7. Publishing protocol (per integration)

Per PR, QualOps maintains **review state** (published fingerprints, thread IDs, resolution status), embedded as JSON in the summary comment and mirrored as an artifact.

Each run (incremental re-review):

1. Load prior state; compute the delta diff since the last reviewed SHA.
2. Re-anchor prior findings (FP-5).
3. Prior finding **fixed** (anchor gone or claim no longer holds — cheap verifier confirmation) → auto-resolve its thread with a "resolved in `<sha>`" note; **unfixed** → keep the thread, do not repost; **human-resolved** → stays resolved, fingerprint suppressed for this PR (the human wins).
4. Only fingerprints absent from state run the full pipeline; new admitted findings are published.
5. **Summary comment** updated in place: what was checked (tier, reviewers), found, auto-resolved, and — transparency panel — what was filtered per RejectReason ("3 suppressed by team feedback, 2 refuted by verification…").

Surfaces: **GitHub** — findings as a PR review with resolvable inline comments, fingerprint markers, and ```suggestion blocks for `mechanical` fix proposals; the Checks API carries the gate conclusion (replaces annotation-only posting, F-28). **GitLab** — resolvable discussions keyed by fingerprint marker (not `file:line`), dedup includes resolved discussions, auto-resolution implemented (fixes F-27).

## 8. Fix proposals

- Generated only for **admitted** findings where a mechanical fix exists; validated (parse/lint where available) before delivery.
- Delivery: integration ```suggestion blocks (one-click, author-facing). Larger fixes: on-demand via `@qualops fix <fingerprint>` (backlog) or local CLI `qualops fix` which retains apply/rollback machinery.
- Fix proposals never gate and are never counted as findings.

## 9. Learning loop

1. **Outcome capture** per published fingerprint: at each push and at PR close, diff-check the anchor — `addressed` | `ignored`; reactions, dismissive replies, and `@qualops remember <fact>` comments are recorded.
2. **Feedback memory**: embeddings of published findings + outcomes per repo/org (stored under `.qualops/memory/`); admission suppresses new findings cosine-similar to ≥N previously rejected ones. Suppressions are visible in the transparency panel.
3. **Learned rules**: distilled from replies/reactions/misses with a lifecycle `candidate → active → disabled` (auto-promotion/demotion on accumulated signal); each rule lands as a **PR adding a file** under `.qualops/rules/learned/` (D7).

## 10. Gate and reporting

- **Gate**: deterministic evaluation of admitted findings against `gate` config (maxCritical/maxHigh/…, severity floors, `baseline: true` → only fingerprints absent from the base-branch baseline count). Result drives the exit code and the integration check conclusion. Prose-dialect runs that cannot produce gateable findings report **"not gateable"** explicitly (fixes F-5) — never a silent pass.
- **Reporting**: renderers over the run record — markdown, HTML, JSON, **SARIF** (for code-scanning consumers). Root-cause extraction remains an optional report feature (config-gated — fixes the inert flags). Reports include cost, latency, tier, and the RejectReason funnel.

## 11. Auditability

- **Context ledger** per run: every context item considered → `included | skipped | truncated` + reason + byte counts.
- **Provenance** per finding: prompt hash, config hash, context ledger reference — eval regressions become attributable (prompt vs. model vs. context change).
- Artifacts are written once, by the runner, with a `schemaVersion`; an explicit `--resume <session>` reuses them (silent stale-reuse of F-6 is removed).
