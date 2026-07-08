'use strict';

import fs from 'node:fs';
import path from 'node:path';

import { sanitizeFilename } from '@/shared/utils/security';

import { LOGS_DIR } from './config';

export type ErrorCode =
  | 'RATE_LIMITED'
  | 'AUTH_FAILED'
  | 'TIMEOUT'
  | 'BUDGET_EXHAUSTED'
  | 'PARSE_ERROR'
  | 'NETWORK_ERROR'
  | 'API_ERROR'
  | 'LANGFUSE_API_ERROR'
  | 'UNKNOWN';

export interface LogEntry {
  timestamp?: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  errorCode?: ErrorCode;
  warnCode?: string;
  [key: string]: unknown;
}

/**
 * An `item_complete` log entry — the per-case record readers (e.g.
 * compare-experiments) consume. Narrows the fields `run-eval` writes for a
 * completed item; still a `LogEntry` (open index signature) underneath.
 */
export interface ItemCompleteEntry extends LogEntry {
  event: 'item_complete';
  caseId?: string;
  issueCount?: number;
  durationMs?: number;
  scores?: Record<string, number | null>;
}

/**
 * The shape written to `evals/logs/<experimentName>-<ts>.json` by
 * {@link createRunLog}. This is the single source of truth for the run-log file
 * format; consumers import this type rather than redefining it.
 */
export interface RunLogFile {
  experimentName: string;
  preset: string;
  configPath: string;
  model: string;
  mode: string;
  provider: string;
  startedAt: string;
  finishedAt: string;
  totals: { successes: number; errors: number; warnings: number };
  errorBreakdown: Record<string, number>;
  warningBreakdown: Record<string, number>;
  entries: (LogEntry & { timestamp: string })[];
}

export interface RunLogConfig {
  experimentName: string;
  presetLabel: string;
  configPath: string;
  model: string;
  mode: string;
  provider: string;
}

export interface RunLog {
  add(entry: LogEntry): void;
  write(): string;
}

export function classifyError(err: unknown): ErrorCode {
  const msg = (
    typeof err === 'string'
      ? err
      : (err as { message?: string })?.message ?? String(err)
  ).toLowerCase();

  if (msg.includes('rate limit') || msg.includes('429')) return 'RATE_LIMITED';
  if (msg.includes('401') || msg.includes('bad credentials') || msg.includes('403')) return 'AUTH_FAILED';
  if (msg.includes('timed out') || msg.includes('aborted') || msg.includes('timeout')) return 'TIMEOUT';
  if (msg.includes('budget exhausted')) return 'BUDGET_EXHAUSTED';
  if (msg.includes('unexpected token') || msg.includes('json')) return 'PARSE_ERROR';
  if (msg.includes('econnrefused') || msg.includes('fetch failed')) return 'NETWORK_ERROR';
  if (msg.includes('500') || msg.includes('overloaded') || msg.includes('internal server error')) return 'API_ERROR';
  return 'UNKNOWN';
}

export function createRunLog(config: RunLogConfig): RunLog {
  const entries: (LogEntry & { timestamp: string })[] = [];
  const startedAt = new Date().toISOString();

  return {
    add(entry: LogEntry): void {
      entries.push({ ...entry, timestamp: new Date().toISOString() });
    },

    write(): string {
      const finishedAt = new Date().toISOString();

      const successes = entries.filter((e) => e.level === 'info' && e.event === 'item_complete').length;
      const errors = entries.filter((e) => e.level === 'error').length;
      const warnings = entries.filter((e) => e.level === 'warn').length;

      const errorBreakdown: Record<string, number> = {};
      for (const e of entries.filter((e) => e.level === 'error' && e.errorCode)) {
        const code = e.errorCode as string;
        errorBreakdown[code] = (errorBreakdown[code] ?? 0) + 1;
      }

      const warningBreakdown: Record<string, number> = {};
      for (const e of entries.filter((e) => e.level === 'warn' && e.warnCode)) {
        const code = e.warnCode as string;
        warningBreakdown[code] = (warningBreakdown[code] ?? 0) + 1;
      }

      const summary: RunLogFile = {
        experimentName: config.experimentName,
        preset: config.presetLabel,
        configPath: config.configPath,
        model: config.model,
        mode: config.mode,
        provider: config.provider,
        startedAt,
        finishedAt,
        totals: { successes, errors, warnings },
        errorBreakdown,
        warningBreakdown,
        entries,
      };

      fs.mkdirSync(LOGS_DIR, { recursive: true });
      // Sanitize the experiment name before using it as a filename: it can come
      // from a raw --experiment= CLI arg. sanitizeFilename() strips path
      // components and disallowed chars, so the write cannot escape LOGS_DIR.
      const safeName = sanitizeFilename(config.experimentName) || 'eval';
      const logFile = path.join(LOGS_DIR, `${safeName}-${Date.now()}.json`);
      fs.writeFileSync(logFile, JSON.stringify(summary, null, 2));
      return logFile;
    },
  };
}
