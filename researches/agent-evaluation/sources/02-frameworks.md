# Agent / LLM Evaluation Frameworks: Landscape Dossier

*Compiled May 8, 2026 for the QualOps internal research report.*

## 1. Scope and motivation

QualOps is an AI code-review tool with a multi-stage agentic pipeline (Analyze, Review, Fix, Report, Judge), built on the Claude Agent SDK, executed in CI on every pull request. It is fundamentally a **tool-calling workflow agent**: success depends on whether each stage emits the right tool calls, with the right arguments, in the right order, and produces a final review whose claims match ground-truth. The product already uses **Langfuse** for tracing, dataset runs, scorers, prompt management, and LLM-as-judge.

This dossier is not a sales pitch for any tool. It is a fair comparison so the team can either justify staying on Langfuse, swap to a tool that is better at one specific dimension, or layer a second tool on top (e.g. add `promptfoo` for CI gating while keeping Langfuse for tracing). For each framework we capture: identity, license, deployment model, primitives, agent / tool-call eval support, integration story (Python and TS/Node), pricing, and notable strengths and weaknesses, ending in a comparison matrix, fit-by-team-profile, CI patterns, and real-world case studies.

The space is moving fast. Two notable shifts since early 2025: OpenAI acquired Promptfoo in March 2026, and the Claude Agent SDK (formerly Claude Code SDK) became the default Anthropic agent harness. Some 2024-era guidance is already stale; we cite May 2026 docs where possible.

---

## 2. Tool-by-tool analysis

### 2.1 Langfuse (incumbent)

**What it is.** Open-source LLM engineering platform: tracing, datasets, experiments, scores / scorers, prompt management, playground, online LLM-as-a-judge. Integrates via OpenTelemetry plus native SDKs for Python and TypeScript.

**Maintainer / license.** Langfuse GmbH (YC W23). Core product is **MIT-licensed**; SCIM, audit logs, retention policies, enterprise SLAs require a commercial Enterprise Edition license.

**Deployment model.** Both. Langfuse Cloud (Hobby free, Core, Pro, Enterprise tiers) and full self-host on your own infra (Docker / Helm / AWS Marketplace). Self-host has no usage gate or license key for the OSS feature set.

**Primitives offered.**
- **Traces / observations**: spans, nested generations, tool calls, retrievals; OpenTelemetry-compatible.
- **Datasets / DatasetItems**: input + expected output rows; versioned.
- **Experiments / DatasetRuns**: a `task` function maps a DatasetItem to an output, an `evaluator` function scores it, and the run is persisted with run-level aggregates.
- **Scores**: universal eval primitive (NUMERIC, CATEGORICAL, BOOLEAN, TEXT) with name, value, optional comment, attached to a trace, observation, or dataset run.
- **LLM-as-a-judge**: managed online evaluators that can score traces, observations, or experiments; categorical and boolean output landed in early 2026; observation-level evals (Feb 2026 changelog) let judges score individual tool calls or retrievals rather than only whole traces.
- **Prompt management**: versioned prompts with labels (`production`, `staging`, etc.), pull from SDK, optional GitHub sync.

**Agent / tool-call eval.** Strong for trace-level inspection of tool calls. The Feb 2026 observation-level eval feature is exactly the primitive needed to score "did the Review stage call `read_file` with the right path" as a separate metric from "is the final Report correct." For *trajectory* assertions (this exact ordered sequence of calls), Langfuse does not ship a built-in `trajectory_match` evaluator the way LangSmith does; you write it yourself as a Python or TS evaluator function and post a score.

**Integration: TS / Node.** First-class. `@langfuse/tracing`, `@langfuse/otel`, `@opentelemetry/sdk-node` packages. Supports decorator, context manager, or manual `span.startObservation({ asType: 'tool' })`. `observeOpenAI()` wrapper for OpenAI tool-calling. Anthropic / Claude Agent SDK works through OTEL or manual spans.

**Integration: Python.** First-class, slightly more mature than TS. `@observe` decorator, dataset SDK, Experiments SDK with `run_experiment(...)` plus an evaluator function list.

**Pricing.** Self-host free for the OSS feature set (you pay only ClickHouse + Postgres + app infra, ~$3-4k/mo at medium scale per third-party estimates). Cloud Hobby free at 50k units/mo, Core / Pro starting around $59-199/mo, Enterprise from ~$2,499/mo with custom volume.

**Strengths.**
- OSS, MIT, no vendor lock-in.
- ClickHouse-backed, scales to billions of observations (Canva is the headline production reference; 2,300+ companies cited).
- TS and Python parity is genuinely close.
- Online evals on individual observations is one of the few platforms that treats tool calls as first-class scoring targets.
- Decoupled scorer model: any external scorer (RAGAS, DeepEval, custom) can post a Score over the SDK; you are not boxed into Langfuse's scorers.

**Weaknesses.**
- No built-in trajectory-match evaluator (write your own).
- Comparison UI for experiments is functional but less polished than Braintrust's diff viewer.
- Online prod evals require you to wire up the judge config and pay judge LLM cost yourself.
- Self-host operationally is non-trivial (ClickHouse + Postgres + workers + Redis).

---

### 2.2 LangSmith (LangChain)

**What it is.** Closed-source observability + eval platform from LangChain, designed around LangChain / LangGraph but framework-agnostic. Datasets, evaluators (offline and online), prompt hub, deployments, agent trajectory evals.

**Maintainer / license.** LangChain Inc. Proprietary SaaS; self-host available on Plus / Enterprise.

**Deployment.** SaaS (US, EU regions) and self-hosted (Plus / Enterprise tiers). No OSS edition.

**Primitives.**
- Traces with multi-turn / thread support.
- Datasets with versioning and splits.
- Evaluator templates: 30+ prebuilt (safety, response quality, **trajectory**, multimodal).
- Online evaluators that run on production traces.
- **Agent trajectory evaluators** (`agentevals` package, MIT-licensed, Python and TypeScript): `create_trajectory_match_evaluator` / `createTrajectoryMatchEvaluator` with strict, unordered, superset, and subset modes, plus an LLM-judged trajectory variant.
- Multi-turn evaluators that score whole user-agent threads.

**Agent / tool-call eval.** Best-in-class out of the box. The `agentevals` library is purpose-built for tool-call sequences: feed in two lists of OpenAI-format messages, get a 0/1 or LLM-judged score on whether the trajectories match. This is exactly the QualOps "did Stage X call the right tools" use case.

