'use strict';

const path = require('path');
const fs = require('fs');

const { LOGS_DIR } = require('./config');

function classifyError(err) {
  const msg = (err.message || String(err)).toLowerCase();
  if (msg.includes('rate') || msg.includes('429')) return 'RATE_LIMITED';
  if (msg.includes('401') || msg.includes('403') || msg.includes('auth') || msg.includes('credentials')) return 'AUTH_FAILED';
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) return 'TIMEOUT';
  if (msg.includes('budget')) return 'BUDGET_EXHAUSTED';
  if (msg.includes('parse') || msg.includes('json') || msg.includes('unexpected token')) return 'PARSE_ERROR';
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('fetch failed')) return 'NETWORK_ERROR';
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('overloaded')) return 'API_ERROR';
  return 'UNKNOWN';
}

function createRunLog(config) {
  const startedAt = new Date().toISOString();
  const entries = [];

  return {
    add(entry) {
      entries.push({ timestamp: new Date().toISOString(), ...entry });
    },
    write() {
      fs.mkdirSync(LOGS_DIR, { recursive: true });

      const errors = entries.filter((e) => e.level === 'error');
      const warnings = entries.filter((e) => e.level === 'warn');
      const successes = entries.filter((e) => e.level === 'info' && e.event === 'item_complete');

      const summary = {
        experiment: config ? config.experimentName : 'unknown',
        preset: config ? config.presetLabel : 'default',
        configPath: config ? config.configPath : '',
        model: config ? config.model : '',
        mode: config ? config.mode : '',
        provider: config ? config.provider : '',
        startedAt,
        finishedAt: new Date().toISOString(),
        totals: {
          items: successes.length + errors.length,
          successes: successes.length,
          errors: errors.length,
          warnings: warnings.length,
        },
        errorBreakdown: {},
        warningBreakdown: {},
        entries,
      };

      for (const e of errors) {
        const code = e.errorCode || 'UNKNOWN';
        summary.errorBreakdown[code] = (summary.errorBreakdown[code] || 0) + 1;
      }

      for (const w of warnings) {
        const code = w.warnCode || 'UNKNOWN';
        summary.warningBreakdown[code] = (summary.warningBreakdown[code] || 0) + 1;
      }

      const expName = config ? config.experimentName : 'unknown';
      const slug = expName.replace(/[/:]/g, '_');
      const logFile = path.join(LOGS_DIR, `${slug}.json`);
      fs.writeFileSync(logFile, JSON.stringify(summary, null, 2) + '\n');
      return logFile;
    },
  };
}

module.exports = { classifyError, createRunLog };
