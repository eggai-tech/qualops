#!/usr/bin/env bash
#
# A/B harness for QualOps config changes: run two config files against the same
# dataset and compare quality (precision/recall/F1) and cost/latency. Use it to
# test per-stage model choices, budgets, prompts, or pipeline modes.
#
#   evals/run-ab.sh <configA.json> <configB.json>            # smoke: 1 item each, then compare
#   evals/run-ab.sh --full <configA.json> <configB.json>     # N repeats each, then compare
#
# Env knobs:
#   DATASET   Langfuse/CRB dataset (default: qualops/crb-sentry)
#   REPEATS   repeats per arm in --full mode (default: 1)
#   LIMIT     items per run (default: 1 in smoke, all in --full unless set)
#
# Requires ANTHROPIC_API_KEY (or the provider key your configs use).
set -euo pipefail

cd "$(dirname "$0")/.."

# Load the project's .env so the key is available to this script's own precheck
# and to the eval subprocess (run-eval.ts also loads .env, but our precheck reads
# the shell env). Existing shell vars take precedence over .env.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

FULL=0
if [ "${1:-}" = "--full" ]; then
  FULL=1
  shift
fi

CONFIG_A="${1:-}"
CONFIG_B="${2:-}"
if [ -z "$CONFIG_A" ] || [ -z "$CONFIG_B" ]; then
  echo "Usage: evals/run-ab.sh [--full] <configA.json> <configB.json>" >&2
  echo "  e.g. evals/run-ab.sh .qualops/.qualopsrc.json .qualops/.qualopsrc-cheap.json" >&2
  exit 2
fi

DATASET="${DATASET:-qualops/crb-sentry}"
REPEATS="${REPEATS:-1}"
RUN="npx tsx evals/src/run-eval.ts"

# Label each arm by its config file basename (matches run-eval's experiment label).
label_of() { basename "$1" .json | sed 's/^\.//'; }
LABEL_A="$(label_of "$CONFIG_A")"
LABEL_B="$(label_of "$CONFIG_B")"

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ERROR: ANTHROPIC_API_KEY is not set (checked shell env and .env)." >&2
  exit 1
fi

# IMPORTANT: do NOT pass --mode — the mode is carried by each --config so the run
# uses exactly the pipeline defined in the config file.
run_arm() {  # $1=config  $2=extra-args
  $RUN --config="$1" --dataset="$DATASET" --no-judge $2
}

if [ "$FULL" -eq 0 ]; then
  echo "=== SMOKE: 1 item per arm on $DATASET ==="
  echo "--- A: $CONFIG_A ---"
  run_arm "$CONFIG_A" "--limit=1"
  echo "--- B: $CONFIG_B ---"
  run_arm "$CONFIG_B" "--limit=1"
  echo ""
  echo "Smoke done. Compare, or run the full A/B:  evals/run-ab.sh --full $CONFIG_A $CONFIG_B"
  npx tsx evals/src/compare-experiments.ts "$LABEL_A" "$LABEL_B" || true
  exit 0
fi

echo "=== FULL A/B: $REPEATS repeat(s) per arm on $DATASET ==="
LIMIT_ARG=""
[ -n "${LIMIT:-}" ] && LIMIT_ARG="--limit=$LIMIT"

for i in $(seq 1 "$REPEATS"); do
  echo "--- A run $i/$REPEATS: $CONFIG_A ---"
  run_arm "$CONFIG_A" "$LIMIT_ARG --experiment=${LABEL_A}-run${i}"
  echo "--- B run $i/$REPEATS: $CONFIG_B ---"
  run_arm "$CONFIG_B" "$LIMIT_ARG --experiment=${LABEL_B}-run${i}"
done

echo ""
echo "=== ANALYSIS (latest run per arm) ==="
npx tsx evals/src/compare-experiments.ts "$LABEL_A" "$LABEL_B"
echo ""
echo "All run logs: evals/logs/  (compare specific runs with --a=<log> --b=<log>)"
