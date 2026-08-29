> **Appendix — evidence/analysis record.** Kept as the factual basis for the spec; terminology and document references may predate the consolidation. Normative content lives in the spec documents (01–07); old references map as: 01→appendix A, 02→appendix B, 03→appendix C, 04/05/06→spec 02+06+07, 07→spec 05, 08→spec 03, 09→appendix D, 10→spec 04.

# 02 — State of the Art in AI PR Review (mid-2026)

Condensed research findings with sources. Full technique catalog in §3; product evidence in §2; literature in §4.

## 1. The industry consensus

By mid-2026, the leading tools have independently converged on the same pipeline shape:

> **Generate wide → verify adversarially → filter hard → post little.**

Shared architecture across CodeRabbit, Cursor Bugbot, Greptile, GitHub Copilot, Anthropic, Cloudflare, Ellipsis, cubic:

1. **Agentic context gathering** at review time (grep/glob/read tools over the repo), not one-shot diff prompting. GitHub moved Copilot review to agentic tool calling and later to plain CLI `grep`/`rg`/`glob` — cutting cost ~20% at equal quality.
2. **Many small specialist reviewers** run in parallel, merged by a coordinator — not one monolithic prompt.
3. **A separate verification/judge stage** that must *ground* each finding in evidence before posting — the single most load-bearing false-positive control in the industry.
4. **Severity/confidence gating + dedup** before posting; confidence must come from the **verifier**, not the generator.
5. **A feedback memory loop** (rules/embeddings from developer reactions and replies) suppressing recurring noise per team.
6. **Measurement by addressed/resolution rate** — did the author change the code — not comment volume.

