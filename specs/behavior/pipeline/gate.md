# Spec — Gate stage (judge)

**Status:** Approved — EggAI, 2026-07-08 · Domain: pipeline · Overview: [README.md](README.md)

Deterministic quality gate. **Not an LLM.**

## Contract

| | |
|---|---|
| **In** | `overall-report.json`; thresholds |
| **Out** | `judge-decision.json` — `{ passed, qualityStatus, summary, thresholds, reasons[], warnings[], detailedReport }` |
| **Depends on** | report, fix |

## Threshold logic

| Threshold | Default | Effect when exceeded |
|---|---|---|
| `maxCritical` | 0 | fail |
| `maxHigh` | 0 | fail |
| `maxMedium` | 20 | warn unless `failOnMedium` |
| `maxLow` | 50 | warn unless `failOnLow` |
| `requireAllStages` | true | fail if any stage result is falsy |
| `failOnMedium` / `failOnLow` | false / false | promote the corresponding warn to fail |

## Corrections

- ⚠ (F-4) thresholds are configurable in the config file under a **`gate`** section, with env vars as overrides. Its keys mirror the env var names (`maxCritical`, `maxHigh`, `maxMedium`, `maxLow`, `failOnMedium`, `failOnLow`, `requireAllStages`). *(Today env-only.)* Bucket C. Config surface: [`../configuration/config-file.md`](../configuration/config-file.md).
- ⚠ (F-1) `passed === false` drives a **non-zero process exit** on the default run. *(Today the gate is advisory — it logs and exits 0; only the separate forge-integration commands with `blockPipeline` can fail CI.)* Bucket C. Exit-code contract: [`../../quality/error-handling.md`](../../quality/error-handling.md).
