# QualOps Issue Resolver Scripts

AI-powered scripts to automatically resolve QualOps-detected issues using Claude.

## Overview

These scripts use the Anthropic SDK to automatically generate and apply fixes for issues detected by QualOps. They parse issue markdown files, analyze the source code, and generate appropriate fixes.

## Scripts

### 1. `resolve-issue.ts` - Single Issue Resolver

Resolves a single issue from a QualOps issue markdown file.

**Usage:**
```bash
# From tools/qualops directory
cd tools/qualops

# Dry run (preview fix without applying)
node --env-file=../../.env --experimental-strip-types src/scripts/resolve-issue.ts \
  ../../reports/qualops-full-2025-10-22/issues/security_input_validation/ISSUE-018.md

# Apply fix
node --env-file=../../.env --experimental-strip-types src/scripts/resolve-issue.ts \
  ../../reports/qualops-full-2025-10-22/issues/security_input_validation/ISSUE-018.md \
  --apply
```

**Features:**
- Parses issue metadata (severity, category, file, line)
- Reads the source file
- Generates fix using Claude Sonnet 4.5
- Shows token usage
- Preview mode by default (dry-run)
- Applies fix with `--apply` flag

### 2. `resolve-issues-batch.ts` - Batch Issue Resolver

Process multiple issues at once with filtering and control options.

**Usage:**
```bash
# From tools/qualops directory
cd tools/qualops

# Dry run all issues
node --env-file=../../.env --experimental-strip-types src/scripts/resolve-issues-batch.ts \
  ../../reports/qualops-full-2025-10-22/issues

# Apply fixes to security issues (first 5)
node --env-file=../../.env --experimental-strip-types src/scripts/resolve-issues-batch.ts \
  ../../reports/qualops-full-2025-10-22/issues \
  --category security_input_validation \
  --limit 5 \
  --apply

# Interactive mode for code quality issues
node --env-file=../../.env --experimental-strip-types src/scripts/resolve-issues-batch.ts \
  ../../reports/qualops-full-2025-10-22/issues \
  --category code_quality \
  --interactive
```

**Options:**
- `--category <name>` - Process only specific category
- `--limit <number>` - Limit number of issues
- `--apply` - Apply fixes (default: dry-run)
- `--interactive` - Pause between issues
- `--help` - Show help

**Available Categories:**
- `architecture_violations` (12 issues)
- `code_quality` (49 issues)
- `memory_leaks_cleanup` (40 issues)
- `null_undefined_safety` (37 issues)
- `performance` (13 issues)
- `race_conditions_async` (38 issues)
- `rxjs_operator_misuse` (14 issues)
- `security_input_validation` (13 issues)

## Prerequisites

