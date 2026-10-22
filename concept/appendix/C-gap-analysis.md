> **Appendix — evidence/analysis record.** Kept as the factual basis for the spec; terminology and document references may predate the consolidation. Normative content lives in the spec documents (01–07); old references map as: 01→appendix A, 02→appendix B, 03→appendix C, 04/05/06→spec 02+06+07, 07→spec 05, 08→spec 03, 09→appendix D, 10→spec 04.

# 03 — Gap Analysis: QualOps vs. State of the Art

Each row maps an industry-proven technique (02 §3) to QualOps' current state (01) and a verdict. F-numbers reference the defect inventory in 01.

## 1. The scorecard

| SOTA technique | QualOps today | Gap |
|---|---|---|
| 1. Independent verifier, fresh context, evidence required | LLM **self**-validation pass: same model, same framing, batched, no evidence requirement (F-10). Prompt for it has drifted from its schema (F-21) | 🔴 **Missing** — highest-leverage gap |
| 2. Sampling + voting across passes | Single pass per job; passes exist as a config concept but are topic-splits, not agreement voting | 🔴 Missing |
| 3. Embedding suppression vs. past rejected comments | No feedback capture at all; no memory of posted findings or their outcomes | 🔴 Missing (blocked by F-9: no stable identity) |
| 4. Machine-checkable evidence per finding | None. No citation check that the flagged line even contains the referenced code (F-11) | 🔴 Missing |
| 5. Confidence gate on **verifier** score | Confidence gate exists but on **generator self-rating** — the pattern Greptile measured as near-random. Also hardcoded ≥7 in agentic path ignoring config (F-13) | 🟠 Wrong signal source |
| 6. Learned rules lifecycle | None | 🔴 Missing (feature proposal) |
| 7. "What NOT to flag" + category excludes | ✅ Present and good in prompts (threat-model gate, NOT-to-flag lists). But **prompt-only** — no programmatic category exclusion | 🟡 Partial |
| 8. Reasoning-before-conclusion output | Schema has `reasoning`/`context` fields, but field ordering isn't enforced as reason-first; prompt drift (F-22) muddies it | 🟡 Partial |
| 9. Specialist micro-agents + coordinator | ✅ Agentic mode has 4 subagents + custom agents. But default config runs only a security audit; no coordinator dedup across agents; file-by-file mode is monolithic per file | 🟡 Partial |
| 10. Deterministic tools own deterministic problems | No linter/SAST integration. Fix stage even special-cases `[ESLint]`-prefixed issues, implying an integration existed and was removed | 🔴 Missing |
| 11. Diff hygiene + PR compression | `skipPatterns`/`maxFileSizeKB` exist; agentic prompt-builder token-budgets files. No lockfile/generated heuristics with migration exemption; file-by-file mode sends whole files with no compression | 🟡 Partial |
| 12. Effort tiering / silence as a feature | None — same pipeline regardless of PR size; judge scorer actually *punishes* empty output (F-29) | 🔴 Missing |
| Incremental re-review with resolution memory | None — every run reviews from scratch; GitLab re-spams resolved-unfixed findings (F-27); GitHub annotations are ephemeral (F-28) | 🔴 Missing |
| Suggestion blocks / one-click fixes | Fix stage generates patches but applies them locally/CI-side; nothing posted as GitHub ```suggestion blocks | 🟠 Missing surface |
| Addressed-rate instrumentation | Nothing. No record of what was posted, no merge-time check | 🔴 Missing (blocked by F-9) |
| Prompt-injection defense on PR text | Agentic bash sandbox is strong, but PR titles/bodies/comments are not sanitized before prompt assembly | 🟠 Missing |
| Offline eval: precision + clean-PR negatives | Recall well measured (CRB, 50 PRs, semantic judge). Precision only as a flawed CRB proxy (F-29); native set n=3; no clean-PR set; posting behavior unevaluated (F-30) | 🔴 Half-blind |

## 2. Where QualOps is already at or ahead of the state of the art

Worth stating clearly, because the concept must not regress these:

- **Structured-output dialect handling** (capability catalog + five strategies + prose fallback) is broader than any competitor's published approach — most tools support one or two providers; QualOps degrades gracefully across the whole OpenAI-compatible ecosystem.
- **Sandboxed agentic tooling** (policy-engined bash, env scrubbing, secret redaction, no SDK built-ins that bypass skip patterns) is more careful than most public implementations.
- **Eval infrastructure shape** (Langfuse experiments, preset A/B configs, slice capture from real misses) matches what Graphite/Braintrust describe — the gap is *what* is measured, not *how*.
- **Multi-provider by design** — an underexploited asset: cross-model verification (technique #2/#1) is *stronger* with decorrelated model families, and QualOps already has the provider plumbing that single-vendor competitors lack.

## 3. Root-cause reading of the gaps

The 18 rows above collapse into four root causes:

1. **No stable finding identity (F-9).** Blocks: cross-run dedup, update-in-place, auto-resolution, drift tolerance, feedback memory, addressed-rate. One fix unblocks six capabilities.
2. **Precision was never a first-class objective.** The pipeline optimizes recall (aggressive generation is fine!) but every precision mechanism is an LLM opinion without independence, evidence, or measurement. Verification stage + eval realignment fix this.
3. **The posting layer treats each run as the first run.** No memory of prior comments' content or resolution state → the noise loop on GitLab, the ephemerality on GitHub.
4. **The CI contract is unfinished.** Gate not configurable via config, exit code not wired, prose path exempt, telemetry lost on failure. Small fixes, but they define whether "reliable" is true.

## 4. Prioritization logic

```
Impact on "reliable, non-polluting review"
  ▲
  │  P2 Verification stage          P1 Stable identity
  │  (kills FPs before posting)     (kills duplicate/stale spam)
  │
  │  P3 Posting protocol            P0 Correctness fixes
  │  (incremental re-review,        (gate, exit codes, metric bugs —
  │   auto-resolve)                  cheap, restore trust in the tool)
  │
  │  P4 Feedback memory / tiering   Eval realignment
  │  (compounding, needs P1+P3       (parallel track, gates P2–P4
  │   data to learn from)            claims with evidence)
  └────────────────────────────────────────────▶ Effort
```

Sequencing rationale: P0 is days of work and removes contract-breaking bugs. P1 (fingerprint identity) is the enabling substrate for everything else and should land before the posting protocol. P2 is the biggest quality jump and is independent of P1 (can run concurrently). Eval realignment starts immediately so that P2's effect is *measured*, not asserted.
