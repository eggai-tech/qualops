# 03 — Tool-Calling, Trajectory, and Workflow-Agent Evaluation

*Research dossier for the QualOps internal report. Compiled May 8, 2026.*

## Executive Summary

QualOps is a workflow / tool-calling agent (Analyze → Review → Fix → Report → Judge) built on the Claude Agent SDK. It does not chat — it reads files, runs greps, spawns subagents, hits APIs, and emits structured findings. Evaluating it well therefore requires a *trajectory-aware* and *outcome-aware* evaluation stack, not chatbot-style scoring. The dominant techniques in 2024–2026 fall into five families: (1) **tool-call accuracy** (AST/exec/argument-F1, à la BFCL); (2) **trajectory metrics** (exact-match, in-order, any-order, edit distance, step success rate); (3) **outcome-grounded evaluation** in sandboxed worlds (τ-bench, AppWorld, WebArena, SWE-bench, MLAgentBench); (4) **agent-as-judge** for open-ended artifacts where unit tests don't exist; and (5) **replay/recorded-trace regression** plus pass^k reliability under non-determinism. For a code-review agent the most directly transferable patterns are SWE-bench-style execution-based grading on patches, AppWorld-style state-based scoring of side effects, BFCL-style tool-call AST checks on the structured PR-comment JSON, recorded-trace replay tied to real PRs, and an agent-as-judge for the qualitative "is this review good?" question. This dossier expands each of these, surveys the major benchmarks, and ends with a decision guide mapping QualOps's pipeline stages to specific eval techniques.

---

## 1. What "Tool-Call Accuracy" Actually Means

"Tool-call accuracy" is a deceptively flat label. In practice it decomposes into a stack of sub-metrics, each measuring a different failure mode. Treat them as orthogonal axes and report all of them — a single scalar will mask the bug you actually care about.

### 1.1 Exact match vs. semantic match
The simplest score: did the agent emit a tool call whose name + JSON argument blob equals the gold reference, byte-for-byte? This is brittle: `{"path": "src/foo.py"}` vs. `{"path": "./src/foo.py"}` are equivalent but exact-match scores them as wrong. **AST match** (BFCL's term) parses the call into name + (arg-name, arg-value) pairs and matches structurally, allowing argument-order independence and basic type/format normalization. **Semantic match** goes further: an LLM judge or a custom equality function decides whether two argument values are functionally identical (e.g. `"src/foo.py"` ≡ `"./src/foo.py"` ≡ absolute path of same file).

### 1.2 Argument F1
For a single call with multiple arguments you can score arguments individually:
- **parameter-name F1**: did the agent pick the right parameter names?
- **parameter-value F1 / accuracy**: given the right name, is the value right?

Frameworks like Ragas, DeepEval (`ArgumentCorrectnessMetric`), and LangChain trajectory evals all expose this granularity. It matters when partial credit is meaningful — e.g. the agent called `grep` with the right `pattern` but wrong `path`; you want to know whether the model is failing at *tool selection* or *argument extraction*.

### 1.3 Multi-call ordering
Many tasks require an ordered sequence (login → list → write). Possible scoring rules, in increasing leniency:
- **Trajectory exact match**: identical sequence, identical arguments.
- **In-order match**: the predicted trajectory contains the reference sequence as a (possibly non-contiguous) subsequence; extra calls allowed.
- **Any-order match**: predicted trajectory contains the reference set; order doesn't matter.
- **Edit distance / Levenshtein over tool-call sequences**: continuous score reflecting how far off the trajectory is.

These are codified in Google Cloud's Vertex AI agent eval, LangChain's LangSmith trajectory evals, and AWS Strands. Pick the strictest mode the domain allows; for QualOps, ordering matters between Analyze→Review but is irrelevant within the parallel grep calls of a single phase.

### 1.4 Partial credit
For a 12-step trajectory, a binary pass/fail loses signal. Partial credit comes from:
- **Step success rate**: fraction of individual steps that executed without error and matched the expected step type.
- **Plan precision/recall**: precision = (predicted steps that appear in reference) / (predicted steps); recall = (reference steps that appear in predicted) / (reference). F1 is their harmonic mean. This is the basis for Ragas's `ToolCallF1`.
- **Optimal path ratio**: actual steps / minimal-known steps. > 1 means the agent took detours.

### 1.5 Idempotency
Some tools have side effects (write file, post comment, call a credit-card API). Evaluation must distinguish *first call* from *redundant repeat call*. AppWorld's state-based scoring penalizes "collateral damage" — unintended state changes — explicitly; this catches an agent that re-sends the same PR comment three times or double-posts findings.

### 1.6 Parallel calls
Agents (and Claude in particular) can emit multiple tool calls in one turn. Scorers must handle a *bag* of tool calls per turn, not a list. The BFCL "parallel" and "parallel-multiple" categories test exactly this: was the right *set* produced regardless of order within the bag?

### 1.7 Hallucinated tools
The agent invents a tool that doesn't exist (`run_pylint_v2`, when only `run_pylint` is registered) or invents arguments (`--strict-mode` when there's no such flag). This shows up as: tool-name mismatch against the registry, schema-validation failure on arguments, or an `executable accuracy = 0` outcome. BFCL has a dedicated **irrelevance / relevance detection** category specifically to penalize models that fabricate calls when none was needed.

### 1.8 Missed tools
The flip side: the model should have called a tool but didn't, answering from its own (often outdated) knowledge instead. Recall is the natural metric. In eval frameworks this is "under-tooling"; production teams (Sierra, Anthropic's blog) flag it as one of the top failure modes for production agents because it produces confident-looking wrong answers with no trace to debug.

---

## 2. Trajectory / Plan Evaluation

