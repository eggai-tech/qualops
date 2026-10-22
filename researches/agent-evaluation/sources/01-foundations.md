# Foundations of LLM Agent Evaluation

*Research dossier for the QualOps internal report — Section 01: Foundations*
*Compiled May 8, 2026*

## Executive Summary

Evaluating an LLM-based agent is qualitatively different from evaluating a single LLM completion. Where classical LLM evals score one model output against a reference, agent evals must judge a *trajectory* — a multi-step sequence of plans, tool calls, observations, and self-corrections — under partially-observable, stochastic execution. The field has converged on a layered taxonomy: **component-level** evals (does the retriever / tool-call / sub-prompt do its job?), **trajectory-level** evals (is the reasoning path valid, efficient, and faithful?), and **end-to-end / outcome-level** evals (did the agent solve the task?). Around this skeleton, a quality framework has emerged covering accuracy, faithfulness, completeness, robustness, calibration, latency, cost, safety, and determinism. The evaluation lifecycle blends offline golden datasets, regression suites, and CI gates with online monitoring and drift detection. **LLM-as-judge** (Zheng et al. 2023) has become the dominant cheap-and-scalable method, but its biases (position, verbosity, self-preference) and the recent rise of **process reward models** and **agent-as-judge** systems are reshaping how teams measure quality. For a tool-using, multi-stage code-review pipeline like QualOps, the practical implications are: invest early in trajectory + tool-call F1 metrics, build a small (50-200) curated golden set of real PRs, gate releases on paired statistical comparisons, and run an LLM-judge fleet with debiasing guardrails. This document surveys the academic foundations underpinning all of those choices.

---

## 1. Definitions and Taxonomy

### 1.1 Agent eval vs. LLM eval

A classical **LLM eval** treats the model as a function `f(prompt) -> completion` and scores the completion against a reference (BLEU, ROUGE, exact match) or a rubric. The unit of evaluation is one I/O pair.