**Integration: TS / Node.** First-class. `langsmith` npm package, `agentevals` npm package. Works with any framework, but the LangChain JS SDK gets richest integrations.

**Integration: Python.** First-class. Same.

**Pricing (May 2026).** Developer plan free with 5k traces/mo and 1 seat. Plus plan: paid seats, 10k base traces/mo included, $2.50 per 1k base traces (14-day retention) or $5.00 per 1k extended traces (400-day retention). Enterprise custom. Self-host requires Plus or Enterprise.

**Strengths.**
- Best built-in agent trajectory eval primitives in the ecosystem.
- Mature: 2+ years older than most competitors, deep eval template library.
- Tight LangGraph integration if you ever want a managed agent runtime.

**Weaknesses.**
- Closed-source.
- Per-trace pricing penalizes verbose agentic apps (each PR run can produce hundreds of spans).
- Self-host is gated behind paid tier.
- LangChain ecosystem gravity: framework-agnostic in theory, opinionated in practice.

---

### 2.3 DeepEval (Confident AI)

**What it is.** Open-source pytest-style LLM eval framework with 40+ metrics: G-Eval (custom rubric judge), DAG (decision-graph judge), faithfulness, answer relevancy, RAG metrics, agentic metrics (task completion, tool correctness, tool argument correctness, agent trajectory).

**Maintainer / license.** Confident AI. Apache 2.0.

**Deployment.** OSS library + Confident AI commercial platform (managed datasets, traces, online eval, regression dashboard).

**Primitives.**
- `LLMTestCase` and `MLLMTestCase` classes, plug into `pytest` via `deepeval test run ...`.
- **G-Eval**: research-backed metric (Liu et al.) that lets you describe a custom criterion in natural language and get a 0-1 score with chain-of-thought reasoning.
- **DAG metric** for deterministic compound criteria.
- **Agent metrics**: `TaskCompletionMetric`, `ToolCorrectnessMetric`, agentic flow eval.
- Synthetic dataset generation.
- Confident AI platform: tracing (Python `@observe`, JS/TS `observe()` wrapper), online evaluation, regression detection, A/B comparison UI.

**Agent / tool-call eval.** Strong. `ToolCorrectnessMetric` checks whether expected tools were called, optionally including argument matching. Agent trajectory metrics are documented under "AI Agent Evaluation."

**Integration: TS / Node.** Available via `deepeval-ts` (npm), positioned as a TypeScript client to Confident AI; integrates with the Vercel AI SDK `experimental_telemetry`. Less mature than Python: the JS/TS client primarily covers tracing and posting eval data; the rich metric library still lives in Python.

**Integration: Python.** First-class. This is the home language.

**Pricing.** OSS free. Confident AI: free tier, paid plans (per Confident AI docs).

**Strengths.**
- Pytest fits engineer muscle memory; CI integration is one `pytest` command.
- Deep metric catalog including agentic ones.
- G-Eval is widely cited and battle-tested.

