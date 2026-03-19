# Plan: Improve reliability of `init-claude` command (qualops-b23.1)

## Context

The current `init-claude` command copies a Claude prompt template that says "ask questions, then generate config." Because the LLM responses are non-deterministic, users get wildly different outputs and no schema validation, so invalid configs are common. This task makes `init-claude` produce a consistent, valid QualOps setup every time.

## Subtask Dependency Chain

```
b23.1.1 (schema validator) → b23.1.2 (default config gen) → b23.1.3 (rewrite template) → b23.1.4 (tests)
```

---

## Subtask 1: Add JSON Schema validation utility (b23.1.1)

**File:** `src/shared/utils/validate-config.ts` (new)

- Use `ajv` (install as dependency) for JSON Schema validation — it's the standard for JSON Schema and more appropriate than zod here since we already have a JSON Schema file
- Load schema from `docs/qualops-config.schema.json` at build time (import with resolveJsonModule)
- Export `validateConfig(config: object): { valid: boolean; errors: string[] }`
- The schema uses `$defs` and `$ref` which ajv handles natively

**Why ajv over zod:** We already have the authoritative schema as JSON Schema. Converting to zod would be duplicating it. ajv validates JSON Schema directly.

**Install:** `npm install ajv`

---

## Subtask 2: Generate default .qualopsrc.json in init-claude (b23.1.2)

**File:** `src/cli/commands/init-claude-command.ts` (modify)

- Add a `--provider` option (anthropic|openai|bedrock) to the CLI command in `src/cli.ts`
- Define provider defaults map:
  - `anthropic`: `claude-sonnet-4-6`, $3/$15
  - `openai`: `gpt-4.1`, $2/$8
  - `bedrock`: `us.anthropic.claude-sonnet-4-6-v1:0`, $3/$15
- Generate a minimal valid config:
  ```json
  {
    "$schema": "https://raw.githubusercontent.com/eggai-tech/qualops/main/docs/qualops-config.schema.json",
    "ai": {
      "reviewStage": { "provider": "anthropic", "model": "claude-sonnet-4-6", "inputPerMillion": 3, "outputPerMillion": 15 }
    },
    "review": {
      "pipeline": [{
        "name": "codeQuality",
        "enabled": true,
        "passes": [{
          "name": "quality",
          "enabled": true,
          "prompt": "review/quality.md"
        }]
      }]
    }
  }
  ```
- Validate config against schema before writing using `validateConfig()`
- Skip writing if `.qualops/.qualopsrc.json` already exists (warn user)
- Also create a default prompt file at `.qualops/prompts/review/quality.md` with a basic review prompt

---

## Subtask 3: Rewrite /qualops-setup command template (b23.1.3)

**File:** `src/cli/commands/init-claude-command.ts` (modify `COMMAND_TEMPLATE`)

Rewrite the template to be prescriptive rather than open-ended:
1. Instruct Claude to read the existing `.qualops/.qualopsrc.json`
2. Present specific customization menu:
   - Add a security review pass
   - Switch to agentic mode
   - Change AI provider/model
   - Add CI workflow (GitHub Actions / GitLab CI)
   - Add validation/deduplication
3. Include concrete config snippets for each option so the LLM doesn't hallucinate shapes
4. Still reference `$file:.qualops/qualops-llm.txt` for full documentation context

---

## Subtask 4: Add unit tests (b23.1.4)

**File:** `tests/unit/cli/commands/init-claude-command.spec.ts` (new)

Tests to write:
1. `validateConfig()` accepts valid minimal config
2. `validateConfig()` rejects config missing required `ai` field
3. `validateConfig()` rejects config with invalid provider
4. `initClaudeCommand()` generates valid `.qualopsrc.json` that passes schema validation
5. `initClaudeCommand()` does NOT overwrite existing `.qualopsrc.json`
6. `initClaudeCommand()` copies `qualops-llm.txt`
7. `initClaudeCommand()` creates `.claude/commands/qualops-setup.md`
8. `--provider openai` flag produces correct provider/model/pricing
9. `--provider bedrock` flag produces correct provider/model/pricing

Use temp directory (via `fs.mkdtempSync`) for filesystem operations. Mock `process.cwd()` and `getPackageRoot()`.

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/shared/utils/validate-config.ts` | Create — schema validation utility |
| `src/cli/commands/init-claude-command.ts` | Modify — default config gen + rewritten template |
| `src/cli.ts` | Modify — add `--provider` option to init-claude command |
| `tests/unit/cli/commands/init-claude-command.spec.ts` | Create — unit tests |
| `package.json` | Modify — add `ajv` dependency |

## Verification

1. `npm test` — all existing + new tests pass
2. `npm run build` — compiles without errors
3. `npm run lint` — no lint errors
4. Manual: run `qualops init-claude` in a temp dir and verify generated `.qualopsrc.json` is valid
