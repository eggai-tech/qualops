# QualOps Python Project Testing Plan

**Created**: 2025-11-24
**Branch**: feat/custom-config-and-security-auditor
**Test Project**: gtu-mcp (Python/FastAPI MCP Server)
**Test File**: `projects/gtu-mcp/apps/mcp_server/mcp_server.py`

---

## Objective

Test the new custom configuration feature (`-c, --config` flag) by running a full QualOps pipeline against a Python project using an AI-generated configuration focused on general code quality review.

---

## Execution Phases

### Phase 1: Branch Setup & Analysis
**Goal**: Understand new features in feat/custom-config-and-security-auditor branch

1. Checkout `feat/custom-config-and-security-auditor` branch
2. Analyze branch changes (focus on custom config support)
3. Document key features:
   - Custom config file support via `-c, --config` flag
   - Security auditor pipeline implementation
   - New validation system
   - Configuration cleanup

### Phase 2: Test Project Analysis
**Goal**: Understand the Python test project structure and patterns

4. Analyze `/home/pontino/code/qualops/projects/gtu-mcp` structure
5. Identify key patterns:
   - FastAPI framework usage
   - Pydantic models
   - Async/await patterns
   - Database operations (DuckDB)
   - OAuth authentication
   - Error handling and logging
6. Select test file: `projects/gtu-mcp/apps/mcp_server/mcp_server.py`
   - **Lines**: 165
   - **Complexity**: Medium
   - **Patterns**: OAuth setup, error handling, async operations, client configuration

### Phase 3: AI-Generated Configuration
**Goal**: Create Python-focused QualOps configuration using AI

7. Use Claude to analyze test project and generate configuration
8. Configuration focus areas:
   - FastAPI best practices (route handlers, dependency injection)
   - Async/await patterns and error handling
   - Pydantic validation and settings
   - Database query patterns
   - API design and HTTP responses
   - Logging and error messages
   - Code organization and maintainability
9. Output files:
   - `examples/python-quality/python-quality.qualopsrc.json`
   - `examples/python-quality/prompts/review-system-message.md`

### Phase 4: Pipeline Execution
**Goal**: Run full QualOps pipeline with custom configuration

10. Verify `.env` file exists with ANTHROPIC_API_KEY
11. Execute pipeline:
    ```bash
    npm run dev -- all \
      --config examples/python-quality/python-quality.qualopsrc.json \
      --files projects/gtu-mcp/apps/mcp_server/mcp_server.py \
      --stages analyze,review,fix,report,judge
    ```
12. Stages executed:
    - **Analyze**: Detect changed/target files
    - **Review**: AI-powered code quality review
    - **Fix**: Generate fix suggestions
    - **Report**: Create HTML/JSON reports
    - **Judge**: Quality gate decision

### Phase 5: Results Validation
**Goal**: Verify pipeline execution and output quality

13. Review generated artifacts in `reports/sessions/<session-name>/`
14. Validate outputs:
    - Analysis metadata
    - Review issues found (types, severity, confidence)
    - Fix suggestions quality
    - Report completeness
    - Judge decision accuracy
15. Document any issues or unexpected behavior

### Phase 6: Documentation
**Goal**: Maintain execution tracking and results

16. Maintain `progress.md` with real-time updates
17. Document completion status, timestamps, and notes for each phase
18. Capture any learnings or recommendations

---

## Expected Deliverables

| Deliverable | Location | Description |
|-------------|----------|-------------|
| Plan document | `plan.md` | This file - complete execution plan |
| Progress tracker | `progress.md` | Real-time progress updates |
| Config file | `examples/python-quality/python-quality.qualopsrc.json` | AI-generated QualOps config |
| Review prompt | `examples/python-quality/prompts/review-system-message.md` | Python code review instructions |
| Analysis metadata | `reports/sessions/<session>/analysis.json` | Analyzed files metadata |
| Review results | `reports/sessions/<session>/review-summary.json` | Found issues |
| Fix suggestions | `reports/sessions/<session>/fix-suggestions.json` | Generated fixes |
| HTML report | `reports/sessions/<session>/report.html` | Visual report |
| Judge decision | `reports/sessions/<session>/judge-decision.json` | Quality gate result |

---

## Success Criteria

- ✓ Custom config flag works correctly
- ✓ Python-specific patterns detected
- ✓ Meaningful code quality issues identified
- ✓ Fix suggestions are accurate and applicable
- ✓ Report generation completes successfully
- ✓ Judge decision is reasonable based on findings
- ✓ No errors or crashes during execution

---

## Key Technical Details

**Branch Commit**: `6638c54 - feat: add custom config support and security auditor pipeline`

**Test File Details**:
- **Path**: `projects/gtu-mcp/apps/mcp_server/mcp_server.py`
- **Size**: 165 lines
- **Language**: Python 3.12+
- **Framework**: FastAPI, FastMCP
- **Key Components**: OAuth auth provider, MCP tools, error handling

**Configuration Approach**:
- AI-generated (not manual adaptation)
- General code quality focus (not security-only)
- Multi-pass review with detection triggers
- Python/FastAPI-specific patterns

**Pipeline Configuration**:
- Provider: Anthropic Claude
- Model: claude-sonnet-4-5-20250929
- Temperature: 0.1 (deterministic)
- All stages enabled
