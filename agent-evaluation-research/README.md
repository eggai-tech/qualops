# Agent Evaluation Research — folder index

This folder contains the deliverables for the QualOps agent-evaluation research project.

**Goal**: a comprehensive report on state-of-the-art approaches to measure and improve LLM-agent performance and reliability, plus a generalized concept we can apply to QualOps and similar projects.

**Out of scope**: continuous online self-improvement in production. We deploy fixed versions; improvement is offline between releases.

## Read in this order

1. **[REPORT.md](REPORT.md)** — main report (markdown, ~12,000 words). Synthesizes all four dossiers into a coherent narrative for a mixed engineering + leadership audience. Contains the executive summary, the QualOps Approach (Part 6), prerequisites, and the adoption roadmap.
2. **[report.html](report.html)** — interactive HTML version with sidebar navigation, embedded mermaid diagrams, and styled tables. Open in a browser. Print-to-PDF works well.
3. **Standalone diagrams** in [`diagrams/`](diagrams/) — three SVGs of the core concepts (three layers, QualOps architecture, two-tier eval cadence). These are extracted from the report for reuse in slides or external documents.

## Source dossiers

The main report is built on top of four primary-source research dossiers, each of which stands on its own as a deeper reference:

- **[sources/01-foundations.md](sources/01-foundations.md)** (~5,000 words) — Foundational concepts: agent vs. LLM eval, the three layers, dimensions of quality, the eval lifecycle, LLM-as-judge methodology and biases, statistical rigor, recent academic directions.
- **[sources/02-frameworks.md](sources/02-frameworks.md)** (~5,800 words) — Eval / observability framework landscape: deep dive on Langfuse, LangSmith, DeepEval, RAGAS, Braintrust, OpenAI Evals, Anthropic Console, Phoenix/Arize, W&B Weave, MLflow, Patronus, Promptfoo, Inspect AI, plus AgentOps / Helicone / LangWatch. Comparison matrix, fit-by-team-profile, CI integration patterns.
- **[sources/03-toolcalling-and-trajectory.md](sources/03-toolcalling-and-trajectory.md)** (~5,200 words) — Tool-calling and trajectory eval specifically: tool-call accuracy decomposition, trajectory metrics, outcome vs. process, major benchmarks (BFCL, τ-bench, ToolBench, WebArena, AgentBench, GAIA, the SWE-bench family, MLAgentBench, AppWorld, DevAI), code-agent specifics, agent-as-judge, replay testing, calibration under non-determinism, decision guide.
- **[sources/04-improvement.md](sources/04-improvement.md)** (~5,500 words) — Systematic agent improvement: error analysis methodology (Hamel Husain / Eugene Yan / Shreya Shankar), eval-driven loop, prompt engineering as discipline, automated prompt optimization (DSPy/MIPROv2, TextGrad, AdalFlow, SAMMO), few-shot mining, sub-agent decomposition and Skills, tool design, context engineering, reflection patterns, routing, fine-tuning / DPO, regression suites, data flywheel, code-review-agent specific patterns.

Each dossier ends with an annotated reference list of 30–50 primary sources (arXiv papers, vendor docs, practitioner blogs).

## Folder layout

```
agent-evaluation-research/
├── README.md                                # this file
├── REPORT.md                                # main synthesis report
├── report.html                              # interactive HTML version
├── diagrams/
│   ├── 01-three-layers.svg                  # the three-layer eval concept
│   ├── 02-qualops-architecture.svg          # pipeline + eval + improvement
│   └── 03-eval-cadence.svg                  # two-tier cadence
├── sources/
│   ├── 01-foundations.md
│   ├── 02-frameworks.md
│   ├── 03-toolcalling-and-trajectory.md
│   └── 04-improvement.md
├── assets/                                  # placeholder for additional assets
└── drafts/                                  # placeholder for working drafts
```

## TL;DR for someone with five minutes

- **What is the right approach?** Three layers (component / trajectory / outcome), two tiers (per-PR fast gate + nightly capability eval), one curated golden set (50–200 real PRs).
- **Tooling for QualOps specifically**: keep Langfuse; add Promptfoo for the per-PR CI gate; add Inspect AI for nightly capability eval. Don't migrate.
- **Improvement loop**: open-coding → axial coding → frequency-weighted prioritization. Apply the cheapest fix first (prompt → few-shot → tool → context → sub-agent → optimizer → fine-tune).
- **Stage-by-stage**: tool-call F1 for Analyze; location precision/recall for Review; SWE-bench-style harness for Fix; schema validation for Report; agreement-with-humans for Judge.
- **Statistical discipline**: pass^k with k≥5; paired comparison vs baseline; report 95% CI; refresh judge calibration quarterly.
- **Adoption**: ~10 weeks of phased engineering effort + ~$4,500/mo steady-state LLM costs.

Detailed reasoning for each of these is in [REPORT.md](REPORT.md).