**Weaknesses.**
- TS support is thin compared to Python.
- Confident AI managed platform is less polished than Braintrust / Langfuse if you want a hosted UI.
- Some metrics ship default judge prompts that you must override for domain accuracy (general LLM-eval critique; see Hamel's "Revenge of the Data Scientist").

---

### 2.4 RAGAS

**What it is.** RAG-specific metrics library, originating from a 2023 arXiv paper. Reference implementations of context precision, context recall, faithfulness, answer relevancy, plus newer agent-flavoured metrics (tool-call accuracy, topic adherence, agent goal accuracy).

**Maintainer / license.** Exploding Gradients team. Apache 2.0.

**Deployment.** OSS Python library; no platform.

**Primitives.**
- `MultiTurnSample` / `SingleTurnSample` data classes.
- Reference-free RAG metrics (the original differentiator).
- Synthetic test-set generation.
- Optional integrations with Langfuse, LangSmith, Phoenix to post scores.

**Agent / tool-call eval.** Limited. RAGAS added a handful of agent metrics (e.g. `ToolCallAccuracy`, `AgentGoalAccuracy`) but it is not its strength. For QualOps these would supplement, not replace, a primary eval framework.

**Integration: TS / Node.** None official. Python only.

**Integration: Python.** First-class.

**Pricing.** OSS free.

**Strengths.**
- Best-in-class for **RAG** metrics specifically.
- Cheap to adopt as a *metric library* alongside Langfuse / LangSmith / Phoenix.
- Active research lineage.

**Weaknesses.**
- Python-only.
- Not a full platform: no UI, no dataset versioning, no observability.
- Agent eval is a recent bolt-on, not primary.
- For a coding-agent product like QualOps where retrieval is not the bottleneck, RAGAS is largely irrelevant.

---

### 2.5 Braintrust

**What it is.** Eval-as-code SaaS with a polished comparison / playground UI. Datasets, experiments, prompt playground, online eval, log capture, alerts. Storage layer is Brainstore, a custom OLAP database for AI traces.

**Maintainer / license.** Braintrust Data Inc. Proprietary. $80M Series B in February 2026.

**Deployment.** SaaS primarily. Self-host is an enterprise hybrid model (control plane in Braintrust cloud, API + Brainstore in your VPC); not OSS.

**Primitives.**
- Eval-as-code SDK (`Eval(...)` in Python or TS) where you define a dataset, a task function, and a list of scorers.
- Playground for prompt + model + dataset matrix testing.
- Comparison UI (side-by-side diff between two experiments) is the headline differentiator; non-technical users can review experiments and contribute test cases.
- Online evals on production logs, alerting on regressions.
- Custom scorers in Python or TS, plus library of built-ins.

**Agent / tool-call eval.** Good. Comparison UI surfaces tool-call diffs across runs. No trajectory-match library on par with `agentevals`, but the SDK-first design makes writing one easy.

**Integration: TS / Node.** First-class. `braintrust` npm package, full eval-as-code parity with Python.

**Integration: Python.** First-class.

**Pricing.** Free tier 1M trace spans, 10k scores, unlimited users, 14-day retention. Pro from $249/mo. Enterprise custom; self-host is enterprise-only.

**Strengths.**
- Best-in-class comparison UI; the experiment diff view is well-loved.
- TS and Python parity.
- High-profile production users: **Notion** (70 AI engineers, 10x increase in issues caught per day), **Stripe**, **Vercel**, **Zapier**, **Airtable**.
- Strong CI/CD story; pre-built GitHub Action.

**Weaknesses.**
- Closed-source.
- Self-host gated to enterprise only and is hybrid, not pure on-prem.
- Pricing scales with span volume; verbose agents get expensive.
- Online prod eval debugging is reportedly weaker than Arize / Langfuse.

---

### 2.6 OpenAI Evals (OSS) and Evals API (hosted)

**What it is.** Two products under one banner: (a) the original `openai/evals` GitHub repo, an OSS framework + benchmark registry; (b) the **Evals API** on platform.openai.com, a hosted product where you upload datasets and configure graders.

**Maintainer / license.** OpenAI. OSS repo MIT-licensed; hosted Evals API is a paid OpenAI platform feature.

**Deployment.** OSS repo runs anywhere. Evals API is OpenAI cloud only.

**Primitives.**
- Datasets uploaded via API.
- **Graders**: `string_check`, `text_similarity`, `python` (sandboxed Python grader function), `label_model` (LLM classification grader), `score_model` (LLM scoring with rubric).
- Templating: `{{ var }}` substitution into grader prompts.
- Agent evals guide (added 2025) with tool-trajectory grading patterns.

**Agent / tool-call eval.** The Evals API ships an "Evaluate agent workflows" guide with patterns for tool-call grading. The python grader can directly assert "expected tool sequence == actual tool sequence." Less batteries-included than `agentevals`.

**Integration: TS / Node.** Via the OpenAI SDK only; same surface across languages.

**Integration: Python.** Native; the OSS repo is Python.

**Pricing.** OSS free. Evals API billed against OpenAI usage (tokens for graders + storage).

**Strengths.**
- Hosted Evals API integrates trivially with OpenAI ecosystem and stored chat completions.
- Python grader is a clean escape hatch.
- Brand and continuity (OpenAI is unlikely to abandon it).

**Weaknesses.**
- Hosted evals are OpenAI-cloud-only; multi-vendor teams running Claude as the primary model must adapt.
- OSS repo activity has slowed; the framework is more of a benchmark archive than an active platform.
- No tracing / observability layer.

---

### 2.7 Anthropic eval tooling (Workbench, Claude Console, Claude Agent SDK patterns)

**What it is.** Anthropic does not ship a standalone evaluation product. Instead they offer:
- **Claude Console**: dashboard with trace inspection, integration analytics, debugging UI for tool calls and decisions; ships with Claude Agent SDK.
- **Workbench / Prompt Improver**: web UI for prompt iteration with sample-by-sample comparison.
- **Claude Agent SDK**: programmatic harness (TS and Python) with tool execution; pairs with the engineering blog post "Demystifying evals for AI agents" which recommends the Tasks / Trials / Transcripts pattern with 20-50 hand-curated tasks.
- **Managed Agents** (public beta April 2026): hosted agent runtime; observability surfaced via Console.

**Maintainer / license.** Anthropic. Proprietary. Claude Agent SDK is Apache 2.0.

**Deployment.** SaaS only.

**Primitives.**
- Console traces and analytics for Agent SDK runs.
- No first-party dataset / experiment / scorer abstraction. The Anthropic blog explicitly recommends using third-party eval frameworks; their position is "we will instrument and trace, you bring or build the eval harness."

**Agent / tool-call eval.** Console shows tool calls and lets you inspect failure modes, but scoring is not a built-in primitive. The "Demystifying evals" blog post is the canonical Anthropic recommendation: build small (20-50) hand-curated task sets, run multiple trials, grade transcripts with a mix of programmatic and LLM-as-judge methods, and treat eval as iterative.

**Integration: TS / Node.** Claude Agent SDK has a TypeScript SDK and a Python SDK; both hook into Console traces by default.

**Pricing.** Console included with Claude API access.

**Strengths.**
- Best-in-class for *guidance and patterns* via the engineering blog.
- Tightest fit for Claude Agent SDK users (which QualOps is).
- Console is "free" if you are already on Claude.

**Weaknesses.**
- Not a full eval platform; you still need Langfuse / Braintrust / similar for datasets, experiments, scoring infra.
- No CI gating, no programmatic scorer API (as of May 2026).

For QualOps specifically: this is a **complement** to Langfuse, not a replacement. The Anthropic blog patterns inform what we put inside the Langfuse experiments.

---

### 2.8 Phoenix (OSS) and Arize AX (commercial)

**What it is.** Phoenix is the OSS, OTEL-based observability + eval framework from Arize AI. Arize AX is the enterprise SaaS counterpart (managed infrastructure, alerts, online evals, agent copilots, compliance).

**Maintainer / license.** Arize AI. Phoenix is Apache 2.0.

**Deployment.** Phoenix self-host (Docker, Python `phoenix.launch_app()`, K8s), or Phoenix Cloud (managed). Arize AX is SaaS.

**Primitives.**
- OpenTelemetry-native tracing with **OpenInference** semantic conventions (AGENT and TOOL spans are first-class).
- Datasets, experiments, evaluators (LLM-as-judge, code, human label).
- Built-in instrumentation for Claude Agent SDK (Python and TS), OpenAI Agents SDK, LangGraph, Vercel AI SDK, Mastra, CrewAI, LlamaIndex, DSPy.
- Phoenix CLI for piping traces / datasets / prompts to Cursor, Claude Code, Codex CLI, Gemini CLI.

**Agent / tool-call eval.** Strong. OpenInference semantic conventions explicitly model AGENT, TOOL, RETRIEVER, CHAIN, LLM span kinds. Phoenix UI can score any span. Out-of-the-box Claude Agent SDK instrumentation captures tool spans automatically.

**Integration: TS / Node.** Yes. `@arizeai/openinference-instrumentation-anthropic`, Vercel AI SDK auto-instrumentation, OTEL pipeline.

**Integration: Python.** First-class.

**Pricing.** Phoenix OSS is free. Arize AX is custom enterprise pricing.

**Strengths.**
- Most rigorous OTEL story; the "switch your backend without changing instrumentation" pitch holds.
- Vendor-agnostic: ingests traces from anywhere that speaks OpenInference / OTLP.
- Strong agent semantic conventions.
- OSS self-host is genuinely usable, not crippleware.

**Weaknesses.**
- UI is functional but less polished than Braintrust.
- Eval features are less mature than the observability features.
- Two-product split (Phoenix vs AX) creates feature gaps you only discover at sales time.

For QualOps: a credible replacement candidate for Langfuse if OTEL portability is a hard requirement. Otherwise, Langfuse covers the same ground with arguably better experiment ergonomics.

---

### 2.9 Weights & Biases Weave

**What it is.** W&B's GenAI sub-product: tracing (`@weave.op` decorator), evaluations (`weave.Evaluation`), prompt experimentation, cost / latency tracking. Sits on top of W&B's existing experiment-tracking infra.

**Maintainer / license.** Weights & Biases (acquired by CoreWeave 2024). Apache 2.0 SDK; managed service is paid.

**Deployment.** SaaS primarily; W&B Server self-host available on enterprise.

**Primitives.**
- `@weave.op` decorator auto-traces any Python (and TS) function call, including nested LLM calls.
- `weave.Evaluation` class with dataset + scorers + model.
- Built-in scorers, custom scorers, LLM judges.
- Comparison view across model / prompt / config combinations.

**Agent / tool-call eval.** Possible but not a focus. Trace UI shows nested ops; no trajectory-match primitive shipped.

**Integration: TS / Node.** TypeScript SDK exists but is younger and less complete than Python.

**Integration: Python.** First-class; this is the home.

**Pricing.** Free tier with limits; paid via W&B contracts.

**Strengths.**
- If your org already uses W&B for ML experiment tracking, the on-ramp is one decorator.
- Cost / latency tracking out of the box.

**Weaknesses.**
- Eval is not the center of the product; Braintrust / Langfuse have richer eval workflows.
- TS SDK lags Python.
- W&B's pricing is opaque and notoriously rises with scale.

---

### 2.10 MLflow LLM evals

**What it is.** Databricks-led OSS ML platform that added a GenAI evaluation track in 2024-2025. `mlflow.genai.evaluate()` is the primary entry point.

**Maintainer / license.** Databricks + community. Apache 2.0.

**Deployment.** OSS self-host or Databricks managed. Most "MLflow GenAI" features are available OSS, with deeper agent monitoring on Databricks.

**Primitives.**
- Built-in scorers (correctness, relevance, safety, helpfulness) and LLM judges.
- Custom judges with prompt + rubric.
- Automatic evaluation: judges run on traces and multi-turn conversations as they are logged.
- Dataset and experiment objects (inherited from classic MLflow).
- "Evaluation-Driven Development" framing.

**Agent / tool-call eval.** Has agent-aware scorers; Databricks-specific docs reference scoring tool decisions. Less battle-tested than LangSmith trajectory evals.

**Integration: TS / Node.** Limited. MLflow's GenAI tracing has a TS package but is Python-first.

**Integration: Python.** First-class.

**Pricing.** OSS free; Databricks pricing for the managed product.

**Strengths.**
- Natural fit if you already use MLflow for classical ML pipelines.
- Open standard, self-hostable.
- Databricks gravity if your data lives there.

**Weaknesses.**
- Outside Databricks shops, mindshare is low.
- TS support is weak.
- Platform is broad; GenAI evals are one feature among many, not the focus.

---

### 2.11 Patronus AI

**What it is.** Judge-as-a-service. Fine-tuned evaluator models (notably **GLIDER**, a 3.8B parameter rubric-following judge with ~1s latency) plus a managed platform for hallucination detection, safety, RAG metrics, and custom rubric scoring. Recently added the first multimodal LLM-as-judge.

**Maintainer / license.** Patronus AI (Series A startup). Proprietary models; open SDKs.

**Deployment.** SaaS API + MCP server. No OSS judge models.

**Primitives.**
- Pre-trained judge endpoints (hallucination, safety, format, custom rubric).
- GLIDER as a low-latency rubric-driven judge.
- Tracing + alerting via the platform.
- Reported 91% agreement with human judgments on benchmarks they publish.

**Agent / tool-call eval.** Indirect. You score the agent output with a Patronus judge; Patronus does not own the trace / dataset layer. Etsy and Gamma are headline case studies.

**Integration: TS / Node.** Via REST + SDKs; supported.

**Integration: Python.** First-class.

**Pricing.** Per-call, not publicly listed; sales-driven.

**Strengths.**
- Specialized judge models give faster, cheaper scoring than calling GPT-5 / Claude as judge.
- Strong on multimodal evaluation if you ever need it.
- MCP-server form factor fits the 2026 toolchain.

**Weaknesses.**
- You still need a host platform for traces, datasets, experiments.
- Vendor lock-in on judge models; opaque inner workings of GLIDER.
- For text-only code review like QualOps, the multimodal angle is irrelevant.

Patronus is a **scorer plug-in**, not a Langfuse replacement.

---

### 2.12 Promptfoo

**What it is.** CLI + library for prompt and agent eval, configured in a single `promptfooconfig.yaml`. Test cases as YAML, asserts as YAML, providers as YAML. Used by OpenAI and Anthropic in their own pipelines. Strong red-team / security-test suite. **OpenAI acquired Promptfoo in March 2026**; product remains MIT-licensed and open source.

**Maintainer / license.** Promptfoo (now OpenAI). MIT.

**Deployment.** Local CLI + optional cloud. Trivially self-hostable.

**Primitives.**
- YAML config: prompts, providers, test cases (`vars`), asserts (`equals`, `contains`, `llm-rubric`, `javascript`, `python`, `model-graded-closedqa`, etc.).
- CLI: `promptfoo eval -c promptfooconfig.yaml -o results.json`.
- Web viewer for results.
- GitHub Action: `promptfoo/promptfoo-action` posts a PR comment with diff.
- Red-team / pentesting suite (prompt injection, jailbreak, data leakage).

**Agent / tool-call eval.** Supports asserting on tool calls via custom JS / Python asserts and via the agent providers. Claude Agent SDK is a first-class provider. Less semantically rich than `agentevals` or DeepEval's `ToolCorrectnessMetric`, but flexible.

**Integration: TS / Node.** First-class. Runs via `npx promptfoo`. Custom asserts can be JS.

**Integration: Python.** Custom asserts can be Python; otherwise it is a CLI you call from anywhere.

**Pricing.** OSS free. Promptfoo Cloud / Enterprise tiers exist.

**Strengths.**
- Lowest-effort CI gating in the entire space. Drop a YAML, add the GitHub Action, done.
- 350k developers, 130k MAU, 25% Fortune 500 reach as of acquisition announcement: serious adoption.
- Red-team / security suite is a genuine bonus for any code-review tool that processes untrusted input.
- MIT license, no platform required.

**Weaknesses.**
- YAML scales poorly past a few hundred test cases; you end up generating it.
- Not an observability platform. No live traces.
- "Used by OpenAI" headline aside, the OpenAI acquisition introduces some governance uncertainty for Anthropic-first shops.

For QualOps: serious candidate as a **CI-only thin layer**, complementary to Langfuse, especially for prompt-level regression gates and security-style tests.

---

### 2.13 Inspect AI (UK AI Safety Institute)

**What it is.** Research-grade Python eval framework for frontier models, originally built by UK AISI in collaboration with Meridian Labs. Adopted by Anthropic, DeepMind, and Grok for internal evals. Three core abstractions: `Dataset`, `Solver`, `Scorer`.

**Maintainer / license.** UK AISI. MIT.

**Deployment.** OSS Python library; runs anywhere. Optional Inspect View web UI.

**Primitives.**
- `Dataset` (samples with input + target + metadata).
- `Solver` (chain of pluggable steps that produce an answer; includes ReAct, Deep Agent, custom agents).
- `Scorer` (programmatic or LLM judge).
- `SandboxEnvironment` abstraction for executing model-generated code or shell commands safely.
- Built-in tools (`bash`, `python`, `text editor`, `web search`, `web browse`, computer-use), MCP tool support, custom tool support.
- `inspect_evals` companion repo with 200+ pre-built evaluations (capability, agentic, reasoning, knowledge).
- Built-in agent primitives: ReAct, Deep Agent (long-horizon, sub-agents, memory), and **Agent Bridge** for plugging in external agents (Claude Code, Codex CLI, Gemini CLI).
- May 8 2026 (today): community contributions move to a `/register/` folder with YAML-based PR submission.

**Agent / tool-call eval.** Best-in-class for *agentic capability evals* (frontier-model style). Sandbox-grounded tool execution + scorers that can inspect transcripts make it well-suited to "did the agent navigate this codebase correctly" tasks. Hamel Husain endorses it for serious eval work.

**Integration: TS / Node.** None. Python only.

**Integration: Python.** First-class. This is the home.

**Pricing.** Free.

**Strengths.**
- Used by every frontier lab; battle-tested at the hardest end of the spectrum.
- Sandbox + Agent Bridge means you can wrap Claude Code or QualOps' own agent and run capability evals on it without modifying the agent.
- 200+ pre-built evals as a starting library.
- Excellent reproducibility: experiment artifacts are deterministic.

**Weaknesses.**
- Python only.
- Research / safety framing rather than product-CI framing; ergonomics for "fail the PR if score drops" are DIY.
- No managed observability; you persist to local files / your own backend.

For QualOps: a strong **research / nightly capability eval** option, complementary to Langfuse for trace-driven product eval.

---

### 2.14 Niche options: AgentOps, Helicone, LangWatch

**AgentOps.** Agent-first observability, supports 400+ LLMs and major frameworks, "time-travel debugging" (replay agent state). Reasonable choice if you have many heterogeneous agents to debug. Reported ~12% overhead.

**Helicone.** Proxy-based observability (Apache 2.0). Zero-SDK-changes onboarding through a gateway. **As of 2026 the upstream platform is in maintenance mode**; existing users have a 6-12 month migration window. Avoid for new deployments.

**LangWatch.** Real-time LLM observability with built-in evaluations and accurate cost attribution. Less mature than Langfuse, but a credible option for teams that want a single product instead of an OSS-plus-judges stack.

None of these is a serious primary candidate for QualOps given the Langfuse incumbency, but they are reasonable to mention to stakeholders who ask.

---

## 3. Comparison matrix

Legend: white check (yes / strong), warning (partial / caveat), red X (no / weak).

| Framework | OSS license | Self-host | Agent trajectory eval | Tool-call scoring | LLM-as-judge built in | Online prod eval | CI integration | TS-native | Py-native | Dataset versioning | A/B comparison UI | Cost (free tier) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Langfuse** | white check (MIT) | white check (free) | warning (DIY trajectory match) | white check (observation-level evals, Feb 2026) | white check | white check | white check (experiment-action / SDK) | white check | white check | white check | warning (basic diff) | white check (50k units/mo) |
| **LangSmith** | red X | white check (Plus+) | white check (`agentevals`) | white check | white check (30+ templates) | white check | white check | white check | white check | white check | white check | white check (5k traces/mo) |
| **DeepEval / Confident AI** | white check (Apache 2.0 lib) | warning (lib yes, platform paid) | white check (Python) | white check (`ToolCorrectnessMetric`) | white check (G-Eval, DAG) | white check (Confident AI) | white check (`pytest`) | warning (thin) | white check | white check | white check (Confident AI) | white check (OSS lib) |
| **RAGAS** | white check (Apache 2.0) | white check | warning (recent) | warning (`ToolCallAccuracy`) | white check (judges per metric) | red X | warning (via host) | red X | white check | red X | red X | white check |
| **Braintrust** | red X | warning (enterprise hybrid) | warning (DIY in SDK) | white check (good in UI) | white check | white check | white check (GitHub Action) | white check | white check | white check | white check (best-in-class) | white check (1M spans/mo) |
| **OpenAI Evals API** | white check (OSS repo MIT) | white check (repo) / red X (API) | warning (DIY via python grader) | warning (DIY) | white check (model graders) | warning | warning | warning (via SDK) | white check | white check | warning | white check (OSS) / paid (API) |
| **Anthropic Console / Agent SDK** | warning (SDK Apache 2.0) | red X (Console SaaS) | red X | red X (inspect only) | red X | red X | red X | white check | white check | red X | red X | included with Claude API |
| **Phoenix / Arize AX** | white check (Phoenix Apache 2.0) | white check (Phoenix) | warning (span-level, DIY) | white check (OpenInference TOOL spans) | white check | white check (AX) | white check | white check | white check | white check | warning | white check |
| **W&B Weave** | white check (SDK Apache 2.0) | warning (W&B Server enterprise) | warning | warning | white check | warning | white check | warning (younger TS) | white check | white check | white check | white check (limits) |
| **MLflow GenAI** | white check (Apache 2.0) | white check | warning | warning | white check | white check (auto-eval) | white check | red X | white check | white check | warning | white check |
| **Patronus AI** | red X | red X | red X (judge only) | warning (custom rubric) | white check (specialized models) | white check | warning | white check | white check | red X | red X | sales |
| **Promptfoo** | white check (MIT) | white check | warning (custom asserts) | warning (custom asserts, Claude SDK provider) | white check (`llm-rubric`) | red X | white check (best-in-class GitHub Action) | white check | white check | warning (YAML files) | white check (web viewer) | white check |
| **Inspect AI** | white check (MIT) | white check | white check (sandbox + scorer) | white check (built-in tools, MCP) | white check | red X | warning (custom) | red X | white check | white check | warning (Inspect View) | white check |
| **AgentOps** | warning (SDK OSS) | warning | white check (time-travel) | white check | white check | white check | warning | white check | white check | white check | white check | white check |
| **Helicone** | white check (Apache 2.0) | white check | red X | warning | warning | white check | warning | white check | white check | white check | warning | maintenance mode |
| **LangWatch** | white check (Apache 2.0 lib) | warning | warning | warning | white check | white check | warning | white check | white check | white check | white check | white check |

---

## 4. Good fit / bad fit by team profile

### 4.1 Small team, CI-gated, Node/TS app, on Claude (== QualOps)

**Recommended primary**: stay on **Langfuse**, complement with **Promptfoo** in CI for fast prompt-regression gating.

Why: Langfuse's MIT license + self-host + ClickHouse + observation-level LLM-as-judge (Feb 2026) covers tracing, datasets, experiments, online evals, and prompt management for free at small scale. Promptfoo's GitHub Action gives a per-PR YAML-driven gate with a PR comment view that Langfuse alone doesn't deliver. The two integrate: Promptfoo runs deterministic / fast-judge asserts on each PR; Langfuse stores the longer-running experiments and production traces and lets you spot drift over time.

Add **Inspect AI** (or write your own using `agentevals` patterns) for nightly capability evals against a held-out task set. Use Anthropic's "Demystifying evals" Tasks / Trials / Transcripts pattern as the structural blueprint inside Langfuse experiments.

Do **not** rip and replace Langfuse for LangSmith or Braintrust unless you discover a specific feature gap; the marginal UX wins do not justify a closed-source migration for a small team.

### 4.2 Small / mid team, Python-only, RAG-heavy

**Primary**: **DeepEval** + **RAGAS** (metric library) + your choice of host (Phoenix or Langfuse).

Why: RAGAS for the canonical RAG metrics, DeepEval's pytest harness for CI gating, Phoenix for OTEL-based observability and OSS self-host. Avoid Braintrust unless you specifically want the comparison UI.

### 4.3 Large org, many agents, dedicated SREs, vendor procurement OK

**Primary**: **Braintrust** for product teams, **Phoenix / Arize AX** for the platform / SRE team.

Why: Braintrust's diff UI scales to 70+ engineers (Notion case study) and lets product / non-engineering reviewers contribute test cases. Arize AX gives the SRE team enterprise compliance, alerts, online eval, and an OTEL pipeline. The two coexist: Braintrust for pre-deploy eval, Arize for post-deploy observability.

### 4.4 LangChain / LangGraph shop

**Primary**: **LangSmith**.

Why: deepest framework integration, best agent trajectory primitives, and the multi-turn evaluators map directly to LangGraph state machines. Per-trace pricing is a constraint; budget accordingly.

### 4.5 Frontier-lab / safety-focused / research org

**Primary**: **Inspect AI**.

Why: it is what the labs already use. Pair with custom storage for any required trace persistence.

### 4.6 OpenAI-only shop

**Primary**: **OpenAI Evals API** + **Promptfoo**.

Why: Evals API is the path of least resistance for OpenAI-stored chat completions. Promptfoo for CI. No real downside until you go multi-model.

### 4.7 Already on W&B for ML, adding LLM features

**Primary**: **W&B Weave**, supplemented by RAGAS / DeepEval metrics if needed.

Why: amortized onboarding cost. Re-evaluate after 12 months when LLM features outgrow ML features.

### 4.8 Bad fits to avoid

- **Helicone** for new deployments (maintenance mode).
- **Patronus** as a primary platform (it is a scorer, not a platform).
- **OpenAI Evals OSS repo** as an active framework (slow upstream activity; treat it as a benchmark archive).
- **Single-tool maximalism**: every successful 2025-2026 case study (Notion / Stripe / Canva) combines tools. Plan for two or three.

---

## 5. CI integration patterns

### 5.1 Langfuse

**Pattern**: GitHub Actions calls a Python or TS script that runs the Langfuse `experiment-action` or the SDK `runExperiment(...)`. The experiment iterates a Dataset, calls the agent (the QualOps `Analyze->Review->Fix` pipeline), and runs evaluators. The script asserts on aggregate scores and exits non-zero on regression.

```yaml
# .github/workflows/qualops-eval.yml
on: pull_request
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npx tsx scripts/run-langfuse-eval.ts
        env:
          LANGFUSE_PUBLIC_KEY: ${{ secrets.LANGFUSE_PUBLIC_KEY }}
          LANGFUSE_SECRET_KEY: ${{ secrets.LANGFUSE_SECRET_KEY }}
          LANGFUSE_HOST: ${{ secrets.LANGFUSE_HOST }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

The script posts a PR comment with the dataset run URL and asserts `mean_score >= baseline - tolerance`.

### 5.2 LangSmith

**Pattern**: `langsmith` SDK has `pytest` integration; you write tests as `@pytest.mark.langsmith` decorated functions; CI runs `pytest`. For Node: `langsmith` SDK `evaluate(...)` API in any test framework.

### 5.3 DeepEval

**Pattern**: pytest. Single command:

```yaml
- run: deepeval test run tests/eval_qualops.py
```

Tests use `assert_test(test_case, [ToolCorrectnessMetric(), GEval(...)])`. Confident AI auto-stores the run.

### 5.4 Braintrust

**Pattern**: Pre-built `braintrust-eval` GitHub Action; runs `braintrust eval src/evals/*.eval.ts` and posts a PR comment with the experiment diff URL.

### 5.5 Promptfoo

**Pattern**: `promptfoo/promptfoo-action`. Diffs `promptfooconfig.yaml` test results between base and PR branches, posts PR comment.

```yaml
- uses: promptfoo/promptfoo-action@v1
  with:
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    config: promptfooconfig.yaml
```

### 5.6 OpenAI Evals API

**Pattern**: REST call from CI. `POST /v1/evals` to create, `POST /v1/evals/{id}/runs` to run. Poll for completion, fail the job on threshold violation.

### 5.7 Phoenix

**Pattern**: Phoenix CLI. `phoenix experiments run --dataset ... --task ... --evaluators ...`. CI script asserts on returned metrics.

### 5.8 Inspect AI

**Pattern**: `inspect eval my_task.py --model anthropic/claude-sonnet-4-5 --log-dir ./logs`. Parse the JSON log file for pass/fail.

### 5.9 GitLab CI

All of the above port directly. The only adjustment is using `rules` and `script` blocks; no tool ships a GitLab-only integration.

### 5.10 Recommended pattern for QualOps

A two-tier setup:

1. **Per-PR (fast tier, ~2-5 min)**: Promptfoo YAML with ~30 small assertions on the output of each pipeline stage; runs as a required GitHub check.
2. **Nightly (slow tier, ~30-60 min)**: Langfuse experiment over a 100-200 item dataset, running the full pipeline, with LLM-as-judge scorers on the final report and `ToolCorrectness`-style scorers on each stage. Posts a Slack message and writes to the Langfuse experiments dashboard.

This gives developers fast PR feedback and the team a slower, deeper nightly truth.

---

## 6. Real-world usage and case studies

- **Canva** runs production AI design features through Langfuse. Headline reference on `langfuse.com`.
- **Notion** built its AI evaluation system on Braintrust; 70 engineers, 10x increase in caught issues per day going from JSONL files to Braintrust workflows; ZenML LLMOps Database has the full write-up.
- **Stripe**, **Vercel**, **Zapier**, **Airtable** are listed Braintrust customers per Braintrust marketing pages.
- **Etsy** uses Patronus AI's multimodal LLM-as-judge for image captioning quality; Patronus published the case study.
- **Gamma** uses Patronus for automated evals and rigorous experimentation; Patronus published the case study.
- **Anthropic, DeepMind, Grok** are documented users of Inspect AI (per UK AISI announcement and Hamel Husain's notes). Anthropic also documents in "Demystifying evals for AI agents" how internal teams build small (20-50 item) eval task sets.
- **OpenAI and Anthropic** both ship Promptfoo as part of their internal eval pipelines per the Promptfoo GitHub README.
- **AI Engineer Europe 2026** (April 8-10, London) had an Evals & Observability track. **AI Engineer World's Fair 2026** (June 29-July 2, San Francisco) is the upcoming flagship.
- **Hamel Husain & Shreya Shankar** teach the "AI Evals For Engineers & PMs" course on Maven; Bryan Bischof of Hex AI gave the "Failure as a Funnel" talk at Data Council 2025 on agent failure-mode analysis.
- **Vanishing Gradients podcast** Episode 60: "10 Things I Hate About AI Evals with Hamel Husain" - argues against generic off-the-shelf eval frameworks and for application-specific metrics.

---

## 7. Recommendations for QualOps

**Keep**: Langfuse as the primary eval and observability backbone. The Feb 2026 observation-level LLM-as-judge feature and the recent boolean / categorical scoring landed exactly the primitives a tool-calling pipeline needs.

**Add**: Promptfoo as a thin per-PR CI gate. YAML config can live in the repo; tests run in 2-5 minutes; the PR comment view is a developer-experience win Langfuse alone does not provide.

**Add (optional)**: a small Inspect AI nightly task set (20-50 hand-curated tasks) for capability eval, modeled on Anthropic's "Demystifying evals" pattern. Run weekly, not per-PR. Inspect's `Agent Bridge` lets you wrap the QualOps agent without modifying it.

**Consider only if a specific gap appears**:
- LangSmith if you find yourself reimplementing trajectory-match logic and the procurement / closed-source tradeoff is acceptable.
- Braintrust if non-engineering reviewers (product, design) need to contribute test cases through a UI.
- Phoenix if a customer or compliance requirement demands strict OTEL portability.

**Do not**: replace Langfuse outright. The cost-benefit math for a small team in CI on Node/TS does not justify it given Langfuse's current feature set.

---

## 8. References

### Framework documentation

- [Langfuse - Evaluation overview](https://langfuse.com/docs/evaluation/overview) - canonical eval docs index.
- [Langfuse - Datasets](https://langfuse.com/docs/evaluation/experiments/datasets) - dataset and experiment data model.
- [Langfuse - LLM-as-a-Judge](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge) - online judge configuration.
- [Langfuse - Observation-level evals (Feb 2026)](https://langfuse.com/changelog/2026-02-13-observation-level-evals) - tool-call-level scoring landed.
- [Langfuse - Boolean LLM-as-a-Judge Scores (Apr 2026)](https://langfuse.com/changelog/2026-04-08-boolean-llm-as-a-judge-scores) - boolean output added.
- [Langfuse - TypeScript SDK overview](https://langfuse.com/docs/observability/sdk/typescript/overview) - Node integration.
- [Langfuse - Self-hosted pricing](https://langfuse.com/pricing-self-host) - MIT-licensed self-host detail.
- [Langfuse - GitHub repo](https://github.com/langfuse/langfuse) - source code.
- [LangSmith - Evaluation docs](https://docs.langchain.com/langsmith/evaluation) - canonical eval docs.
- [LangSmith - Trajectory evaluations](https://docs.langchain.com/langsmith/trajectory-evals) - agent trajectory primitives.
- [agentevals GitHub repo](https://github.com/langchain-ai/agentevals) - readymade trajectory evaluators (Python + TS).
- [LangSmith - Insights Agent + Multi-turn Evals](https://blog.langchain.com/insights-agent-multiturn-evals-langsmith/) - multi-turn eval announcement.
- [LangSmith - Pricing](https://www.langchain.com/pricing) - 2026 tiers.
- [DeepEval homepage](https://deepeval.com/) - product entry point.
- [DeepEval - AI agent evaluation guide](https://deepeval.com/guides/guides-ai-agent-evaluation) - agent metrics walkthrough.
- [DeepEval GitHub repo](https://github.com/confident-ai/deepeval) - source.
- [deepeval-ts on npm](https://www.npmjs.com/package/deepeval-ts) - TypeScript client.
- [Confident AI - JS/TS observability](https://documentation.confident-ai.com/llm-observability/integrations/typescript) - TS tracing wrapper.
- [RAGAS docs](https://docs.ragas.io/en/stable/) - canonical metrics docs.
- [RAGAS - Available metrics](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/) - including agent metrics.
- [Ragas arXiv paper](https://arxiv.org/abs/2309.15217) - 2023 source paper.
- [Braintrust homepage](https://www.braintrust.dev/) - product.
- [Braintrust - Pricing](https://www.braintrust.dev/pricing) - tiers.
- [Braintrust - Notion case study](https://www.braintrust.dev/blog/notion) - 70 engineers, 10x more issues caught.
- [OpenAI - Evals API guide](https://developers.openai.com/api/docs/guides/evals) - hosted Evals API.
- [OpenAI - Agent evals guide](https://developers.openai.com/api/docs/guides/agent-evals) - agent workflow eval patterns.
- [OpenAI - Graders reference](https://developers.openai.com/api/docs/guides/graders) - all grader types.
- [OpenAI - openai/evals GitHub repo](https://github.com/openai/evals) - OSS framework + benchmark registry.
- [Anthropic - Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) - the canonical agent-eval guide from Anthropic engineering.
- [Anthropic - Building agents with the Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk) - SDK patterns.
- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) - SDK docs.
- [Phoenix homepage](https://phoenix.arize.com/) - Phoenix landing.
- [Phoenix GitHub repo](https://github.com/Arize-ai/phoenix) - source.
- [Phoenix - Claude Agent SDK (TypeScript) integration](https://arize.com/docs/phoenix/integrations/typescript/claude-agent-sdk) - direct integration.
- [Phoenix - Claude Agent SDK (Python) integration](https://arize.com/docs/phoenix/integrations/python/claude-agent-sdk) - Python.
- [Phoenix CLI](https://arize.com/docs/phoenix/sdk-api-reference/typescript/arizeai-phoenix-cli) - CLI for piping traces and datasets.
- [W&B Weave docs](https://docs.wandb.ai/weave) - Weave product docs.
- [W&B Weave GitHub](https://github.com/wandb/weave) - source.
- [MLflow GenAI evals](https://mlflow.org/genai/evaluations) - LLM and agent evaluation entry point.
- [MLflow - Automatic evaluation](https://mlflow.org/docs/latest/genai/eval-monitor/automatic-evaluations/) - judges on traces.
- [Patronus AI homepage](https://www.patronus.ai/) - product.
- [Patronus AI - LLM judges docs](https://docs.patronus.ai/docs/tutorials/evals/llm_judges) - judge integration.
- [Patronus AI - Etsy case study](https://www.patronus.ai/case-studies/etsy-leveraging-patronus-ais-multimodal-llm-as-a-judge-to-optimize-image-captionin) - production reference.
- [Promptfoo homepage / docs](https://www.promptfoo.dev/) - canonical entry.
- [Promptfoo - GitHub Action integration](https://www.promptfoo.dev/docs/integrations/github-action/) - PR-comment workflow.
- [promptfoo-action GitHub repo](https://github.com/promptfoo/promptfoo-action) - the Action source.
- [Promptfoo - Claude Agent SDK provider](https://www.promptfoo.dev/docs/providers/claude-agent-sdk/) - first-class support.
- [OpenAI - Acquiring Promptfoo announcement](https://openai.com/index/openai-to-acquire-promptfoo/) - March 2026, MIT license preserved.
- [Inspect AI homepage](https://inspect.aisi.org.uk/) - UK AISI framework.
- [Inspect AI - GitHub repo](https://github.com/UKGovernmentBEIS/inspect_ai) - source.
- [Inspect AI - Agents docs](https://inspect.aisi.org.uk/agents.html) - agent eval patterns including Agent Bridge.
- [Inspect Evals (200+ pre-built)](https://github.com/UKGovernmentBEIS/inspect_evals) - companion eval registry.
- [Helicone homepage](https://www.helicone.ai/) - observability gateway.
- [LangWatch blog - 4 best monitoring tools](https://langwatch.ai/blog/4-best-tools-for-monitoring-llm-agentapplications-in-2026) - 2026 landscape.
- [AgentOps overview (15 platforms compared)](https://aimultiple.com/agentic-monitoring) - includes AgentOps positioning.

### Practitioner blogs and talks

- [Hamel Husain - LLM Evals: Everything You Need to Know](https://hamel.dev/blog/posts/evals-faq/) - Jan 2026 FAQ; the most up-to-date practitioner take.
- [Hamel Husain - Selecting the Right AI Evals Tool](https://hamel.dev/blog/posts/eval-tools/) - tool-by-tool opinion.
- [Hamel Husain - Inspect AI notes](https://hamel.dev/notes/llm/evals/inspect.html) - Inspect endorsement.
- [Hamel Husain - Using LLM-as-a-Judge guide](https://hamel.dev/blog/posts/llm-judge/) - canonical LLM-as-judge how-to.
- [Hamel Husain - The Revenge of the Data Scientist](https://hamel.dev/blog/posts/revenge/) - March 2026 critique of generic eval frameworks.
- [Eugene Yan - Evaluating the Effectiveness of LLM-Evaluators](https://eugeneyan.com/writing/llm-evaluators/) - the foundational survey.
- [Eugene Yan - An LLM-as-Judge Won't Save The Product](https://eugeneyan.com/writing/eval-process/) - process over tooling.
- [Vanishing Gradients podcast Ep 60 - 10 Things I Hate About AI Evals with Hamel Husain](https://vanishinggradients.fireside.fm/60) - opinionated practitioner discussion.
- [AI Engineer Europe 2026 schedule](https://www.ai.engineer/europe/schedule) - Evals & Observability track.
- [AI Engineer World's Fair 2026](https://www.ai.engineer/worldsfair) - June 29-July 2, San Francisco.
- [ZenML LLMOps Database - Notion AI feature evaluation](https://www.zenml.io/llmops-database/building-a-scalable-ai-feature-evaluation-system) - Notion + Braintrust deep dive.
- [Niklas Heidloff - Evaluating Agents via LLM-as-a-Judge in Langfuse](https://heidloff.net/article/langfuse-evaluations/) - applied Langfuse agent eval walkthrough.
- [LangChain blog - Agent Evaluation Readiness Checklist](https://www.langchain.com/blog/agent-evaluation-readiness-checklist) - useful checklist regardless of platform.
- [Pragmatic Engineer - A pragmatic guide to LLM evals for devs](https://newsletter.pragmaticengineer.com/p/evals) - dev-oriented overview.
- [O'Reilly - Evals for AI Engineers (book)](https://www.oreilly.com/library/view/evals-for-ai/9798341660717/) - 2025 book-length treatment.