Why it matters: Greptile measured that only ~19% of their own early comments were good, 2% wrong, 79% technically-true-but-ignored nits ([How to Make LLMs Shut Up](https://www.greptile.com/blog/make-llms-shut-up)). Field data: ~40% of AI review alerts are ignored in default configs; below ~10% FP rate developers investigate everything, above 10–30% the tool is labeled "noisy" and ignored wholesale.

## 2. Key product evidence

**Cursor Bugbot** ([Building a better Bugbot](https://cursor.com/blog/building-bugbot), [learned rules](https://cursor.com/blog/bugbot-learning)):
- **8 parallel review passes with randomized diff order, majority-voted** — findings appearing in only one pass are dropped (self-consistency over findings). A validator model then catches remaining FPs.
- Counterintuitive lesson: with voting + validation in place, use **aggressive** generation prompts ("investigate every suspicious pattern") — recall from generation, precision from verification.
- **Learned rules lifecycle**: rules auto-generated from downvotes, explanatory replies, and human reviewer comments the bot missed; candidate → active promotion on accumulated signal; auto-disabled on negative signal. 44k+ learned rules. Resolution rate 52% → 76%.
- Metrics: online = **resolution rate** (flagged code actually changed in merged result); offline = curated BugBench of real diffs with annotated bugs; 40 major experiments across 11 versions.

**Greptile** ([Make LLMs Shut Up](https://www.greptile.com/blog/make-llms-shut-up), [v4](https://www.greptile.com/blog/greptile-v4)):
- Documented **failures**: prompting "don't nitpick" failed; few-shot good/bad examples failed; **LLM self-rated severity (1–10, cutoff 7) was "nearly random"** — directly relevant to QualOps' current confidence gate.
- What worked: **embedding-based feedback suppression** — embed every past comment with upvote/downvote/addressed status; block new comments cosine-similar to repeatedly downvoted ones. Address rate 19% → 55%+ in two weeks. v4 (A/B over hundreds of thousands of PRs): addressed comments/PR +74%.

**CodeRabbit** ([architecture](https://docs.coderabbit.ai/overview/architecture), [context engineering](https://www.coderabbit.ai/blog/context-engineering-ai-code-reviews)):
- Multi-model pipeline with a **judge model that drops findings it cannot ground**.
- **Verification scripts**: the reviewer generates shell/`ast-grep` checks in a sandbox to confirm assumptions before commenting — executable evidence per finding.
- Codegraph (defs/refs + commit co-change) + embeddings index; targets 1:1 code-to-context ratio. 40+ deterministic linters/SAST woven in.
- **Learnings**: natural-language preference statements extracted from PR conversations, scoped per file/repo/org; argues natural-language explanations beat emoji feedback.

**Anthropic — Claude Code review** ([blog](https://claude.com/blog/code-review), [open-source plugin](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/README.md)):
- Parallel specialist agents; **agent count scales with PR size**; verification step filters FPs; severity ranking; one summary + few inline comments.
- **<1% of findings marked incorrect**; stays quiet on small clean PRs (31% of <50-line PRs get findings vs 84% of 1000+-line PRs).
- Plugin pattern directly reusable: five parallel reviewers, findings scored **0–100 confidence, only ≥80 posted**.
- Security action hard-excludes FP-prone categories (theoretical DoS, rate limiting, generic input validation without proven impact).

**Cloudflare internal system** (~48k MRs/month, [blog](https://blog.cloudflare.com/ai-code-review/)) — the most detailed public production writeup:
- **Risk-tiered reviews**: ≤10 lines → 2 agents/$0.20; ≤100 → 4 agents/$0.67; full → 7+ agents/$1.68; security-sensitive paths always force full review.
- Per-agent explicit **"What NOT to Flag"** sections; coordinator judge dedupes, re-categorizes, drops speculative findings; **approval-biased rubric** (only critical blocks).
- **Incremental re-review protocol**: feed the reviewer its previous review + prior comments with resolution state; fixed → omit + auto-resolve thread; unfixed → re-emit; never full re-review (prevents duplicates). Human-resolved threads stay resolved.
- Prompt-injection defense: strip boundary tags from all user-controlled PR text. Pre-filter lockfiles/minified/generated (never filter DB migrations). Per-file patch files for 85.7% prompt-cache hit rate. Break-glass override used on 0.6% of MRs.

**cubic** ([−51% false positives](https://www.cubic.dev/blog/learnings-from-building-ai-agents)):
1. **Force explicit reasoning before the finding** in structured output — biggest single win.
2. **Shrink the toolset** (removed tools used <10% of the time).
3. Micro-agents over monolith. Result: −51% FPs at equal recall; median comments per PR halved.

**Ellipsis** ([case study](https://www.zenml.io/llmops-database/building-and-deploying-production-llm-code-review-agents-architecture-and-best-practices)): filter chain = dedup → confidence threshold → **hallucination detection via required "Evidence" (linked code snippets; no evidence → dropped)** → comment editing. Deliberate model mixing (GPT + Claude simultaneously). Stance: async review means latency is cheap, accuracy is the product.

**Qodo / PR-Agent** ([compression strategy](https://qodo-merge-docs.qodo.ai/core-abilities/compression_strategy/)): reference design for budget-bounded single-call review (prioritized hunks, asymmetric context expansion, lockfile dropping); **1–5 review-effort label** per PR; ticket-compliance checking; the main open-source competitor.

## 3. Technique catalog, ranked by evidence of FP reduction

| # | Technique | Evidence |
|---|---|---|
| 1 | **Independent verifier with fresh context** (sees claim + code, *not* the generator's reasoning — "context asymmetry") | CodeRabbit judge; Anthropic <1% incorrect; Bugbot validator; Refute-or-Promote killed 63% of candidates at this stage |
| 2 | **Sampling + voting** (N parallel passes, randomized order, majority keep) | Bugbot 8 passes; SWRBench +43.67% F1 from aggregation; CodeX-Verify information-theoretic argument for decorrelated agents |
| 3 | **Embedding-similarity suppression vs. past rejected comments** (per team) | Greptile 19%→55% address rate; Ellipsis |
| 4 | **Required machine-checkable evidence per finding** (generated grep/ast-grep checks, linked snippets; ungroundable → dropped) | CodeRabbit scripts; Ellipsis Evidence; Refute-or-Promote (even 80 unanimous agents endorsed a nonexistent vuln until execution killed it) |
| 5 | **Confidence gate on the verifier's score** — never the generator's self-rating (proven near-random) | Anthropic plugin ≥80/100; Greptile negative result |
| 6 | **Learned-rules lifecycle from feedback** (candidate → active → auto-disable) | Bugbot 44k rules, 52→76% resolution; CodeRabbit Learnings |
| 7 | **Explicit "what NOT to flag" + hard category excludes** | Cloudflare; Anthropic security action; Bugbot category filters |
| 8 | **Reasoning-before-conclusion structured output** | cubic −51% FPs |
| 9 | **Specialist micro-agents + coordinator dedup** | universal convergence |
| 10 | **Deterministic tools own deterministic problems** (linters/SAST/types; LLM never re-flags what a linter owns) | Copilot + ESLint/CodeQL; CodeRabbit 40+ tools; LLM4PFA 86% FP-mitigation accuracy |
| 11 | **Diff hygiene pre-filtering** (lockfiles/minified/generated; never migrations) + PR compression | Cloudflare; Qodo |
| 12 | **Effort scaling / silence as a feature** (small clean PR ⇒ fewer agents, zero comments) | Anthropic size-scaled agent counts; Copilot silent on 29% of reviews; Cloudflare tiers |

**Documented anti-patterns** (tried, failed): polite "don't nitpick" prompting; few-shot good/bad comment examples; same-model self-severity rating; emoji-only feedback loops.

## 4. Research literature (2024–2026)

- **SWRBench** ([2509.01494](https://arxiv.org/abs/2509.01494)): 1,000 verified PRs, LLM evaluation ~90% human agreement; multi-review aggregation boosts F1 up to +43.67% without retraining.
- **Refute-or-Promote** ([2604.19049](https://arxiv.org/html/2604.19049)): adversarial stage-gated review — proposers, then refuters with kill mandates and context asymmetry, then cross-model critics (different model family catches correlated training-data errors), then **mandatory empirical confirmation**. 79% retrospective kill rate.
- **CodeX-Verify** ([2511.16708](https://arxiv.org/html/2511.16708v1)): information-theoretic proof that decorrelated multi-agent verification beats any single agent; 76.1% bug catch without execution.
- **CRScore** ([2409.19801](https://arxiv.org/html/2409.19801)): reference-free comment-quality metric (pseudo-references from change implications + static-analysis smells); Spearman 0.54 with humans, best open metric; BLEU/BERTScore near zero.
- **LLM4PFA-style FP mitigation** ([2411.03079](https://arxiv.org/html/2411.03079v2)): precise dependency-sliced context for judging static-analysis warnings → 86% accuracy.
- **MetaMateCR** ([2507.13499](https://arxiv.org/html/2507.13499v1)): show generated fix patches to the **author only** (showing to reviewers slowed reviews 5.5%); validate patches against linters/tests before offering.
- **VulAgent** ([2509.11523](https://arxiv.org/pdf/2509.11523)): hypothesis-validation pipeline consistently reduces FPs across model types.
- Benchmarks: **Martian Code Review Bench** (public leaderboard — 50 curated PRs + online tracking of which bot comments developers actually fix, across 200k+ OSS PRs; QualOps' CRB dataset is derived from the same source); AACR-Bench (multi-language repo-level); survey [2602.13377](https://arxiv.org/abs/2602.13377).

## 5. Metrics the best teams use

**Online (north-star):**
- **Addressed / resolution rate** — % of bot comments where the flagged code changed before merge; measured automatically by diffing the flagged range at merge time. (Greptile 30→43%, Bugbot 52→76%.)
- Suggestion-acceptance rate (one-click applies); positive/negative reply rate; marked-incorrect rate (Anthropic <1%); **comments per PR as a cost**; **silence rate on clean PRs**; override usage.

**Offline:**
- Curated real-bug benchmarks (bug-introducing commits from real fix PRs); precision/recall/F1 on a **single consistent contingency table**; CRScore for reference-free comment quality; clean-PR negative sets for spurious-finding rate.

**Trust thresholds:** <10% FP → developers investigate everything; 10–30% → "noisy" label; >30% → ignored wholesale.
