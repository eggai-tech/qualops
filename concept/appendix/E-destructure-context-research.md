# Appendix E — Destructure, Context & Cost Research

**Status:** Evidence appendix (2026-07-09) · Supports 02 §3.1–3.4, D13, D14. Method: four parallel research passes — (1) PR/commit-decomposition & change-impact SOTA (web, primary sources, 8 load-bearing claims adversarially fact-checked, 7/8 confirmed), (2) hybrid deterministic+LLM pipeline evidence (web, primary sources), (3) deep code-read of the `codereviewer` spike's deterministic machinery, (4) mapping against this concept's own decisions/gaps. Unverifiable claims are flagged; vendor self-reports are marked as marketing.

## §1 — The design question

Destructure a PR into logical changes, give each reviewer exactly the context it needs, keep findings in-PR-scope, keep precision high — using deterministic methods wherever they beat an LLM, and bounded tokens/latency. The concept had fully decided the *downstream* (filters, verification, admission — 02 §3.3–3.5) but carried only one sentence of *upstream* mechanism ("related files are clustered by import graph"). This appendix records the evidence behind the upstream design now specified in 02 §3.1.

## §2 — PR decomposition & impact analysis (SOTA)

**Commit untangling.** Rigorous work (SmartCommit FSE'21, ClusterChanges, Flexeme FSE'20, UTango FSE'22, HD-GNN 2024) solves *single-commit* hunk untangling via dependence graphs (def-use hard edges, co-location/refactoring soft edges) + graph partitioning. Accuracy: **~70–85% ceiling for pure-graph methods** (SmartCommit 71–83.5%; Flexeme ≈0.81). The 2025–26 escape from that ceiling is **LLM-on-top-of-graph** — ColaUntangle (arXiv 2507.16395: +44%/+82% rel. over best baseline) and Atomizer (arXiv 2601.01233, ICSE'26: static "minimal change subgraphs" preprocessed, LLM agents adjudicate) — *never* LLM-instead-of-graph (pure prompting underperforms graph clustering on full decomposition). No off-the-shelf JS/TS library exists; UTango is open source but C#/Java.

**Change classification** (signature vs body vs comment vs format-only): **no maintained tool ships these labels.** They are built on GumTree-style AST edit scripts (insert/delete reliable; **move/update documented-unreliable** — >81% inaccurate in one corpus) by pattern-matching node types. difftastic/diffsitter render for humans only, no structured output; SemanticDiff is closed. → 02 §3.1b's conservative "unclear = logic-change" default.

**Impact analysis practical for a cold-start Node CLI (no index build):** TS LanguageService `findReferences` + dependency-cruiser/madge (TS/JS), PyCG (~0.38s/kLoC, known recall gaps on dynamic code), `go/callgraph` (Go), tree-sitter symbol graph as the polyglot floor, ast-grep as a structural-pattern complement. **Excluded:** CodeQL (DB build minutes+, license-gated on private code), SCIP/LSIF (compile-equivalent build time), Joern/Glean (service/JVM setup), **GitHub stack-graphs — archived Sept 2025, dead** (verified 3/3).

**Context packing.** The most transferable deterministic mechanism is **aider's repo-map**: tree-sitter def/ref tags → graph → **personalized PageRank** (seeded, for a reviewer, from the diff's changed symbols) → token-budget selection via binary search. No embeddings, no model call, explainable, scales with PR size. Industry corroboration: Sourcegraph Cody moved *away* from embeddings toward deterministic search/code-intel.

**Vendor reality:** of five commercial reviewers, only Qodo/PR-Agent's context mechanism is open/auditable (deterministic patch compression: asymmetric expansion, deletion-stripping, token-sorted packing, hard budget). Cursor BugBot is diff-scoped-only with a documented deterministic traversal — the most restrained design. CodeRabbit's "code graph"/Copilot's "semantic relevance" are unverifiable black boxes; Greptile's 82% self-benchmark is vendor-authored (an independent re-run on the same repos reportedly got ~45%).

## §3 — Hybrid deterministic+LLM evidence (division of labor)

The best-supported architecture across all evidence: **deterministic candidates/slices → LLM bounded to classify/verify.** Key results (primary sources, verified):