A trajectory is the ordered record of (thought, action, observation) triples (or just (action, observation) if you don't expose CoT). Evaluating it answers two distinct questions:

**Q1 — Did the agent get to the goal?** (outcome / goal-completion).
**Q2 — Did it follow a sensible path?** (process / plan quality).

These are orthogonal: an agent can stumble to the right answer through a 47-step random walk, or it can take an optimal 3-step path that ends in the wrong final state.

### 2.1 Step-wise correctness
For each step *i* in the predicted trajectory, score whether step *i* (a) matches the corresponding reference step type, (b) used a sensible tool, (c) used valid arguments. Aggregating gives a **step success rate**.

### 2.2 Plan-level precision and recall over expected steps
Treat the reference trajectory as a *set* (or *multiset*) of expected steps. Compute:
- precision = |predicted ∩ reference| / |predicted|
- recall = |predicted ∩ reference| / |reference|
- F1 as usual.

This is the "any-order" view; tighter variants impose order-aware matching with bipartite alignment.

### 2.3 Edit distance over trajectories
Treat both trajectories as strings of tool tokens and compute Levenshtein distance, optionally weighted by argument-similarity. Yields a continuous score that reflects "how far off" rather than binary right/wrong. Useful for regression dashboards.

### 2.4 Goal-conditional vs. path-conditional
- **Goal completion rate** (a.k.a. task success rate): pure outcome. Did the final state / final artifact match the spec?
- **Optimal-path-conformance**: did it follow the canonical path? Two agents can both hit GCR=1 yet differ wildly in cost, latency, and safety.

The Sierra / τ-bench position is explicit: in production they care primarily about **goal database state** — they compare the post-conversation DB to an annotated goal DB and call it a day. Cursor's `CursorBench` flips this: they care about path quality (code style, efficiency, interaction) too because users *experience* the path.

### 2.5 Convergence
Fraction of runs that reach a satisfactory terminal state without manual intervention or hitting a turn-budget cap. A separate signal from success: an agent that gets to the answer 80% of the time but loops 20% of the time is operationally distinct from one that gets there 80% and cleanly fails 20%.

---

## 3. Outcome vs. Process Evaluation

### 3.1 The trade-off
| Aspect | Outcome eval | Process eval |
| --- | --- | --- |
| Data needed | A goal-state checker (unit test, DB diff, regex on output). | Reference trajectories (expensive to author) or a judge model. |
| Scaling | Cheap and deterministic. | Expensive (many references) or noisy (judge variance). |
| Catches "lucky shortcuts" | No — agent can game it. | Yes. |
| Catches plan inefficiency | No. | Yes. |
| Penalizes equivalent-but-different paths | No (good). | Yes (bad — risks rewarding rote imitation). |

### 3.2 When to use each
- **Outcome only**: when the goal is fully and cheaply specifiable (compile, pass tests, DB matches). SWE-bench, MLE-bench, τ-bench, AppWorld all rely heavily on this.
- **Process only**: when there is no ground-truth artifact (open-ended writing, exploratory research). Agent-as-judge thrives here.
- **Hybrid**: production reality. Use outcome for the gate (must pass) and process metrics for diagnostics and ranking when outcomes are roughly equal.

### 3.3 Pitfalls of pure outcome
- **Reward hacking via lucky shortcut**: An agent finds a single-line trick that passes the FAIL_TO_PASS test but doesn't actually fix the bug class. SWE-bench Verified mitigates this by also requiring PASS_TO_PASS — i.e. nothing that previously passed should break.
- **Spec ambiguity**: the goal-state check is wrong or under-specified, so the agent gets credit for the wrong reason. (See SWE-bench → SWE-bench Verified — OpenAI annotators rejected ~30% of original SWE-bench instances for ambiguous specs or wrong test patches.)
- **Non-reproducibility**: stochastic tools (a flaky web page) make the goal-state non-deterministic.

### 3.4 Pitfalls of pure process
- **Path rigidity**: penalizing a faster, equivalent path. Anthropic's eval blog calls this out as the most common pitfall they see.
- **Reference-trajectory bias**: human authors write idealized trajectories that don't reflect how an LLM actually thinks; comparing against them rewards mimicry over capability.

---

## 4. Major Benchmarks for Tool-Calling and Workflow Agents

A reference table is at the end of the section. Detailed methodology + criticism follows.

### 4.1 Berkeley Function-Calling Leaderboard (BFCL)
- **v1 (Feb 2024)**: 2,000+ Q/A pairs across Java, JS, Python. Evaluates **AST accuracy** (parse the predicted call, check name + arg-name + arg-type match against gold) and **executable accuracy** (run the call in a sandbox; check return value or HTTP response). Categories: simple, multiple, parallel, parallel-multiple, REST, irrelevance.
- **v2 (Aug 2024)**: live, user-contributed, real-world functions; addresses contamination/freshness criticism.
- **v3 (Sep 2024)**: adds **multi-turn** and **multi-step** function calling. Replaces parameter AST matching for these tasks with **state-based and response-based evaluation** — i.e. after the model executes its sequence, the actual API system state (e.g. file system, mock CRM) is compared to ground truth. This is a meaningful methodological shift: BFCL v3 effectively becomes an outcome-eval for trajectory tasks. Datasets are hand-curated (API codebase → graph edges → tasks → human-labeled trajectories).
- **v4 (2025)**: ongoing, broader API surface and additional categories.
- **Known criticisms**: (a) AST match can disagree with semantic equivalence (Databricks's "Beyond the Leaderboard" post); (b) the multi-turn slice is small; (c) evaluation prompts deliberately avoid ReAct/CoT scaffolds, so leaderboard rank may not predict harness performance.

### 4.2 τ-bench / τ²-bench / τ³-bench (Sierra)
- **Setup**: A simulated user (LLM-driven) chats with the agent over many turns. Agent has access to a small set of domain APIs (retail and airline domains in v1) plus a written policy document. Tasks are scenarios with an annotated goal database state.
- **Eval**: post-conversation DB compared to goal DB. Plus a **pass^k** metric — probability the agent succeeds *k* times in a row, exposing reliability/variance.
- **Findings (June 2024)**: GPT-4o solves <50% of retail; pass^8 in retail is <25% — i.e. consistency, not headline accuracy, is the bottleneck.
- **τ²-bench**: adds telecom domain, dual-control (user must take actions too), more realistic policies.
- **τ³-bench (2025)**: adds knowledge retrieval and voice modality.
- **Why it matters for QualOps**: pass^k methodology directly transfers — for a code-review agent, "did it produce the same finding 8 times in a row?" is a more honest measure than a single run.

### 4.3 ToolBench / ToolLLM (OpenBMB)
- **Construction**: 16,464 RapidAPI APIs across 49 categories, ~120K instruction–API training/eval pairs. Three evaluation splits: I1 (single-tool), I2 (intra-category multi-tool), I3 (cross-collection multi-tool).
- **Solution paths**: annotated via DFSDT (depth-first search decision tree) over the API graph.
- **Evaluator**: ToolEval, an LLM-as-judge that scores both pass-rate and "win-rate" of one model against another.
- **Criticism**: API instability — many RapidAPI endpoints went stale or paywalled; Tsinghua/Alibaba's StableToolBench paper (ACL 2024) addresses this with mocked APIs and stable evaluation.
- **Note**: confusingly there are two unrelated "ToolBench" projects — OpenBMB's (the major one) and SambaNova's earlier eval suite.

### 4.4 API-Bank
- **Scope**: 73 APIs, 314 tool-use dialogues, 753 annotated API calls.
- **Evaluation**: runnable — calls are dispatched to mocked or real APIs and outputs scored.
- **Levels**: tests (1) ability to call APIs given relevance, (2) ability to retrieve the right API from a registry, (3) ability to plan multi-step calls.
- **Why it matters**: smaller and more curated than ToolBench, easier to mine for test cases.

### 4.5 WebArena / VisualWebArena / WorkArena
- **WebArena (Carnegie Mellon, Aug 2023)**: full-stack reproducible mock websites (e-commerce, GitLab, Reddit-clone, content management). Tasks are end-to-end user goals; evaluation compares final DB / UI state to a programmatic checker. GPT-4 baseline 14.4%; humans 78.2%.
- **VisualWebArena (2024)**: 910 tasks requiring visual understanding (image search, visual product matching).
- **WorkArena / WorkArena++ (ServiceNow)**: 33–682 enterprise SaaS tasks (ServiceNow ticketing, knowledge management). WorkArena++ adds compositional / verification tasks.
- **WebArena-Verified (ServiceNow, 2025)**: cleaned subset addressing the original benchmark's ambiguous-task problem.
- **Relevance to QualOps**: low — QualOps doesn't drive a browser. But the *evaluation methodology* (declarative goal-state checkers, programmatic + LLM-judge hybrids) is fully transferable.

### 4.6 AgentBench (THUDM, ICLR 2024)
- **Eight environments**: OS (bash), DB (SQL), KG (knowledge graph), digital card game, lateral thinking puzzles, house-holding (ALFWorld), web shopping, web browsing (Mind2Web).
- **Metrics**: success rate per environment + an aggregated score; F1 / reward where appropriate.
- **Architecture**: server-client + Docker, so each task runs in an isolated container.
- **Use as a template**: AgentBench is less a leaderboard (somewhat dated) and more a *reference architecture* for how to spin up many environments behind a uniform agent-side API.

### 4.7 GAIA (Meta, 2023)
- **466 hand-crafted general-assistant questions**, three difficulty levels. Each has a unique factual answer (string/number) so grading is exact-match string comparison — robust and cheap.
- **Tools used**: web browsing, file inspection, multimodal.
- **Headline gap**: humans 92%, GPT-4 + plugins 15% (at launch). 2025 frontier agents (e.g. H2O.ai's h2oGPTe) hit 65–75% on the dev set.
- **Why it matters**: shows you can get rigorous outcome eval out of *general* tasks if every answer is a checkable string.

### 4.8 SWE-bench family — the most relevant for QualOps
- **SWE-bench (Princeton, 2023)**: 2,294 GitHub issue + PR pairs from 12 popular Python repos. Agent receives issue text + a snapshot of the repo. Submits a patch. Patch is applied and the repo's test suite is run with two test sets: **FAIL_TO_PASS** (the tests added by the original PR — must now pass) and **PASS_TO_PASS** (existing tests — must still pass). Resolves-issue rate is the headline metric. This is **execution-based, outcome-only, deterministic, and forgiving of any path** — the gold standard pattern for code-agent eval.
- **SWE-bench Lite (2024)**: 300 instances filtered for shorter, more contained patches. The fast-feedback subset most groups iterate on.
- **SWE-bench Verified (OpenAI, Aug 2024)**: 500 instances, human-validated for clear specs and correct hidden test sets. Has effectively replaced the original full set as the headline benchmark — most leaderboards quote Verified.
- **SWE-bench Multimodal (2024)**: front-end / JS issues with screenshots; eval is **kept private** to prevent contamination.
- **SWE-bench Multilingual (2025)**: 300 tasks across 9 languages.
- **SWE-bench Live (2025–2026)**: rolling release of 50 newly-verified issues per month, scraped from active repos. Directly addresses contamination — frontier models can't have seen the test set during training.
- **SWE-bench Pro (Scale AI, Sep 2025)**: 1,865 instances (731 public + 858 held-out + 276 commercial), 41 repos including enterprise codebases. Patches are larger (avg 107 lines, 4.1 files) and tasks are long-horizon. GPT-5 23.3%, Claude Opus 4.1 23.1% at launch — i.e. enterprise-scale code-agent tasks remain hard.
- **Criticism / mutation work**: the "Saving SWE-Bench" paper (Oct 2025) proposes systematic mutation of test cases to detect lucky-shortcut hacks; recommended reading if QualOps wants to harden its own eval.
- **Direct relevance to QualOps**: the SWE-bench harness — clone repo, apply agent's patch, run tests, classify by FAIL_TO_PASS / PASS_TO_PASS — is **the** template for evaluating the Fix stage of QualOps. Recommendation: mine SWE-bench Verified for cases where the original PR was a code-quality fix (refactor, lint cleanup, type fix) and use those as QualOps regression tests.

### 4.9 MLAgentBench / MLE-bench
- **MLAgentBench (Stanford, 2023)**: 13 ML experimentation tasks; agent acts via a ReAct loop with read/write/execute. Outcome metric: improvement over a baseline model on a held-out set.
- **MLE-bench (OpenAI, Oct 2024)**: 75 Kaggle competitions; agent must produce a submission CSV. Outcome metric: medal-level performance against the human Kaggle leaderboard.
- **Pattern of interest**: agents act in a real shell with real Python; eval is purely outcome-based on a held-out scorer. This is the "give the agent a sandbox and grade what comes out" pattern par excellence.

### 4.10 AppWorld (Stony Brook, ACL 2024 best resource paper)
- **Engine**: 9 simulated apps (Venmo, Spotify, Gmail, etc.) with 457 APIs and 100 fictional users; 60K LoC environment, 40K LoC benchmark.
- **Tasks**: 750 natural-language tasks (e.g. "split last weekend's Venmo charges with my roommates").
- **Eval**: **state-based unit tests** — checks both that the goal state is reached *and* that no unintended state changed (collateral damage). MCP-compatible as of 2025.
- **GPT-4o**: ~49% normal, ~30% challenge.
- **Why it matters**: the cleanest available demonstration of state-based programmatic eval for tool-calling agents, including idempotency / collateral-damage checks.

### 4.11 Other 2025–2026 releases worth knowing
- **TRAJECT-Bench (2025)**: focuses on trajectory-quality metrics rather than just outcomes.
- **WABER (Microsoft Research, 2025)**: web-agent reliability/efficiency benchmark, builds on WebArena with formal reliability bounds.
- **ARE (Meta FAIR, Sep 2025)**: scalable agent environments + auto-generated evals.
- **Efficient Agents (Aug 2025)**: small-model agents on GAIA at lower cost — useful baseline if you care about $/task.
- **FHIR-AgentBench (Sep 2025)**: domain-specific (healthcare interoperability) — example of how to build a vertical eval if QualOps later wants a "code-review-specific" benchmark.

### 4.12 Comparison Table

| Benchmark | Year | Focus | Size | Scoring | Link |
| --- | --- | --- | --- | --- | --- |
| BFCL v3 | 2024 | Function-call accuracy + multi-turn | 2,200+ | AST + execution + state-based | https://gorilla.cs.berkeley.edu/leaderboard.html |
| τ-bench | 2024 | Tool-agent-user dialog | 2 domains, ~165 tasks | DB-state + pass^k | https://github.com/sierra-research/tau-bench |
| τ²-bench | 2025 | Multi-actor dual-control | 3 domains | DB-state + pass^k | https://github.com/sierra-research/tau2-bench |
| ToolBench (OpenBMB) | 2023 | API tool use at scale | 16K APIs / 120K pairs | LLM-judge (ToolEval) | https://github.com/OpenBMB/ToolBench |
| API-Bank | 2023 | Tool retrieval + planning | 73 APIs / 314 dialogues | runnable + match | https://openreview.net/forum?id=o2HBfgY20b |
| WebArena | 2023 | Web tasks | 812 tasks | programmatic state checks | https://webarena.dev/ |
| VisualWebArena | 2024 | Multimodal web | 910 tasks | programmatic | https://jykoh.com/vwa |
| WorkArena++ | 2024 | Enterprise SaaS | 33–682 tasks | execution-based | https://github.com/ServiceNow/WorkArena |
| AgentBench | 2024 | Multi-environment | 8 envs | success rate / F1 | https://github.com/THUDM/AgentBench |
| GAIA | 2023 | General assistant | 466 Qs | exact-match string | https://huggingface.co/datasets/gaia-benchmark/GAIA |
| SWE-bench | 2023 | Code: GH issues | 2,294 | run unit tests | https://www.swebench.com/ |
| SWE-bench Verified | 2024 | Code, validated | 500 | run unit tests | https://www.swebench.com/verified.html |
| SWE-bench Multimodal | 2024 | Code + screenshots | private | run unit tests | https://www.swebench.com/multimodal.html |
| SWE-bench Multilingual | 2025 | Code, 9 languages | 300 | run unit tests | https://www.swebench.com/multilingual-leaderboard.html |
| SWE-bench Live | 2025 | Fresh GH issues/mo | rolling | run unit tests | https://swe-bench-live.github.io/ |
| SWE-bench Pro | 2025 | Long-horizon enterprise | 1,865 | run unit tests | https://github.com/scaleapi/SWE-bench_Pro-os |
| MLAgentBench | 2023 | ML experimentation | 13 tasks | outcome metric | https://github.com/snap-stanford/MLAgentBench |
| MLE-bench | 2024 | Kaggle competitions | 75 | leaderboard rank | https://github.com/openai/mle-bench |
| AppWorld | 2024 | Daily-life apps | 750 tasks | state-based unit tests | https://appworld.dev/ |
| DevAI (Agent-as-Judge) | 2024 | AI dev tasks | 55 / 365 reqs | agent judge | https://github.com/metauto-ai/agent-as-a-judge |
| TRAJECT-Bench | 2025 | Trajectory quality | n/a | trajectory metrics | https://www.emergentmind.com/topics/traject-bench |

---

## 5. Code-Agent-Specific Evaluation (most relevant for QualOps)

### 5.1 Test-execution as oracle
The SWE-bench pattern is the single most influential idea in code-agent eval: *the agent's output is graded by running tests*. Concretely:
1. Apply the agent's patch to a clean repo snapshot.
2. Run the FAIL_TO_PASS set — these are tests that exercised the bug; they must now pass.
3. Run the PASS_TO_PASS set — pre-existing tests that must still pass (no regressions).
4. Resolve = both sets pass.

This is fully deterministic, fully outcome-based, ignores how the agent got there, and resists most reward hacking — a "fix" that monkey-patches the test harness or `import sys; sys.exit(0)`s usually breaks PASS_TO_PASS.

### 5.2 pass@k vs. pass^k for code agents
- **pass@k** (Codex/HumanEval origin): agent gets *k* attempts, scored if any one passes. Reflects "given infinite retries, can it ever succeed?"
- **pass^k** (Sierra τ-bench): agent must succeed *k* times in a row. Reflects "is it reliable enough to deploy?"

For QualOps, **pass^k is the more honest measure** — a code reviewer that catches the bug 50% of the time is not deployable, even if pass@4 looks great.

### 5.3 "Did the suggested fix actually fix the bug?"
Three increasingly strict variants for QualOps's Fix stage:
1. **Patch applies cleanly**: trivial syntactic check.
2. **Patch passes new tests** (FAIL_TO_PASS analog): need to author tests that pin the bug, or mine them from existing PRs.
3. **Patch is semantically equivalent to the human PR**: harder; needs LLM-judge or AST-diff with allowable equivalences.

For Review-stage findings (no patch, just a comment) the analog is:
1. **Finding location precision/recall**: did the agent flag the right line / file?
2. **Finding-class match**: did it categorize the issue correctly (security vs. perf vs. style)?
3. **Finding–PR alignment**: does the finding correspond to something the human reviewer also flagged?

### 5.4 Patch correctness beyond tests
Tests don't catch every flavor of bad fix:
- **Style / readability regression**: tests pass, but the diff is ugly, over-broad, or violates project conventions.
- **Performance regression**: tests pass but quietly add an O(n²).
- **Security regression**: tests pass but the patch introduces a new vuln.

These need additional graders: linter / formatter delta, perf benchmark, CodeQL/Semgrep diff, LLM-judge with explicit criteria. Cursor's CursorBench explicitly grades "code quality" and "efficiency" alongside correctness for this reason.

### 5.5 Cognition's approach (Devin)
Cognition's blog "A review of OpenAI's o1 and how we evaluate coding agents" describes their internal `cognition-golden` benchmark: real-task-pattern tasks with full development environments where evaluator agents (with Devin's own tools — bash, browser, editor) autonomously judge outcomes. They describe two complementary axes: (1) deterministic evaluators (compilers, linters, tests) — preferred when applicable; (2) **agent-evaluators** that look at the final state and judge open-endedly. They also use simulated users for the questioning behavior. This is a strong model for QualOps: deterministic checks for what's deterministic; agent judges for the rest.

### 5.6 Datasets to mine for QualOps test cases
- SWE-bench Verified — filter for issues labeled `code-quality`, `refactor`, `style`, `type`, `lint`.
- SWE-bench Live monthly drops — fresh, uncontaminated.
- SWE-bench Multilingual — if QualOps targets multiple languages.
- AppWorld — if you want to test the *workflow harness* on non-code tasks.
- Your own internal PR history — by far the highest-signal source. Convert past PRs into (pre-PR repo state, issue or commit message, set of human review comments, accepted patch). This becomes a proprietary `qualops-golden`.

---

## 6. Agent-as-Judge

### 6.1 Original paper
Zhuge et al., *Agent-as-a-Judge: Evaluate Agents with Agents* (arXiv 2410.10934, Oct 2024; ICML 2025). Core proposal: instead of an LLM-as-judge that sees only the final answer, give the *judge* itself agentic capabilities — tools, file system access, the ability to run code, the ability to inspect intermediate steps in the candidate agent's transcript. They release **DevAI**, 55 AI-dev tasks with 365 hierarchical requirements, and show:
- Agreement with human expert ~90% (vs. ~70% for plain LLM-judge).
- Cost reduction ~97% (86 h / $1,297 → ~2 h / $31).

### 6.2 Why it works (and when it doesn't)
**Works well when:**
- The artifact is open-ended (no unit tests possible) — "is this PR comment helpful and accurate?"
- Evaluation requires looking at intermediate steps — "did the agent actually verify this finding by reading the file, or hallucinate it?"
- You have a structured rubric the judge can iterate over (DevAI's hierarchical requirements).

**Doesn't help when:**
- The judge shares the candidate's biases (same model family — self-preference bias).
- Stakes require human sign-off anyway.
- A simple deterministic check exists — using a judge is just extra cost and noise.

### 6.3 Vs. plain LLM-as-judge
Plain LLM-judge: candidate produces final artifact → judge LLM sees (input, artifact, rubric) → returns score.
Agent-as-judge: judge can also call tools — open files, run greps, execute the artifact, inspect the candidate's own trace. Higher fidelity but more expensive and harder to make deterministic.

### 6.4 Pitfalls
- **Self-preference bias**: judge prefers outputs from its own model family. Mitigate with judge ensembles or cross-model judging.
- **Spec leakage**: if the judge sees the rubric verbatim, the candidate (if it also sees rubric-derived prompts) can game it.
- **Variance**: agent judges have higher variance than rubric-grader pipelines; budget for n=3+ runs.

### 6.5 For QualOps
The Judge stage in your pipeline already smells like agent-as-judge applied internally. For evaluation, an *external* agent-as-judge is well suited to grading "was this PR review good?" — give it the diff, the agent's findings, the actual human-merged PR, and a rubric, and let it use bash/grep to verify each finding against the code.

---

## 7. Simulation-Based / Sandbox / Replay Evaluation

### 7.1 Mocked or recorded tools
Two flavors:
- **Mocked**: hand-written or generated fake implementations (StableToolBench's approach to dead RapidAPI endpoints; AppWorld's whole engine; τ-bench's API mocks). Pro: deterministic, reproducible. Con: doesn't catch integration bugs.
- **Recorded**: capture real tool I/O once, replay forever. Like VCR cassettes for HTTP. Pro: realism. Con: brittle to tool drift; cassettes go stale.

### 7.2 Replay testing as regression
Pattern (used by Braintrust, LangSmith, Arize Phoenix, internally by Anthropic, Cognition):
1. Capture every production run as a trace (inputs, all tool calls, all outputs, final artifact).
2. Tag interesting traces — failures, edge cases, customer escalations — into a regression set.
3. On every prompt / model / harness change, replay each trace: feed the same input, *but stub tool calls with the recorded outputs*, and observe whether the agent makes equivalent decisions.
4. Diff: were tool-call sequences equivalent? Did the final artifact differ?

Sakura Sky's "Trustworthy AI Agents: Deterministic Replay" article describes this exactly. AgentRR (arXiv 2505.17716, May 2025) formalizes the record-and-replay paradigm.

For QualOps: every PR review you ship is already a trajectory. Sample some, freeze them, and you have a regression suite that tracks model / prompt drift better than any synthetic benchmark.

### 7.3 Counterfactual replay
Replay with one variable changed: same input, swap the model; same model, perturb the prompt; same model and prompt, swap one tool's response to test robustness. The "Seeing the Whole Elephant" failure-attribution paper (arXiv 2604.22708) uses this for failure attribution in multi-agent systems.

### 7.4 Hybrid: synthetic environments behind real harness
Pattern: build a controlled environment (a fixture repo with a known set of bugs) but run the production agent harness against it unmodified. SWE-bench is exactly this. AppWorld is exactly this. For QualOps, a fixture repo with N seeded bugs of various classes is cheap and gives a stable baseline.

---

## 8. Trajectory-Level Metric Glossary (know-by-name)

- **Trajectory exact match** — predicted == reference, identical tool calls in identical order. Strictest.
- **Trajectory in-order match** — reference is an ordered subsequence of predicted; extra calls allowed.
- **Trajectory any-order match** — reference is a subset of predicted; order-agnostic.
- **Tool-call F1** (a.k.a. ToolCallF1) — set-level precision/recall over (tool, args) pairs; harmonic mean.
- **Argument F1 / Argument Correctness** — per-call argument-level precision/recall.
- **Tool selection accuracy** — given the right step boundary, did it pick the right tool name (ignore args).
- **Action similarity** — embedding-based or LLM-judged similarity between action and reference action. Useful when arguments are free-form text (e.g. PR-comment body).
- **AgentBench success rate** — task completion fraction per environment.
- **AST match (BFCL)** — parsed-call structural equality; argument-order-agnostic.
- **Execution match (BFCL)** — call executed in sandbox returns ground-truth value.
- **Goal Completion Rate / Task Success Rate** — final-state binary outcome.
- **Step Success Rate** — fraction of trajectory steps that succeed.
- **Convergence** — fraction of runs reaching a terminal state without timeout/intervention.
- **Optimal Path Ratio** — actual_steps / minimal_steps.
- **pass@k** — succeed at least once in *k* trials.
- **pass^k** — succeed every time in *k* trials (Sierra).
- **State-based eval (BFCL v3 / AppWorld / τ-bench)** — compare environment state after run to gold state, optionally penalizing collateral damage.
- **Response-based eval (BFCL v3)** — compare model's natural-language reply for keyword/semantic match.

---

## 9. Calibration Under Non-Determinism

### 9.1 Why agents are non-deterministic
Even at temperature 0, modern serving stacks are non-deterministic (batched inference, kernel non-determinism on GPUs — see "Non-Determinism of 'Deterministic' LLM Settings", arXiv 2408.04667). On top of that: tool outputs change (search results, web pages, time), and many agents deliberately sample with temperature > 0.

### 9.2 Implications for evaluation
Single-run pass/fail is statistically meaningless beyond a coarse signal. Reliable evaluation needs:
- **Multiple runs per task** — minimum 3 to compute a stable mean; 5–10 for sharper variance estimates; 30+ if you need confidence intervals on small effects.
- **pass^k reporting** — alongside pass@1; the gap is informative.
- **Confidence intervals** — Anthropic's "A Statistical Approach to Model Evals" (2024) walks through bootstrap CIs and the math for correctly comparing two model scores. tl;dr: a 5-point gap on 200 tasks is usually within the noise floor; reporters routinely overclaim.
- **Voting / self-consistency** — at evaluation time you can also use majority-vote over n runs as the candidate's "answer" (separately from how the production system runs).
- **Fixed seeds where possible** — partial mitigation; not a substitute for repetition.

### 9.3 Practical defaults
- For tracked metrics: ≥5 runs per task, report mean and std.
- For decisions ("ship this prompt change"): require a statistically significant improvement, not a single-point gain.
- Cap turn budgets per run to keep variance bounded.
- Snapshot tool outputs (replay) for the regression suite so non-determinism is isolated to model variance only.

---

## 10. Practical Patterns from Production Teams

### 10.1 Anthropic — "Demystifying evals for AI agents" (engineering blog, Jan 2026)
- Taxonomy of graders: **code-based**, **model-based** (LLM-judge), **human**.
- Score aggregation modes: weighted, binary (all-must-pass), hybrid.
- Eval the **harness + model**, not the model alone — the harness (Claude Agent SDK in QualOps's case) is part of the system under test.
- Top pitfalls called out: rigid grading that punishes equivalent answers; ambiguous task specs; stochastic tasks that can't be reproduced.
- Bloom — Anthropic's open-source automated behavioral eval tool — and the agent-autonomy work (https://www.anthropic.com/research/measuring-agent-autonomy) are companion reads.

### 10.2 Sierra — τ-bench in production
- Sierra runs τ-bench-style internal benchmarks for every customer-facing agent before deploy.
- Their public position: pass^k is the production-relevant metric; pass@1 hides a 2× reliability gap.
- They use simulated-user dialogs in eval because that matches their product surface.

### 10.3 Cognition — Devin
- `cognition-golden` internal benchmark with train/test split; train side used for self-improvement loops, test side as a hold-out.
- Hybrid evaluator stack: deterministic (tests, compilers, linters) where possible; agent-evaluators (with Devin's tools) for open-ended judgment.
- Simulated users that can answer Devin's clarifying questions, modeling the realistic case where the agent has missing info.
- Public SWE-bench technical report (https://cognition.ai/blog/swe-bench-technical-report) details how they audit their own pipeline for contamination and harness drift.

### 10.4 Cursor — CursorBench
- Multi-axis grading: solution correctness, code quality, efficiency, interaction quality.
- Offline (`CursorBench`) + on-policy live-traffic A/B catches a class of regressions where the agent looks correct to a grader but feels worse to a user.
- Public post: https://cursor.com/blog/cursorbench.

### 10.5 Sourcegraph (Cody, Amp)
- Heavy emphasis on retrieval correctness — did the agent pull the right context before answering? Treat retrieval as a first-class tool call and evaluate it with precision/recall.
- Codebase-graph awareness as eval signal: did the agent's edits respect call-graph dependencies?

### 10.6 Replit
- Standard pytest/Jest test running for outcome eval on user code, but no built-in agent-specific eval harness — relies on user-defined tests as oracle.

### 10.7 Amazon Q Developer
- Public SWE-bench numbers as the headline (e.g. 38.8% on SWE-bench Verified at one point).
- Internally: trace-grading (capture full agent traces, run rubric graders) plus latency / cost / resource-efficiency metrics alongside accuracy.

### 10.8 OpenAI
- `openai/evals` — generic LLM eval framework, not agent-specific but extended.
- Agent-Evals API (Platform): trace grading + structured rubric scorers; their guide explicitly recommends recording every model and tool call to a trace and grading the trace, not just the final answer.

### 10.9 Common pattern across teams
Every serious production team converges to roughly the same five-layer stack:
1. Unit-style assertions on tool calls (BFCL-style).
2. End-to-end execution evals on synthetic fixtures (AppWorld / SWE-bench style).
3. Recorded-trace replay as regression net.
4. LLM-judge or agent-judge for open-ended quality.
5. Live-traffic A/B and human review on the long tail.

---

## 11. Decision Guide — "If your agent does X, evaluate with Y"

| Situation | Use this technique |
| --- | --- |
| Single-call function selection (one tool, one argument set) | BFCL-style **AST match** + **argument F1** |
| Multi-step deterministic workflow (login → list → action) | **Trajectory in-order match** + **state-based eval** of final environment |
| Parallel tool calls in one turn | **Set-equality** match (bag of calls); never order-sensitive |
| Tool arguments are free-form text (e.g. PR comment body) | **Action similarity** (embedding or LLM-judge), not exact match |
| Side-effecting tools (writes, posts, deletes) | **State-based eval with collateral-damage check** (AppWorld pattern) |
| Output is a code patch | **SWE-bench harness**: apply patch + FAIL_TO_PASS + PASS_TO_PASS |
| Output is open-ended text (review summary, design doc) | **Agent-as-judge** with structured rubric |
| Need to detect hallucinated tools | **Schema validation** + tool-name whitelist + irrelevance category |
| Need to detect missed tools | **Recall** against reference trajectory; track under-tooling rate |
| Variance/reliability concern | **pass^k** with k≥5; report mean + 95% CI |
| Catching prompt/model regressions | **Recorded-trace replay** with tool stubs |
| Validating against fresh / contamination-free data | **SWE-bench Live** or your own freshly-mined PRs |
| Long-horizon multi-stage agent (QualOps's case) | Hybrid: per-stage tool-call F1 + per-stage state checks + end-to-end outcome + agent-as-judge on final report |

### 11.1 Specific recipe for QualOps
- **Analyze stage**: tool-call F1 against a reference set of grep/file-read calls per fixture repo. Penalize hallucinated tools, track under-call rate.
- **Review stage**: location precision/recall on flagged lines; finding-class accuracy; agent-as-judge on textual quality of comments.
- **Fix stage**: SWE-bench-style harness — apply suggested patch, run repo tests, FAIL_TO_PASS + PASS_TO_PASS. Plus linter/formatter delta to catch style regressions.
- **Report stage**: schema validation on emitted JSON; agent-as-judge for narrative coherence.
- **Judge stage** (QualOps's own internal judge): meta-evaluate by comparing the internal Judge's pass/fail call to a held-out human-labeled pass/fail. Agreement rate is your meta-judge metric.
- **Across stages**: pass^5 over a fixed set of 50–200 fixture PRs; recorded-trace replay on the last 200 production PRs as regression net; statistical CIs reported on every comparison.

---

## 12. References

### Primary papers
- Patil, Mao, et al. **The Berkeley Function Calling Leaderboard (BFCL): From Tool Use to Agentic Evaluation of Large Language Models.** ICML 2025 / OpenReview. https://openreview.net/forum?id=2GmDdhBdDk — BFCL v1–v3 methodology and evaluation correlations.
- Yao et al. **τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains.** arXiv 2406.12045. https://arxiv.org/abs/2406.12045 — pass^k metric, simulated-user dialog eval.
- Qin et al. **ToolLLM: Facilitating Large Language Models to Master 16000+ Real-world APIs.** ICLR 2024. https://arxiv.org/abs/2307.16789 — RapidAPI-scale tool use, DFSDT, ToolEval.
- Li et al. **API-Bank: A Comprehensive Benchmark for Tool-Augmented LLMs.** OpenReview. https://openreview.net/forum?id=o2HBfgY20b — runnable API eval, 73 APIs.
- Zhou et al. **WebArena: A Realistic Web Environment for Building Autonomous Agents.** arXiv 2307.13854. https://arxiv.org/abs/2307.13854 — programmatic state checks for web agents.
- Koh et al. **VisualWebArena: Evaluating Multimodal Agents on Realistic Visual Web Tasks.** https://jykoh.com/vwa — multimodal extension of WebArena.
- Drouin et al. **WorkArena: How Capable Are Web Agents at Solving Common Knowledge Work Tasks?** ServiceNow Research — enterprise SaaS workflows.
- Liu et al. **AgentBench: Evaluating LLMs as Agents.** ICLR 2024. https://arxiv.org/abs/2308.03688 — 8-environment benchmark, server-client architecture.
- Mialon et al. **GAIA: A Benchmark for General AI Assistants.** arXiv 2311.12983. https://arxiv.org/abs/2311.12983 — exact-match string grading for general-assistant tasks.
- Jimenez et al. **SWE-bench: Can Language Models Resolve Real-World GitHub Issues?** ICLR 2024. https://www.swebench.com/ — execution-based code-agent grading.
- OpenAI. **Introducing SWE-bench Verified.** https://openai.com/index/introducing-swe-bench-verified/ — 500-instance human-validated subset.
- Scale AI. **SWE-Bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks?** arXiv 2509.16941. https://arxiv.org/abs/2509.16941 — enterprise-scale code agent benchmark.
- **SWE-bench Live.** https://swe-bench-live.github.io/ — rolling fresh-issue release (50/month).
- Huang et al. **MLAgentBench: Evaluating Language Agents on Machine Learning Experimentation.** arXiv 2310.03302. https://arxiv.org/abs/2310.03302 — ML research agent eval.
- Chan et al. **MLE-bench: Evaluating Machine Learning Agents on Machine Learning Engineering.** arXiv 2410.07095. https://arxiv.org/abs/2410.07095 — Kaggle-grounded ML-agent benchmark.
- Trivedi et al. **AppWorld: A Controllable World of Apps and People for Benchmarking Interactive Coding Agents.** ACL 2024 best resource paper. https://arxiv.org/abs/2407.18901 — 750 tasks with state-based + collateral-damage eval.
- Zhuge et al. **Agent-as-a-Judge: Evaluate Agents with Agents.** arXiv 2410.10934. https://arxiv.org/abs/2410.10934 — agentic judges, DevAI benchmark.
- Liu et al. **Saving SWE-Bench: A Benchmark Mutation Approach for Realistic Agent Evaluation.** arXiv 2510.08996. https://arxiv.org/abs/2510.08996 — adversarial mutations to detect lucky shortcuts.
- Atil et al. **Non-Determinism of 'Deterministic' LLM Settings.** arXiv 2408.04667. https://arxiv.org/html/2408.04667v5 — why temperature=0 isn't enough.
- Zhang et al. **AgentRR: Get Experience from Practice — LLM Agents with Record & Replay.** arXiv 2505.17716. https://arxiv.org/abs/2505.17716 — formal record-and-replay paradigm.
- **Seeing the Whole Elephant: A Benchmark for Failure Attribution in LLM-based Multi-Agent Systems.** arXiv 2604.22708. https://arxiv.org/html/2604.22708v1 — counterfactual replay for failure attribution.

### Engineering / production blogs
- Anthropic. **Demystifying evals for AI agents.** https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents — taxonomy of graders, pitfalls.
- Anthropic. **A Statistical Approach to Model Evals.** https://www.anthropic.com/research/statistical-approach-to-model-evals — bootstrap CIs and significance for model comparisons.
- Anthropic. **Building agents with the Claude Agent SDK.** https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk — harness + model evaluation framing.
- Anthropic. **Bloom: an open source tool for automated behavioral evaluations.** https://www.anthropic.com/research/bloom — open-source eval tool.
- Anthropic. **Measuring AI Agent Autonomy in Practice.** https://www.anthropic.com/research/measuring-agent-autonomy — autonomy-axis eval framing.
- Sierra. **τ-Bench: Benchmarking AI agents for the real-world.** https://sierra.ai/blog/benchmarking-ai-agents — production rationale, pass^k motivation.
- Sierra. **τ³-Bench: Advancing agent evaluation to knowledge and voice.** https://sierra.ai/blog/bench-advancing-agent-benchmarking-to-knowledge-and-voice — third-gen extension.
- Cognition. **A review of OpenAI's o1 and how we evaluate coding agents.** https://cognition.ai/blog/evaluating-coding-agents — `cognition-golden`, hybrid evaluators.
- Cognition. **SWE-bench technical report.** https://cognition.ai/blog/swe-bench-technical-report — Devin's SWE-bench audit.
- Cognition. **Devin's 2025 Performance Review.** https://cognition.ai/blog/devin-annual-performance-review-2025 — production lessons.
- Cursor. **CursorBench: How we compare model quality.** https://cursor.com/blog/cursorbench — multi-axis quality grading + live A/B.
- Databricks. **Beyond the Leaderboard: Unpacking Function Calling Evaluation.** https://www.databricks.com/blog/unpacking-function-calling-eval — critique of pure AST match.
- AWS. **Reinventing the Amazon Q Developer agent for software development.** https://aws.amazon.com/blogs/devops/reinventing-the-amazon-q-developer-agent-for-software-development/ — production SWE-bench numbers and trace grading.
- AWS. **Evaluating AI agents for production: Strands Evals.** https://aws.amazon.com/blogs/machine-learning/evaluating-ai-agents-for-production-a-practical-guide-to-strands-evals/ — trajectory-evaluator pattern.
- OpenAI Developers. **Testing Agent Skills Systematically with Evals.** https://developers.openai.com/blog/eval-skills — trace grading.
- OpenAI Developers. **Evaluate agent workflows.** https://developers.openai.com/api/docs/guides/agent-evals — agent-eval API guide.
- Google Cloud. **A methodical approach to agent evaluation.** https://cloud.google.com/blog/topics/developers-practitioners/a-methodical-approach-to-agent-evaluation — Vertex AI trajectory metrics.
- LangChain. **LLM Evaluation Framework: Trajectories vs. Outputs.** https://www.langchain.com/articles/llm-evaluation-framework — trajectory-vs-outcome framing.
- LangChain. **How to evaluate your agent with trajectory evaluations.** https://docs.langchain.com/langsmith/trajectory-evals — exact/in-order/any-order metrics.
- DeepEval. **Argument Correctness metric.** https://deepeval.com/docs/metrics-argument-correctness — argument-level grading.
- DeepEval. **Tool Correctness metric.** https://deepeval.com/docs/metrics-tool-correctness — tool selection grading.
- Ragas. **Agentic / tool-use metrics.** https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/agents/ — ToolCallF1, parameter-name F1.
- Sakura Sky. **Trustworthy AI Agents: Deterministic Replay.** https://www.sakurasky.com/blog/missing-primitives-for-trustworthy-ai-part-8/ — deterministic replay primitive.
- Braintrust. **Evaluating agents with trace-driven insights.** https://medium.com/@braintrustdata/evaluating-agents-with-trace-driven-insights-9ad3bfed820e — trace-as-eval pattern.
- The Context Lab. **The Non-Determinism Problem: What It Takes to Evaluate Agents Reliably.** https://www.thecontextlab.ai/blog/non-determinism-problem-evaluating-agents-reliably — operational guidance for variance.
- Toloka. **Tau-Bench extension: benchmarking policy-aware agents in realistic settings.** https://toloka.ai/blog/tau-bench-extension-benchmarking-policy-aware-agents-in-realistic-settings/ — policy-compliance extension.
- Arize AI. **How to Evaluate Tool-Calling Agents.** https://arize.com/blog/how-to-evaluate-tool-calling-agents/ — observability-flavored eval guide.
- Galileo. **Agent Evaluation Framework With Metrics, Rubrics, and Benchmarks.** https://galileo.ai/blog/agent-evaluation-framework-metrics-rubrics-benchmarks — metric taxonomy.

### Surveys
- **Evaluation and Benchmarking of LLM Agents: A Survey.** ACM Computing Surveys / arXiv 2507.21504. https://arxiv.org/html/2507.21504v1 — broad 2025 survey.
- **A Survey on LLM-as-a-Judge.** arXiv 2411.15594. https://arxiv.org/html/2411.15594v4 — companion survey on judge models.
- **A Survey on Agent-as-a-Judge.** arXiv 2601.05111. https://arxiv.org/html/2601.05111v1 — agent-judge specifically.
- **When AIs Judge AIs: The Rise of Agent-as-a-Judge Evaluation for LLMs.** arXiv 2508.02994. https://arxiv.org/html/2508.02994v1 — practitioner-oriented summary.

### Leaderboards (live)
- BFCL v4 leaderboard. https://gorilla.cs.berkeley.edu/leaderboard.html
- SWE-bench leaderboards (all variants). https://www.swebench.com/
- SWE-bench Live. https://swe-bench-live.github.io/
- SWE-bench Pro public. https://labs.scale.com/leaderboard/swe_bench_pro_public
- τ²-Bench Telecom (Artificial Analysis). https://artificialanalysis.ai/evaluations/tau2-bench
- AppWorld leaderboard. https://github.com/StonyBrookNLP/appworld-leaderboard