An **agent eval** treats the agent as a stateful policy `π` that interacts with an environment via tools. The unit of evaluation is a **trajectory** `τ = (s₀, a₀, o₀, s₁, a₁, o₁, …, sₙ)` where each `sᵢ` is a state (context + memory), `aᵢ` an action (tool call or final answer), and `oᵢ` an observation. Every benchmark surveyed agrees that agent eval requires assessing not just the terminal answer but the *path* taken to reach it ([SAP-Samples KDD 2025 tutorial](https://sap-samples.github.io/llm-agents-eval-tutorial/)). The Anthropic engineering team frames the same shift as moving from "single-output grading" to "behavior verification across many turns" ([Anthropic, "Demystifying evals for AI agents"](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).

### 1.2 The three layers

Modern agent-eval taxonomies (e.g., the survey of [Yu et al. 2025, "Evaluation and Benchmarking of LLM Agents"](https://arxiv.org/html/2507.21504v1) and the LangChain framework) recognize three nested layers:

| Layer | Question | Typical metric |
|---|---|---|
| **Component-level** | Does each sub-skill (retriever, planner, single tool call, sub-agent) work in isolation? | Tool-match rate, parameter F1, retrieval recall@k |
| **Trajectory-level** | Is the path of reasoning + actions valid, efficient, and faithful? | Plan correctness, trajectory edit distance, step-level reward (PRM), tool-call F1 over the sequence |
| **Outcome / end-to-end** | Did the agent achieve the user goal? | Task success, unit-test pass rate (SWE-bench), human rating |

LangChain's documentation makes this explicit: "trajectory evaluators look at intermediate steps; output evaluators look only at the final response" ([LangChain trajectory eval docs](https://docs.langchain.com/langsmith/trajectory-evals)).

### 1.3 Other axes

- **Single-turn vs. multi-turn.** Single-turn evals score one user-input → agent-output pair. Multi-turn evals score a conversation or a tool-using session. MT-Bench was the first widely-cited multi-turn LLM eval ([Zheng et al. 2023](https://arxiv.org/abs/2306.05685)).
- **Online vs. offline.** Offline evals run on a frozen dataset before deployment; online evals run on live traffic and feed back into monitoring ([Langfuse, LLM Eval 101](https://langfuse.com/blog/2025-03-04-llm-evaluation-101-best-practices-and-challenges)). They are complementary: "offline tests catch regressions before code reaches staging; online monitors surface drift, abuse, and cost spikes" ([Label Studio, online vs. offline](https://labelstud.io/learningcenter/offline-evaluation-vs-online-evaluation-when-to-use-each/)).
- **Reference-based vs. reference-free.** Reference-based metrics (BLEU, exact match, unit-test pass) compare against a known-good answer. Reference-free metrics (LLM-judge rubrics, faithfulness scores, perplexity) require no gold answer — essential when ground truth is expensive or undefined ([Eugene Yan, "LLM-Evaluators"](https://eugeneyan.com/writing/llm-evaluators/)).

---

## 2. Core Dimensions of Agent Quality

Stanford's HELM framework canonicalized seven core metrics — accuracy, calibration, robustness, fairness, bias, toxicity, efficiency — and showed that scoring on accuracy alone hides serious failure modes ([HELM, Liang et al. 2022](https://arxiv.org/abs/2211.09110)). Below are the dimensions that matter most for an agentic code-review system.

| Dimension | Definition | How it's typically measured |
|---|---|---|
| **Accuracy / task success** | Did the agent produce the correct outcome? | Exact match, unit tests pass (SWE-bench style), human rating |
| **Faithfulness / groundedness** | Are claims supported by the retrieved/observed context? | Claim-level NLI vs. context, RAGAS faithfulness ([Ragas docs](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/)) |
| **Completeness** | Did the agent address all parts of the request? | Aspect-coverage rubric, recall on a checklist of expected findings |
| **Helpfulness** | Was the response actionable and useful to the user? | Pairwise human preference, LLM-judge rubric |
| **Robustness** | Stable under prompt perturbation, adversarial input, distribution shift? | Performance under paraphrase / typo / adversarial prompt suites |
| **Calibration** | Do confidence scores match empirical accuracy? | ECE (expected calibration error), Brier score; verbalized vs. logit-based confidence ([Geng et al. 2025 survey](https://arxiv.org/abs/2503.15850)) |
| **Latency** | Wall-clock time per task / step | p50/p95/p99 latency, time-to-first-token |
| **Cost** | $ per task | Tokens × price + tool-call costs |
| **Safety** | Avoidance of harmful, biased, or policy-violating outputs | Red-team pass rate, toxicity classifiers ([Perez et al. 2022](https://arxiv.org/abs/2202.03286)) |
| **Determinism / consistency** | Same input → same output (or stable distribution)? | Output variance across N samples at T=0; self-consistency rate ([Wang et al. 2022](https://arxiv.org/abs/2203.11171)) |

Two notes specific to the QualOps Analyze→Review→Fix→Report→Judge pipeline:

1. **Faithfulness is the dominant dimension for code review.** A "hallucinated" finding (a vulnerability that doesn't exist in the diff) is more damaging than a missed one because it erodes reviewer trust. Faithfulness for code agents = "every claim in the report is grounded in actual lines of the diff or repo." The RAG literature's faithfulness metric ([deepset blog](https://www.deepset.ai/blog/rag-llm-evaluation-groundedness)) generalizes: extract atomic claims, verify each against the source.
2. **Calibration matters for triage.** If QualOps emits a severity label, ECE quantifies whether "high" findings are actually higher-priority. LLMs are systemically overconfident under verbalized prompting ([Geng et al. 2025](https://arxiv.org/abs/2503.15850)); consistency-based confidence (sample N, measure agreement) is more reliable.

---

## 3. The Evaluation Lifecycle

Hamel Husain's widely-cited guides describe the evals loop that mature teams converge on ([Husain, "Your AI Product Needs Evals"](https://hamel.dev/blog/posts/evals/); [Husain & Shankar, "LLM Evals: Everything You Need to Know"](https://hamel.dev/blog/posts/evals-faq/)):

```
  +-----------------+     +-------------------+     +------------------+
  | 1. Error        | --> | 2. Codify failure | --> | 3. Add eval to   |
  |    analysis on  |     |    modes as       |     |    golden set    |
  |    real logs    |     |    rubric items   |     |                  |
  +-----------------+     +-------------------+     +------------------+
           ^                                                  |
           |                                                  v
  +-----------------+     +-------------------+     +------------------+
  | 6. Online       | <-- | 5. Ship + monitor | <-- | 4. Run regression|
  |    drift /      |     |    in production  |     |    suite in CI;  |
  |    sample-judge |     |                   |     |    block on regr.|
  +-----------------+     +-------------------+     +------------------+
```

Key tactics endorsed across primary sources:

- **Start small.** Anthropic's engineering team writes that "20-50 simple tasks drawn from real failures is a great start" ([Anthropic, demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)). Simon Willison echoes: "if you're passing 100% of your evals, you're not challenging your system enough" ([Willison, evals tag](https://simonwillison.net/tags/evals/)).
- **Eval-driven development.** Treat evals like unit tests: write them first, fail them, then build the change that passes them. The O'Reilly "What We Learned from a Year of Building with LLMs" team (Yan, Bischof, Frye, Husain, Liu, Shankar) describes evals as a "data flywheel" — every production failure becomes a new eval row ([O'Reilly Part I](https://www.oreilly.com/radar/what-we-learned-from-a-year-of-building-with-llms-part-i/)).
- **Golden datasets are curated, not crawled.** They should reflect real production distribution, include known failure cases, and cover edge cases discovered in error analysis. For QualOps this means: 50-200 real PRs spanning languages, sizes, change types, and labeled failure modes.
- **Regression tests on every PR.** Run the full eval suite in CI on each prompt or code change. Block merges on stat-sig regression of any axis.
- **A/B comparisons are paired and statistical.** See section 7.
- **Online monitoring** samples production traffic (5-10% is a common heuristic) and runs an LLM-judge fleet asynchronously to flag drift ([Langfuse 2025](https://langfuse.com/blog/2025-03-04-llm-evaluation-101-best-practices-and-challenges)). Drift signals: rising malformed-output rate, latency creep, judge-score distribution shift.

---

## 4. LLM-as-Judge

### 4.1 The seminal work

[Zheng et al., "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena" (NeurIPS 2023)](https://arxiv.org/abs/2306.05685) introduced two artifacts that became the standard:

- **MT-Bench**: 80 multi-turn questions across 8 categories, scored 1-10 by GPT-4 acting as judge.
- **Chatbot Arena**: a crowdsourced pairwise battle platform with Bradley-Terry / Elo ratings.

Their headline empirical finding: GPT-4 as judge agreed with human preference at 80%+ — roughly the same as inter-human agreement. This legitimized LLM-judge as a primary evaluation method.

### 4.2 Known biases and mitigations

The same paper, and a flood of follow-ups, identify recurring failure modes:

| Bias | What happens | Common mitigation |
|---|---|---|
| **Position bias** | Judge prefers whichever answer appears first (or second) regardless of content | Swap order, score both, average; use "robustness rate" metric ([Shi et al. 2024, position bias study](https://arxiv.org/html/2406.07791v9)) |
| **Verbosity bias** | Longer answers rated higher | Constrain length in rubric; normalize for length |
| **Self-preference / self-enhancement** | Judge prefers outputs from its own family | Use a different model as judge; ensemble across providers ([Panickssery et al. 2024](https://arxiv.org/abs/2410.21819)) |
| **Familiarity / low-perplexity bias** | Judge favors text it would have generated itself | Down-weight low-perplexity samples |
| **Sycophancy / sentiment bias** | Judge follows hints in the prompt about which is "better" | Blind the judge to source |
| **Fallacy oversight** | Judge accepts confident-sounding wrong reasoning | Require step-by-step grading; use process supervision |

The CALM framework ([Ye et al. 2024, "Justice or Prejudice"](https://arxiv.org/html/2410.02736v1)) catalogs 12 distinct biases and shows that even GPT-4 fails to be position-consistent on ~30% of comparisons.

### 4.3 Pairwise vs. pointwise

- **Pointwise** (a.k.a. single-answer grading): judge scores one answer on a rubric. Cheap, parallelizable, but suffers from anchoring and rubric drift.
- **Pairwise**: judge picks the better of two. More aligned with human preference, easier to calibrate, but O(N²) for full ranking — usually solved by Bradley-Terry on sampled pairs.
- **Reference-based** (judge sees ground truth): highest agreement with humans, but requires gold answers.

Husain's "Using LLM-as-a-Judge" guide recommends **binary pass/fail rubrics** over Likert scales for production judges, because binary judges are easier to calibrate against humans and easier to debug ([Husain, LLM Judge guide](https://hamel.dev/blog/posts/llm-judge/)).

### 4.4 Specialized judge models

- **G-Eval** ([Liu et al. 2023](https://arxiv.org/abs/2303.16634)): use GPT-4 with chain-of-thought rubrics and form-filling. 0.514 Spearman with humans on summarization — beats prior NLG metrics.
- **Prometheus** ([Kim et al. 2024](https://github.com/prometheus-eval/prometheus-eval)): open-weight Llama-2-13B fine-tuned on 100K GPT-4-generated rubric grades. Designed for fine-grained, rubric-driven evaluation.
- **JudgeLM** (7B/13B/33B): trained on a high-quality preference dataset with explicit bias mitigation in fine-tuning.
- **Auto-J**: generative evaluator that returns both score and critique across many task scenarios.

A cautionary follow-up — [Huang et al. 2024, "An Empirical Study of LLM-as-a-Judge"](https://arxiv.org/html/2403.02839) — found that fine-tuned judges (JudgeLM, PandaLM, Auto-J, Prometheus) achieve high in-domain scores but fail to generalize, lagging GPT-4 on fairness, generalization, and aspect-specific evaluation. **For now, frontier models remain the most reliable judges.**

### 4.5 When LLM-judge fails

Eugene Yan's survey of two dozen judge papers ([Yan, "Evaluating LLM-Evaluators"](https://eugeneyan.com/writing/llm-evaluators/)) flags the cases where LLM-judge is unreliable:

- Tasks requiring deep domain expertise (medicine, law, security) the judge model lacks.
- Tasks where the judge would have to do work harder than the generator (e.g., judging a math proof when the judge can't do the math).
- Highly subjective / aesthetic tasks where humans disagree among themselves.

```
                +------------------+
                | Need a judgement |
                +--------+---------+
                         |
           +-------------+-------------+
           |                           |
  Have ground truth?              No ground truth
           |                           |
           v                           v
   +--------------+        +-----------------------+
   | Programmatic |        | Is task within        |
   | check (tests,|        | judge model's domain? |
   | exact match) |        +-----------+-----------+
   +--------------+                    |
                            +----------+----------+
                            |                     |
                            v                     v
                   +---------------+    +-------------------+
                   | LLM-judge OK; |    | Need human review |
                   | calibrate vs. |    | or specialist     |
                   | humans, watch |    | judge (PRM, agent |
                   | for biases    |    | -as-judge)        |
                   +---------------+    +-------------------+
```

---

## 5. Trajectory and Process Evaluation

### 5.1 Why outcome-only is insufficient

A code-review agent could produce a correct final report by accident — having issued ten irrelevant tool calls and reasoned incorrectly along the way. Outcome metrics miss this. Process evaluation asks: *was every intermediate step justified?*

### 5.2 Process Reward Models (PRMs)

OpenAI's [Lightman et al. 2023, "Let's Verify Step by Step"](https://arxiv.org/abs/2305.20050) demonstrated that **process supervision** (label each reasoning step correct/incorrect) outperforms **outcome supervision** (label only the final answer) for training reward models on math problems. The process-supervised model solved 78% of MATH (vs. ~70% with outcome supervision). They released the [PRM800K dataset](https://github.com/openai/prm800k) of 800K step-level human labels.

Recent advances:

- [**The Lessons of Developing PRMs in Mathematical Reasoning** (Zheng et al. 2025)](https://arxiv.org/abs/2501.07301): documents what scales (data quality, step granularity) and what doesn't.
- [**R-PRM: Reasoning-Driven Process Reward Modeling** (Wu et al. 2025)](https://arxiv.org/abs/2503.21295): generative PRM that produces a rationale before scoring; +11.9 F1 on ProcessBench, +8.5 on PRMBench.
- [**Process Reward Models That Think** (Khalifa et al. 2025)](https://arxiv.org/abs/2504.16828): "ThinkPRM" verifies each step with an explicit verification CoT, reaching strong performance with orders-of-magnitude less labeled data.

### 5.3 Trajectory-level metrics for tool-using agents

LangChain's `agentevals` package and Arize's trajectory eval docs codify a practical metric set ([agentevals GitHub](https://github.com/langchain-ai/agentevals); [Arize trajectory docs](https://arize.com/docs/ax/evaluate/evaluators/trace-and-session-evals/trace-level-evaluations/agent-trajectory-evaluations)):

- **Trajectory match (strict / unordered / superset)**: compare actual tool-call sequence to a reference.
- **Tool-call F1**: precision/recall on the multiset of (tool_name, key_args) tuples.
- **Plan correctness**: did the agent decompose the task correctly? (Often LLM-judged.)
- **Step-level grounding**: each step's reasoning is supported by prior context/observations.
- **Efficiency**: number of steps / tool calls relative to optimal; redundant-call rate.
- **Recovery**: did the agent recover from a tool error?

[**TRACE: Trajectory-Aware Comprehensive Evaluation for Deep Research Agents** (2026)](https://arxiv.org/html/2602.21230v1) and the [Holistic Agent Leaderboard (2025)](https://arxiv.org/pdf/2510.11977) extend these into multi-dimensional rubrics covering completeness, faithfulness, and exploration breadth.

### 5.4 ReAct-trace specifics

For agents using the ReAct pattern (Thought → Action → Observation loop), evaluation typically scores: (a) whether each Thought is logically derived from prior Observations, (b) whether the Action follows from the Thought, and (c) whether the loop terminates appropriately. Lilian Weng frames the two dominant ReAct failure modes as **inefficient planning** (long trajectory, no convergence) and **hallucination** (consecutive identical actions yielding the same observation) ([Weng, "LLM-Powered Autonomous Agents"](https://lilianweng.github.io/posts/2023-06-23-agent/)).

---

## 6. Important Benchmarks

Conceptual coverage only — deep tool-calling/coding benchmarks (SWE-bench Verified, Aider, etc.) are covered in a sister document.

| Benchmark | What it measures | Methodological contribution |
|---|---|---|
| [**HELM** (Liang et al. 2022)](https://arxiv.org/abs/2211.09110) | 16 scenarios × 7 metrics (accuracy, calibration, robustness, fairness, bias, toxicity, efficiency) on foundation models | Top-down "scenarios × metrics" matrix; standardized prompting; full transparency of raw completions |
| [**BIG-bench** (Srivastava et al. 2022)](https://arxiv.org/abs/2206.04615) | 204 diverse tasks contributed by 450 authors | Crowdsourced, programmatic + JSON tasks, focus on tasks "beyond current capability" |
| [**MMLU-Pro** (Wang et al. 2024)](https://arxiv.org/abs/2406.01574) | Reasoning-focused multi-task understanding; 12K questions, 14 subjects, 10 options | Reduces prompt sensitivity from 4-5% (MMLU) to 2%; CoT actually helps (unlike on MMLU) |
| [**AgentBench** (Liu et al. 2023, ICLR'24)](https://arxiv.org/abs/2308.03688) | LLM-as-Agent across 8 environments (OS, DB, KG, card games, web, etc.) | First multi-environment agent benchmark; exposed long-horizon reasoning as the bottleneck |
| [**GAIA** (Mialon et al. 2023)](https://arxiv.org/abs/2311.12983) | 466 real-world assistant tasks needing reasoning + multimodality + web + tools | Designed so questions are easy for humans (92%) but hard for AIs (15% for GPT-4 + plugins); 3 difficulty tiers |
| [**SWE-bench** (Jimenez et al. 2023, ICLR'24)](https://arxiv.org/abs/2310.06770) | 2,294 real GitHub issues across 12 Python repos; agent must produce a passing patch | Unit-test-as-truth (no LLM-judge needed); inspired SWE-bench Verified, SWE-bench Pro |
| [**MLAgentBench** (Huang et al. 2023)](https://arxiv.org/abs/2310.03302) | 13 ML experimentation tasks; agent must improve a model end-to-end | Open-ended research task evaluation; ReAct framework baseline |
| [**τ-bench** (Yao et al. 2024, Sierra)](https://arxiv.org/abs/2406.12045) | Tool-Agent-User interaction in retail/airline domains; user simulated by LLM | First widely-adopted multi-turn tool benchmark with policy adherence; Pass^k metric |

**Methodology lessons that transfer to QualOps:**

- HELM's "scenarios × metrics" matrix is a useful template — define your QualOps scenarios (Python bugfix PRs, JS feature PRs, refactor PRs, security-sensitive PRs…) and grade each on the same 7-9 dimensions.
- SWE-bench's insight — *tests are ground truth* — applies directly: when QualOps fixes a bug, the existing test suite is the cheapest, most reliable judge.
- GAIA's tiered difficulty and human-baseline anchoring is a discipline against benchmark inflation.
- τ-bench's Pass^k (probability of passing on all k independent runs) is a strong reliability/determinism metric for stochastic agents.

[**"Establishing Best Practices for Building Rigorous Agentic Benchmarks"** (Zhuge et al. 2025)](https://arxiv.org/pdf/2507.02825) argues many published benchmarks fail two basic validity checks: **outcome validity** (test failure ⇎ task failure — SWE-bench-Verified is flagged because incorrect patches sometimes pass tests) and **task validity** (a task is solvable iff the agent has the target capability). Internal benchmarks should explicitly audit both.

---

## 7. Statistical Rigor

Why "vibes-based evals" fail: with N=10 examples and a stochastic model, swing of ±20% in pass rate is normal noise. Cameron Wolfe's ["Applying Statistics to LLM Evaluations"](https://cameronrwolfe.substack.com/p/stats-llm-evals) walks through the core math.

### 7.1 Sample size and CIs

For binary pass/fail with sample mean p and N samples, the 95% CI half-width is roughly `1.96 × sqrt(p(1-p)/N)`. To distinguish 80% from 85% accuracy at 95% confidence, you need ~1000 samples. Most teams have far fewer; this is why **paired comparisons** matter:

### 7.2 Paired comparisons

Run model A and model B on the *same* set of examples; the per-example difference cancels per-example variance. McNemar's test (for binary outcomes) or paired bootstrap (for any metric) yields tight CIs even on N=50-100.

### 7.3 Bradley-Terry / Elo for pairwise rankings

When the metric is "which model wins this pair?", the Bradley-Terry model fits a latent skill rating per model from observed pairwise outcomes ([Wikipedia: Bradley-Terry](https://en.wikipedia.org/wiki/Bradley%E2%80%93Terry_model); [Stanford Stats 200 lecture notes](https://web.stanford.edu/class/archive/stats/stats200/stats200.1172/Lecture24.pdf)).

- **Elo** updates ratings online with a learning rate; recent matches dominate.
- **Bradley-Terry** is the offline MLE; more stable, no recency bias ([Hippocampus's Garden, Elo vs BT](https://hippocampus-garden.com/elo_vs_bt/)).
- **Bootstrap CIs**: Chatbot Arena resamples the pairwise vote set 1000× and refits BT, producing 95% CIs on each rating ([Chatbot Arena paper, Chiang et al. 2024](https://arxiv.org/pdf/2403.04132)).

### 7.4 Eval variance sources

- **Sampling variance**: stochastic decoding (T>0).
- **Prompt variance**: small wording changes flip 5-20% of judgments ([MMLU-Pro analysis](https://arxiv.org/abs/2406.01574)).
- **Judge variance**: different judge models (or different runs of the same judge) disagree.
- **Data variance**: the eval set itself is a sample of the production distribution.

A practical rule: **report all four** when you publish an eval result internally. The Holistic Agent Leaderboard formalizes this with explicit variance decomposition ([HAL 2025](https://arxiv.org/pdf/2510.11977)).

---

## 8. Recent Academic Directions (2024-2026)

### 8.1 Process reward models everywhere

Beyond math, PRMs are being applied to coding agents, web agents, and multi-step retrieval. The trend is from discriminative classifiers toward **generative / reasoning PRMs** that produce a rationale ([R-PRM](https://arxiv.org/abs/2503.21295), [ThinkPRM / "Process Reward Models That Think"](https://arxiv.org/abs/2504.16828)).

### 8.2 Self-consistency, self-refinement, debate

- **Self-consistency** ([Wang et al. 2022](https://arxiv.org/abs/2203.11171)): sample N reasoning paths, take majority answer. +18 points on GSM8K. Doubles as a calibration signal.
- **Self-refinement / critique loops**: agent reviews and revises its own output. Risk of degradation if the critique is wrong.
- **Multi-agent debate** ([Irving et al. 2018](https://arxiv.org/abs/1805.00899); [Khan et al. 2024](https://arxiv.org/html/2603.05293)): two agents argue both sides; a (weaker) judge decides. Khan et al. show debate lets weaker judges accurately evaluate stronger debaters — a candidate scalable-oversight technique.
- **Doubly-Efficient Debate** ([Brown-Cohen et al. 2023](https://arxiv.org/abs/2311.14125)): theoretical guarantees on debate as alignment mechanism.

### 8.3 Constitutional methods

[Constitutional AI (Bai et al. 2022)](https://arxiv.org/abs/2212.08073) replaces human harmfulness labels with a written "constitution" the model uses to critique and revise its own outputs (RLAIF). Useful for *evaluation* too: the constitution doubles as a rubric. Critiques (digi-con, others) note its quality is bounded by the constitution's quality and that it may "embed subjective priorities" of the developer.

### 8.4 Automated red-teaming

[Perez et al. 2022, "Red Teaming Language Models with Language Models"](https://arxiv.org/abs/2202.03286) used an LM to generate adversarial prompts that elicit harms from a target LM, finding tens of thousands of failures in a 280B chatbot. OpenAI's [Diverse and Effective Red Teaming with Auto-generated Rewards](https://cdn.openai.com/papers/diverse-and-effective-red-teaming.pdf) extends this with RL and diversity rewards. For QualOps, the analog is **synthetic adversarial PRs** designed to elicit false positives or missed bugs.

### 8.5 Simulation-based evaluation

τ-bench's user simulator is the canonical example: an LLM plays the user, executing scripted goals, while the agent must follow domain policy. Simulations let you generate effectively unlimited multi-turn evaluation traffic at known ground truth ([Sierra τ-bench post](https://sierra.ai/blog/tau-bench-shaping-development-evaluation-agents)).

### 8.6 Agent-as-judge

The newest frontier. [**Agent-as-a-Judge: Evaluate Agents with Agents** (Zhuge et al. 2024)](https://arxiv.org/abs/2410.10934) replaces the LLM judge with an *agent* judge that can read code, run tools, and verify intermediate steps — closing the gap between "static text grading" and "dynamic behavior verification." They report agent-judge results approaching human reliability while costing far less. [**When AIs Judge AIs** (Yu et al. 2025)](https://arxiv.org/abs/2508.02994) surveys the rapid ecosystem evolution from single-LLM judges → multi-agent debate frameworks. [**A Survey on Agent-as-a-Judge** (2026)](https://arxiv.org/html/2601.05111v1) consolidates the methodology.

This is highly relevant to QualOps: the "Judge" stage in QualOps's pipeline already *is* an agent-as-judge over the Review/Fix output. Drawing on this literature, key design choices include: (a) give the judge agent independent tool access (re-run tests, re-read source) rather than just the diff, (b) use a different model family for the judge to avoid self-preference, (c) calibrate against a periodic human-review sample.

---

## Open Questions and Controversies

1. **Are LLM judges good enough as the primary signal?** Zheng et al. say yes (>80% human agreement). The "fine-tuned judges fail to generalize" results ([Huang et al. 2024](https://arxiv.org/html/2403.02839)) say maybe not. Production teams hedge by combining judges with periodic human review.
2. **Process supervision vs. outcome supervision for training.** Process wins for math, but it is not yet clear how to label process at scale for fuzzy domains like code review (what's a "correct" intermediate step when reviewing a PR?).
3. **Benchmark validity.** Recent audits ([Zhuge et al. 2025](https://arxiv.org/pdf/2507.02825); [Berkeley RDI on trustworthy benchmarks](https://rdi.berkeley.edu/blog/trustworthy-benchmarks-cont/)) show many published benchmarks have leakage, mis-graded items, or task-validity problems. The "SWE-Bench Illusion" paper ([2025](https://arxiv.org/html/2506.12286v3)) argues SOTA models are partly memorizing, not reasoning.
4. **Self-preference and ecosystem effects.** As more training data is judge-generated, judges may drift toward systematic preferences that the next generation of models is trained to satisfy — a feedback loop with unclear long-term effects.
5. **Cost of rigor.** Bootstrap CIs, paired evals, multi-judge ensembles, and red-team suites are expensive. Teams routinely skip them; "vibe checks" remain common despite being known to fail.

---

## References

- [**Anthropic, "Demystifying evals for AI agents" (2026)**](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — Engineering blog with practical agent-eval strategies, "20-50 tasks is enough to start" rule.
- [**Bai et al. 2022, "Constitutional AI: Harmlessness from AI Feedback" (arXiv:2212.08073)**](https://arxiv.org/abs/2212.08073) — Anthropic's foundational paper on RLAIF.
- [**Brown-Cohen et al. 2023, "Scalable AI Safety via Doubly-Efficient Debate" (arXiv:2311.14125)**](https://arxiv.org/abs/2311.14125) — Theoretical extension of debate as scalable oversight.
- [**Chiang et al. 2024, "Chatbot Arena: An Open Platform for Evaluating LLMs by Human Preference"**](https://arxiv.org/pdf/2403.04132) — Bradley-Terry methodology for crowdsourced LLM ranking with bootstrap CIs.
- [**Geng et al. 2025, "Uncertainty Quantification and Confidence Calibration in LLMs: A Survey" (arXiv:2503.15850)**](https://arxiv.org/abs/2503.15850) — Comprehensive survey of calibration methods (logit, sampling, verbalized).
- [**Huang et al. 2023, "MLAgentBench" (arXiv:2310.03302)**](https://arxiv.org/abs/2310.03302) — 13-task ML experimentation benchmark for AI research agents.
- [**Huang et al. 2024, "An Empirical Study of LLM-as-a-Judge" (arXiv:2403.02839)**](https://arxiv.org/html/2403.02839) — Shows fine-tuned judges (JudgeLM, Prometheus, Auto-J, PandaLM) underperform GPT-4 on generalization.
- [**Husain & Shankar, "LLM Evals: Everything You Need to Know" (Hamel's Blog, 2026)**](https://hamel.dev/blog/posts/evals-faq/) — Comprehensive FAQ from the AI Evals Maven course.
- [**Husain, "Your AI Product Needs Evals" (2024)**](https://hamel.dev/blog/posts/evals/) — Most-cited practitioner guide to building eval pipelines from scratch.
- [**Husain, "Using LLM-as-a-Judge for Evaluation" (2024)**](https://hamel.dev/blog/posts/llm-judge/) — Argues for binary pass/fail rubrics; debiasing tactics from 30+ deployments.
- [**Irving et al. 2018, "AI Safety via Debate" (arXiv:1805.00899)**](https://arxiv.org/abs/1805.00899) — Foundational paper on debate as alignment mechanism.
- [**Jimenez et al. 2023, "SWE-bench: Can Language Models Resolve Real-World GitHub Issues?" (arXiv:2310.06770)**](https://arxiv.org/abs/2310.06770) — 2,294 real GitHub issues; unit tests as ground truth. ICLR 2024 oral.
- [**Khalifa et al. 2025, "Process Reward Models That Think" (arXiv:2504.16828)**](https://arxiv.org/abs/2504.16828) — Generative PRM with verification CoT; data-efficient.
- [**Khan et al. 2024, "Knowledge Divergence and the Value of Debate for Scalable Oversight"**](https://arxiv.org/html/2603.05293) — Empirical evidence that debate helps weaker judges evaluate stronger debaters.
- [**Liang et al. 2022, "Holistic Evaluation of Language Models" (HELM, arXiv:2211.09110)**](https://arxiv.org/abs/2211.09110) — Stanford CRFM; canonical scenarios × metrics framework.
- [**Lightman et al. 2023, "Let's Verify Step by Step" (arXiv:2305.20050)**](https://arxiv.org/abs/2305.20050) — OpenAI's process-vs-outcome supervision study; PRM800K dataset.
- [**Liu et al. 2023, "G-Eval: NLG Evaluation using GPT-4" (arXiv:2303.16634)**](https://arxiv.org/abs/2303.16634) — CoT + form-filling rubric prompting; flagged self-preference bias for first time.
- [**Liu et al. 2023, "AgentBench: Evaluating LLMs as Agents" (arXiv:2308.03688)**](https://arxiv.org/abs/2308.03688) — First multi-environment LLM-agent benchmark; ICLR'24.
- [**Mialon et al. 2023, "GAIA: A Benchmark for General AI Assistants" (arXiv:2311.12983)**](https://arxiv.org/abs/2311.12983) — Meta/HuggingFace; tiered tasks with human baseline of 92%, GPT-4 at 15%.
- [**Panickssery et al. 2024, "Self-Preference Bias in LLM-as-a-Judge" (arXiv:2410.21819)**](https://arxiv.org/abs/2410.21819) — Quantifies self-preference; ties bias to text familiarity / perplexity.
- [**Perez et al. 2022, "Red Teaming Language Models with Language Models" (arXiv:2202.03286)**](https://arxiv.org/abs/2202.03286) — Anthropic; automated adversarial prompt generation.
- [**Shi et al. 2024, "Judging the Judges: Position Bias" (arXiv:2406.07791)**](https://arxiv.org/html/2406.07791v9) — Systematic study of position bias and "robustness rate" metric.
- [**Srivastava et al. 2022, "Beyond the Imitation Game (BIG-bench)" (arXiv:2206.04615)**](https://arxiv.org/abs/2206.04615) — 204 collaborative tasks; programmatic + JSON formats.
- [**Wang et al. 2022, "Self-Consistency Improves Chain-of-Thought" (arXiv:2203.11171)**](https://arxiv.org/abs/2203.11171) — Sample-and-marginalize decoding; +18 GSM8K. Foundational for consistency-based confidence.
- [**Wang et al. 2024, "MMLU-Pro" (arXiv:2406.01574)**](https://arxiv.org/abs/2406.01574) — Reasoning-focused, prompt-robust replacement for MMLU.
- [**Weng, "Extrinsic Hallucinations in LLMs" (Lil'Log, 2024)**](https://lilianweng.github.io/posts/2024-07-07-hallucination/) — Defines in-context vs. extrinsic hallucination; survey of mitigation.
- [**Weng, "LLM-Powered Autonomous Agents" (Lil'Log, 2023)**](https://lilianweng.github.io/posts/2023-06-23-agent/) — Canonical reference on agent architectures and ReAct failure modes.
- [**Willison, "Evals" tag on simonwillison.net**](https://simonwillison.net/tags/evals/) — 37+ posts on practical eval engineering.
- [**Wu et al. 2025, "R-PRM: Reasoning-Driven PRM" (arXiv:2503.21295)**](https://arxiv.org/abs/2503.21295) — Generative PRM with rationales; +11.9 F1 on ProcessBench.
- [**Yan, "Evaluating the Effectiveness of LLM-Evaluators" (eugeneyan.com, 2024)**](https://eugeneyan.com/writing/llm-evaluators/) — Survey of two dozen LLM-judge papers; when LLM-judge fails.
- [**Yan, "Patterns for Building LLM-based Systems & Products" (eugeneyan.com, 2023)**](https://eugeneyan.com/writing/llm-patterns/) — Seven patterns including evals; widely cited reference.
- [**Yan et al., "What We Learned from a Year of Building with LLMs" Parts I-III (O'Reilly, 2024)**](https://www.oreilly.com/radar/what-we-learned-from-a-year-of-building-with-llms-part-i/) — Practitioner consolidation of evals, ops, and strategy lessons.
- [**Yao et al. 2024, "τ-bench: Tool-Agent-User Interaction" (arXiv:2406.12045)**](https://arxiv.org/abs/2406.12045) — Sierra; multi-turn tool benchmark with simulated users and Pass^k metric.
- [**Ye et al. 2024, "Justice or Prejudice? Quantifying Biases in LLM-as-a-Judge" (arXiv:2410.02736)**](https://arxiv.org/html/2410.02736v1) — Catalogs 12 biases; CALM evaluation framework.
- [**Yu et al. 2025, "Evaluation and Benchmarking of LLM Agents: A Survey" (arXiv:2507.21504)**](https://arxiv.org/html/2507.21504v1) — Two-dimensional taxonomy: objectives × process.
- [**Yu et al. 2025, "When AIs Judge AIs: Agent-as-a-Judge for LLMs" (arXiv:2508.02994)**](https://arxiv.org/abs/2508.02994) — Survey of evolution from single-LLM judges to multi-agent debate.
- [**Zheng et al. 2023, "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena" (arXiv:2306.05685, NeurIPS 2023)**](https://arxiv.org/abs/2306.05685) — The seminal LLM-as-judge paper; introduced MT-Bench and Chatbot Arena; documented position/verbosity/self-enhancement biases.
- [**Zheng et al. 2025, "The Lessons of Developing Process Reward Models" (arXiv:2501.07301)**](https://arxiv.org/abs/2501.07301) — Practical lessons on PRM data quality and granularity.
- [**Zhuge et al. 2024, "Agent-as-a-Judge: Evaluate Agents with Agents" (arXiv:2410.10934)**](https://arxiv.org/abs/2410.10934) — Replaces static LLM judge with agentic judge; approaches human reliability.
- [**Zhuge et al. 2025, "Establishing Best Practices for Building Rigorous Agentic Benchmarks" (arXiv:2507.02825)**](https://arxiv.org/pdf/2507.02825) — Outcome-validity and task-validity audit framework.
- [**Holistic Agent Leaderboard (2025, arXiv:2510.11977)**](https://arxiv.org/pdf/2510.11977) — Variance-decomposed agent leaderboard methodology.
- [**Cameron Wolfe, "Applying Statistics to LLM Evaluations" (Substack)**](https://cameronrwolfe.substack.com/p/stats-llm-evals) — Practitioner-friendly walkthrough of CIs, paired tests, and Bradley-Terry.
- [**LangChain, "Trajectory Evaluations" docs**](https://docs.langchain.com/langsmith/trajectory-evals) and [**agentevals package**](https://github.com/langchain-ai/agentevals) — Concrete trajectory-eval API and metric implementations.
- [**Arize, "Agent Trajectory Evaluations"**](https://arize.com/docs/ax/evaluate/evaluators/trace-and-session-evals/trace-level-evaluations/agent-trajectory-evaluations) — Production trajectory-evaluation patterns.
- [**Ragas docs, "Available Metrics"**](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/) — Standard reference for faithfulness / answer-relevancy / context metrics.
- [**KDD 2025 Tutorial: Evaluation & Benchmarking of LLM Agents (SAP)**](https://sap-samples.github.io/llm-agents-eval-tutorial/) — Conference-grade tutorial covering the full taxonomy.