| Evidence | Result |
|---|---|
| LLM4PFA (arXiv 2506.10322) | LLM + path-feasibility filtering kills **72–96% of static-analyzer FPs** (class-dependent) at 0.93 recall |
| LLM4FPM (arXiv 2411.03079) | LLM + **deterministic code slice** (eCPG): removing the slicer *drops* F1 (98.9→97.2) and causes context-overflow failures; ~$0.384/warning. **The slice beats exploration.** |
| Tencent industrial study (arXiv 2601.18844) | Two-stage LLM classify+verify over real SAST alarms: 76% FP-rate → precision 0.93–0.98 at **$0.0011–$0.12 and 2–110s per finding** (vs 10–20 min manual) |
| QASecClaw (arXiv 2605.01885) | LLM filter over Semgrep: FPs **560→64** (−88.6%) at 3.1% recall cost |
| **Agentless** (arXiv 2407.01489) | Fixed localize→repair→validate pipeline: **32% @ $0.70/issue** vs agentic AutoCodeRover **19% @ $0.43** — no agent loop, better accuracy; swapping to a stronger model lifted the *same* pipeline to 50.8% (architecture outlives the model) |
| RARe (arXiv 2511.05302) | Retrieval for review-comment generation **peaks at top-1**; more retrieved context *degrades* quality — small precise slices, not dumps |
| Self-consistency (arXiv 2511.00751) | Majority voting on strong models: **+0.4–1.6% accuracy for ~linear cost** — skip by default; reserve for identified hard cases (SWR-Bench's 10× aggregation +43.67% rel. F1 is real but ~10× cost) |
| Self-repair (arXiv 2604.10508) | Deterministic-feedback repair loops: diminishing returns after **~2 rounds** |
| SWE-bench correctness audit (arXiv 2503.15223) | **7–11% of test-passing patches are still wrong** — deterministic gates are filters, not correctness proofs |
| Deterministic scope/baseline filters | Load-bearing in every production tool: reviewdog `-filter-mode=added`, golangci-lint `--new-from-rev`, SonarQube reference-branch, DeepSource issue diffing, Codacy created-vs-potential, GitHub SARIF `partialFingerprints` |

**Cost mechanics (verified from vendor pricing pages, 2026-07):** prompt-cache **read = 0.1×** input price (Anthropic & OpenAI; write 1.25×/5-min TTL — repaid after one reuse); **batch API = 0.5×** flat, stacks with cache (≈**0.05×** combined, arithmetic); Cloudflare documents an **85.7% cache-hit rate** from stable-preamble prompt layout, and GitHub Copilot cut ~20% cost moving from bespoke tools to plain grep-style retrieval.

## §4 — Cost playbook adopted into 02

1. Zero-token stages first: hygiene → classification → grouping → impact → packing (02 §3.1) before any LLM call.
2. `format-only`/`comment-only` units never reach an LLM (02 §3.1b).
3. Small deterministic slices over exploration or bulk retrieval (02 §3.1f, §3.4).
4. Cache-aware prompt layout: stable repo preamble first (02 §3.1f).
5. Verification via batch + shared cache ≈0.05× list price (02 §3.4).
6. No sampling by default (already 02 §3.2); self-repair capped (already F-16's single retry).
7. Fingerprint dedup prevents re-verifying across runs (02 §2, §7).

## §5 — The spike's deterministic machinery (code-verified)

Deep-read of `codereviewer` (the D8 reference design). Mechanisms adopted into 02 §3.1 with their measured shape:

- **Task clustering**: import-fact connected components, **≤8 files/cluster**, singleton packing (`task-planner.ts`). File-level only — no hunk grouping, no change classification (both are net-new in 02 §3.1b/c).
- **Referenced-definition digests**: relative-import resolution (**one hop, TS/JS only** — 02 §3.1e generalizes and adds the *caller* direction), frequency-ranked **top-6 files**, anchor-window (±1 line) digests, **4KB/file, ~12KB total**, labeled "context only — never a review target."
- **Priority-ladder packet budget**: drop named optional fields one at a time in fixed order, then **throw a typed error — never silently truncate source** ("split the review scope or increase the budget").
- **Zero-token rejects**: candidate-scope check *before* any refutation call; severity floor with a trusted-rule bypass lane (its rule templates were emptied after being judged **eval-gaming** — a standing warning for any trusted-rule allowlist).
- **Provider-error → `needs-more-evidence`/recovered**, artifact-only routing — never a crash.
- **Probe evidence (verbatim, in-code):** *"the input shape that let whole-file holistic review out-recall the gauntlet in probes; burying the source inside a structured packet dilutes whole-file reasoning"*; competitive-analysis doc: *"Single pass (2-pass tested, hurt precision, reverted)"*; self-assessed ceiling: *"broader context — whole-repo/cross-file understanding is the structural capability the higher-recall tools have and we don't"* (→ exactly what 02 §3.1e/f's caller-direction impact sets + PageRank packs address).
- **Cautionary findings:** its spec still describes the reverted 2-pass design (spec/code drift — the failure mode our CLAUDE.md exists to prevent); "contradiction signals" exist only as schema enums, never implemented; a complete agentic context-retrieval module sits dead/unwired — superseded by the deterministic digests.

## §6 — Honest limits (what this design does NOT claim)

- **PR-level decomposition is our hypothesis, not adopted science.** The validated bricks are commit-level; composing them for multi-commit PRs (aggregate diff + commit-affinity soft edges) has no published accuracy number. Hence: file-level v1, residual-unit fallback, eval-gated promotion (07-backlog), and no imported accuracy claims.
- **Deterministic retrieval has a recall ceiling** — evidence reachable only through dynamic dispatch, reflection, or config indirection is invisible to static walks. That is precisely the agent-mode escalation lane (D13), not a reason to default to agent loops.
- **Grouping/classification errors are contained by construction**: worst case is slightly mis-scoped context; nothing is dropped (residual unit) and nothing is down-classified silently (conservative defaults).
- Numeric per-tier budget targets remain unset (only Cloudflare's $0.20/$0.67/$1.68 tiers exist as external reference); to be calibrated from our own eval cost data, not invented.
