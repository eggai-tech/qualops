'use strict';

const path = require('path');
const fs = require('fs');

const QUALOPS_ROOT = path.join(__dirname, '../..');
const PRESETS_DIR = path.join(QUALOPS_ROOT, 'evals/qualopsrc');
const DEFAULT_QUALOPSRC = '.qualops/.qualopsrc.json';
const LOGS_DIR = path.join(QUALOPS_ROOT, 'evals/src/logs');

const CRB_REPOS = ['sentry', 'grafana', 'cal_dot_com', 'discourse', 'keycloak'];

function resolvePreset(name) {
  if (!name || name === 'default') return null;
  const presetFile = path.join(PRESETS_DIR, `${name}.json`);
  if (!fs.existsSync(presetFile)) {
    const available = listPresets().join(', ') || '(none)';
    throw new Error(`Unknown preset: "${name}". Available: ${available}`);
  }
  return presetFile;
}

function listPresets() {
  if (!fs.existsSync(PRESETS_DIR)) return [];
  return fs.readdirSync(PRESETS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));
}

function readPresetMeta(presetFile) {
  try {
    const config = JSON.parse(fs.readFileSync(presetFile, 'utf-8'));
    return {
      model: config.ai?.reviewStage?.model,
      mode: config.review?.pipeline?.find((j) => j.enabled)?.mode || 'file-by-file',
    };
  } catch {
    return {};
  }
}

function parseArgs(argv) {
  return Object.fromEntries(
    argv
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const [k, v] = a.slice(2).split('=');
        return [k, v || 'true'];
      }),
  );
}

function resolveDatasets(args) {
  if (!args) args = {};
  if (args.dataset) return [args.dataset];
  if (args.source === 'crb') return CRB_REPOS.map((r) => `qualops/crb-${r}`);
  if (args.source === 'qualops') return ['qualops/qualops'];
  if (args.source === 'all') return ['qualops/qualops', ...CRB_REPOS.map((r) => `qualops/crb-${r}`)];
  return ['qualops/qualops'];
}

function buildConfig(args) {
  const presetName = args.preset || null;
  const presetFile = resolvePreset(presetName);

  let presetMeta = {};
  if (presetFile) {
    presetMeta = readPresetMeta(presetFile);
  }

  const mode = args.mode || presetMeta.mode || 'file-by-file';
  const model = args.model || presetMeta.model || 'claude-sonnet-4-6';
  const provider = args.provider || 'anthropic';
  const limit = args.limit ? parseInt(args.limit, 10) : Infinity;
  const skipJudge = args['no-judge'] === 'true';
  const presetLabel = presetName || 'default';
  const experimentName = args.experiment || `${presetLabel}:${model}:${mode}:${new Date().toISOString().slice(0, 16)}`;
  const concurrency = args.concurrency ? parseInt(args.concurrency, 10) : 3;
  const configPath = presetFile ? path.relative(QUALOPS_ROOT, presetFile) : DEFAULT_QUALOPSRC;

  return {
    mode,
    model,
    provider,
    limit,
    skipJudge,
    presetLabel,
    presetName,
    presetFile,
    experimentName,
    concurrency,
    configPath,
  };
}

module.exports = {
  QUALOPS_ROOT,
  PRESETS_DIR,
  DEFAULT_QUALOPSRC,
  LOGS_DIR,
  CRB_REPOS,
  resolvePreset,
  listPresets,
  readPresetMeta,
  parseArgs,
  resolveDatasets,
  buildConfig,
};
