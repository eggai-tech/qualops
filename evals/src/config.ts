'use strict';

import path from 'node:path';
import fs from 'node:fs';
import { detectProvider } from '@/config/config';

export const QUALOPS_ROOT = path.join(__dirname, '../..');
export const PRESETS_DIR = path.join(QUALOPS_ROOT, 'evals/qualopsrc');
export const DEFAULT_QUALOPSRC = '.qualops/.qualopsrc.json';
export const LOGS_DIR = path.join(QUALOPS_ROOT, 'evals/logs');
export const CRB_DATASETS_DIR = path.join(QUALOPS_ROOT, 'evals/datasets/crb');

import { CRB_REPOS } from './crb-repos';

export interface CrbExpected {
  line: number | null;
  lineEnd: number | null;
  type: string;
  severity: string;
  description: string;
}

export interface CrbSlice {
  id: string;
  source: 'crb';
  prUrl: string;
  prTitle: string;
  sourceRepo: string;
  language: string;
  baseSha: string;
  headSha: string;
  baseRef: string;
  headRef: string;
  upstreamOwner: string;
  upstreamRepo: string;
  diff: string;
  expected: CrbExpected[];
}

/** Normalised expected/bug pair shared by both the runner and the uploader. */
export interface CrbExpectedPair {
  referenceExpected: CrbExpected[];
  referenceBugs: Array<{
    relevantFile: string;
    relevantLinesStart: number | null;
    relevantLinesEnd: number | null;
    type: string;
    severity: string;
    description: string;
  }>;
}

/** Build the referenceExpected + referenceBugs arrays from a slice's expected list. */
export function buildCrbExpectedPair(slice: Pick<CrbSlice, 'prUrl' | 'expected'>): CrbExpectedPair {
  const referenceExpected: CrbExpected[] = slice.expected.map((e) => ({
    line: e.line,
    lineEnd: e.lineEnd,
    type: e.type || 'bug',
    severity: e.severity || 'medium',
    description: e.description || '',
  }));
  const referenceBugs = referenceExpected.map((e) => ({
    relevantFile: slice.prUrl,
    relevantLinesStart: e.line,
    relevantLinesEnd: e.lineEnd,
    type: e.type,
    severity: e.severity,
    description: e.description,
  }));
  return { referenceExpected, referenceBugs };
}

/** Load all CRB slice items for a given repo slug (e.g. 'sentry'). */
export function loadCrbItems(repoSlug: string): CrbSlice[] {
  if (!fs.existsSync(CRB_DATASETS_DIR)) return [];
  const items: CrbSlice[] = [];
  for (const entry of fs.readdirSync(CRB_DATASETS_DIR).sort()) {
    if (!entry.startsWith(`crb-${repoSlug}-`)) continue;
    const slicePath = path.join(CRB_DATASETS_DIR, entry, 'slice.json');
    if (!fs.existsSync(slicePath)) continue;
    items.push(JSON.parse(fs.readFileSync(slicePath, 'utf-8')) as CrbSlice);
  }
  return items;
}

export interface PresetMeta {
  model?: string;
  provider?: string;
  mode?: string;
}

export interface EvalArgs {
  dataset?: string;
  source?: string;
  preset?: string;
  mode?: string;
  model?: string;
  provider?: string;
  limit?: string;
  'no-judge'?: string;
  severity?: string;
  experiment?: string;
  concurrency?: string;
  'list-presets'?: string;
}

export interface EvalBuildConfig {
  mode: string;
  model: string;
  modelOverride: string | null;
  provider: string;
  limit: number;
  skipJudge: boolean;
  presetLabel: string;
  presetName: string | null;
  presetFile: string | null;
  experimentName: string;
  concurrency: number;
  configPath: string;
  severityFilter: Set<string> | null;
}

export function resolvePreset(name: string | null | undefined): string | null {
  if (!name || name === 'default') return null;
  const presetFile = path.join(PRESETS_DIR, `${name}.json`);
  if (!fs.existsSync(presetFile)) {
    const available = listPresets().join(', ') || '(none)';
    throw new Error(`Unknown preset: "${name}". Available: ${available}`);
  }
  return presetFile;
}

export function listPresets(): string[] {
  if (!fs.existsSync(PRESETS_DIR)) return [];
  return fs.readdirSync(PRESETS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));
}

export function readPresetMeta(presetFile: string): PresetMeta {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ConfigService } = require('@/config/config') as { ConfigService: { setConfigPath(p: string): void; getInstance(): { getResolvedStageConfig(stage: string): { model: string; provider: string } } } };
    ConfigService.setConfigPath(path.relative(QUALOPS_ROOT, presetFile));
    const resolved = ConfigService.getInstance().getResolvedStageConfig('review');
    const rawConfig = JSON.parse(fs.readFileSync(presetFile, 'utf-8')) as { review?: { pipeline?: Array<{ enabled?: boolean; mode?: string }> } };
    return {
      model: resolved.model,
      provider: resolved.provider,
      mode: rawConfig.review?.pipeline?.find((j) => j.enabled)?.mode || 'file-by-file',
    };
  } catch {
    return {};
  }
}

export function parseArgs(argv: string[]): EvalArgs {
  return Object.fromEntries(
    argv
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const [k, v] = a.slice(2).split('=');
        return [k, v || 'true'];
      }),
  ) as EvalArgs;
}

export function resolveDatasets(args?: EvalArgs): string[] {
  if (!args) args = {};
  if (args.dataset) return [args.dataset];
  if (args.source === 'crb') return Object.keys(CRB_REPOS).map((r) => `qualops/crb-${r}`);
  if (args.source === 'qualops') return ['qualops/qualops'];
  if (args.source === 'all') return ['qualops/qualops', ...Object.keys(CRB_REPOS).map((r) => `qualops/crb-${r}`)];
  return ['qualops/qualops'];
}

export function buildConfig(args: EvalArgs): EvalBuildConfig {
  const presetName = args.preset || null;
  const presetFile = resolvePreset(presetName);

  let presetMeta: PresetMeta = {};
  const metaFile = presetFile || path.join(QUALOPS_ROOT, DEFAULT_QUALOPSRC);
  if (fs.existsSync(metaFile)) {
    presetMeta = readPresetMeta(metaFile);
  }

  const mode = args.mode || presetMeta.mode || 'file-by-file';
  const modelOverride = args.model || null;
  const model = modelOverride || presetMeta.model || 'claude-sonnet-4-6';
  const provider = args.provider || presetMeta.provider || detectProvider();
  if (!provider) {
    throw new Error(
      'No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or specify --provider.',
    );
  }
  const limit = args.limit ? parseInt(args.limit, 10) : Infinity;
  const skipJudge = args['no-judge'] === 'true';
  const severityFilter = args.severity
    ? new Set(args.severity.split(',').map((s) => s.trim().toLowerCase()))
    : null;
  const presetLabel = presetName || 'default';
  const experimentName = args.experiment || `${presetLabel}:${model}:${mode}:${new Date().toISOString().slice(0, 16)}`;
  const concurrency = args.concurrency ? parseInt(args.concurrency, 10) : 3;
  const configPath = presetFile ? path.relative(QUALOPS_ROOT, presetFile) : DEFAULT_QUALOPSRC;

  return {
    mode,
    model,
    modelOverride,
    provider,
    limit,
    skipJudge,
    presetLabel,
    presetName,
    presetFile,
    experimentName,
    concurrency,
    configPath,
    severityFilter,
  };
}