1. **Environment Variables:**
   Create or update `.env` in monorepo root:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```

2. **Node.js:**
   - Version: >=20.0.0
   - Uses experimental TypeScript support

## Workflow

### Recommended Approach

1. **Start with High-Priority Issues:**
   ```bash
   # Security issues first
   node src/scripts/resolve-issues-batch.ts \
     ../../reports/qualops-full-2025-10-22/issues \
     --category security_input_validation \
     --interactive
   ```

2. **Use Interactive Mode:**
   - Review each fix before moving to next
   - Press Enter to continue or Ctrl+C to stop
   - Safe way to process multiple issues

3. **Test After Each Category:**
   ```bash
   # Apply fixes to a category
   node src/scripts/resolve-issues-batch.ts \
     --category memory_leaks_cleanup \
     --apply

   # Run tests
   cd ../..
   npm run test:qualops
   ```

4. **Commit After Verification:**
   ```bash
   git add .
   git commit --no-verify -m "fix: resolve memory leak issues from qualops"
   ```

## Issue Categories Analysis

Based on `qualops-full-2025-10-22` report:

| Category | Count | Priority | Solvability |
|----------|-------|----------|-------------|
| security_input_validation | 13 | HIGH | Easy-Medium |
| memory_leaks_cleanup | 40 | HIGH | Medium |
| race_conditions_async | 38 | HIGH | Medium-Hard |
| rxjs_operator_misuse | 14 | MEDIUM | Easy-Medium |
| code_quality | 49 | MEDIUM | Easy |
| null_undefined_safety | 37 | MEDIUM | Easy-Medium |
| performance | 13 | MEDIUM | Medium |
| architecture_violations | 12 | LOW | Hard (requires design decisions) |

### Recommended Resolution Order

1. **Security Issues** (13) - Start here, critical for security
2. **RxJS Operator Misuse** (14) - Clear fixes, improves reliability
3. **Code Quality** (49) - Easy wins, improves maintainability
4. **Null/Undefined Safety** (37) - Prevents runtime errors
5. **Memory Leaks** (40) - Important but may need testing
6. **Performance** (13) - Optimize after correctness
7. **Race Conditions** (38) - Complex, needs careful review
8. **Architecture Violations** (12) - Requires design decisions

## Safety & Best Practices

1. **Always Test First:**
   - Run in dry-run mode first
   - Review generated fixes
   - Test after applying

2. **Use Version Control:**
   - Commit before starting
   - Create a feature branch
   - Easy rollback if needed

3. **Start Small:**
   - Process 5-10 issues at a time
   - Verify each category works
   - Build confidence gradually

4. **Monitor Token Usage:**
   - Each fix uses ~5000-8000 tokens
   - 100 issues ≈ 500k-800k tokens
   - Anthropic API costs apply

5. **Review Complex Fixes:**
   - Use `--interactive` for critical issues
   - Manually review state management changes
   - Test async/race condition fixes thoroughly

## Limitations

- **Context Size:** Large files may exceed token limits
- **Complex Refactoring:** Architecture violations may need manual fixes
- **Side Effects:** Generated fixes may have unintended consequences
- **Testing Required:** Always test after applying fixes
- **State Management:** NgRx/Signal Store changes need careful review

## Troubleshooting

**Script fails to find file:**
- Ensure you're in `tools/qualops` directory
- Check issue file path is correct
- Use absolute paths if needed

**Fix generation fails:**
- Check API key in `.env`
- Verify file path in issue is correct
- Check source file is readable

**Applied fix breaks tests:**
- Revert the change
- Review the fix manually
- Consider a different approach
- Report issue to QualOps team

## Examples

### Fix All Security Issues
```bash
cd tools/qualops
node --env-file=../../.env --experimental-strip-types src/scripts/resolve-issues-batch.ts \
  ../../reports/qualops-full-2025-10-22/issues \
  --category security_input_validation \
  --apply

cd ../..
npm run test:qualops
git add .
git commit --no-verify -m "fix: resolve security input validation issues"
```

### Preview Memory Leak Fixes (First 10)
```bash
cd tools/qualops
node --env-file=../../.env --experimental-strip-types src/scripts/resolve-issues-batch.ts \
  ../../reports/qualops-full-2025-10-22/issues \
  --category memory_leaks_cleanup \
  --limit 10
```

### Interactive Code Quality Fixes
```bash
cd tools/qualops
node --env-file=../../.env --experimental-strip-types src/scripts/resolve-issues-batch.ts \
  ../../reports/qualops-full-2025-10-22/issues \
  --category code_quality \
  --interactive \
  --apply
```

## Cost Estimation

Based on average token usage:
- **Per issue:** ~5000 input + 5000 output tokens
- **100 issues:** ~500k input + 500k output tokens
- **All 216 issues:** ~1.08M input + 1.08M output tokens

Anthropic API pricing (Sonnet 4.5):
- Input: $3/million tokens
- Output: $15/million tokens

**Estimated cost for all issues:** ~$19.44

## Next Steps

1. Choose a category to start with
2. Run in dry-run mode to preview fixes
3. Apply fixes with `--apply` flag
4. Run tests to verify
5. Commit working fixes
6. Move to next category

Good luck! 🚀
