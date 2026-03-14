# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Resolve all npm audit vulnerabilities (diff, @aws-sdk/client-bedrock-runtime, transitive deps)
- Release PR workflow: add Node.js setup, sync package-lock.json after version bump
- Fix script injection vulnerability in release workflow version inputs
- Fix `@aggai/qualops` package name typo in qualops-llm.txt

### Added
- Dependabot integration with grouped updates and auto-merge for patch/minor
- Agentic reviewer mode using Claude Agent SDK for PR-level analysis
- Context preloading: inject diffs/content directly into agent prompt (70% fewer tool calls)
- Cross-file dependency tracing with `find_usages` tool
- Security analysis subagent for vulnerability detection
- Custom agent support via configuration or markdown files in `.qualops/agents/`

### Changed
- Release workflows: migrate from PAT to GitHub App token, auto-publish on release PR merge
- Refactor qualops-llm.txt: add multi-provider support, updated models/pricing, 47% size reduction
- Upgrade all AI SDKs: @anthropic-ai/sdk 0.78, openai 6, claude-agent-sdk 0.2, zod 4
- Upgrade GitHub Actions: checkout v6, setup-node v6, upload-artifact v7, download-artifact v8
- Pipeline jobs now support `mode: 'file-by-file' | 'agentic'` configuration
- Extended `AgenticConfig` with `contextMode`, `maxTokensPerFile`, `maxTotalTokens` options
- `init-claude` command now bundles LLM context locally (works with private repos)
- Updated documentation with agentic mode examples and configuration

## [0.1.1] - 2025-01-06

### Added
- `.qualops/` folder structure for configuration and examples
- LLM context distribution with `init-claude` command
- GitHub integration with PR comments and checks API

### Changed
- Moved configuration from root `.qualopsrc.json` to `.qualops/.qualopsrc.json`
- Moved examples to `.qualops/examples/`

### Fixed
- ESLint and Prettier configuration alignment

## [0.1.0] - 2025-01-05

### Added
- Initial release of QualOps
- Multi-stage pipeline: analyze, review, fix, report, judge
- AI-powered code review with Claude, GPT-4, and AWS Bedrock support
- Framework-specific documentation loading (Angular, NgRx, RxJS, OWASP)
- Session-based review with context management
- Fix suggestion generation with automatic application
- HTML and Markdown report generation
- GitLab CI integration with MR comments
- GitHub Actions integration
- Extract log caching for incremental analysis
- Configurable thresholds and quality gates
