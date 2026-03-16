const path = require('path');
const fs = require('fs');

const QUALOPS_ROOT = path.join(__dirname, '../..');

function loadEnv() {
  try {
    const dotenv = require('dotenv');
    dotenv.config({ path: path.join(QUALOPS_ROOT, '.env') });
  } catch {
    // dotenv may not be available, rely on shell env
  }
}

/**
 * Handles two diff formats:
 * 1. Standard unified diff (@@ hunk headers, +/- prefixes)
 * 2. Kodus patchWithLinesStr ("N +" / "N -" line-number prefixed)
 */
function parseDiffLines(diffStr) {
  const additions = new Set();
  const deletions = new Set();
  const modifications = new Set();

  if (!diffStr) return { additions, deletions, modifications };

  const isKodus = /^\d+ [+\- ]/.test(diffStr.split('\n').find(l => /^\d+ /.test(l)) || '');

  if (isKodus) {
    for (const line of diffStr.split('\n')) {
      const addMatch = line.match(/^(\d+) \+/);
      if (addMatch) { additions.add(parseInt(addMatch[1], 10)); continue; }
      const delMatch = line.match(/^(\d+) -/);
      if (delMatch) { deletions.add(parseInt(delMatch[1], 10)); }
    }
    return { additions, deletions, modifications };
  }

  let newLineNumber = 0;
  for (const line of diffStr.split('\n')) {
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      newLineNumber = parseInt(hunkMatch[1], 10);
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions.add(newLineNumber);
      newLineNumber++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions.add(newLineNumber);
    } else if (!line.startsWith('\\')) {
      newLineNumber++;
    }
  }

  return { additions, deletions, modifications };
}

/**
 * Kodus fullContent is a sparse excerpt with "N: content" lines and
 * "<- CUT CONTENT ->" markers. Reconstruct at real line numbers so
 * the model reports line numbers matching the reference.
 */
function normalizeKodusContent(content) {
  const lines = content.split('\n');

  const hasNumberedLines = lines.some(l => /^\d+: ?/.test(l));
  if (!hasNumberedLines) return content;

  const byLineNumber = {};
  let maxLineNumber = 0;
  for (const line of lines) {
    const m = line.match(/^(\d+): ?(.*)/);
    if (m) {
      const lineNo = parseInt(m[1], 10);
      byLineNumber[lineNo] = m[2];
      if (lineNo > maxLineNumber) maxLineNumber = lineNo;
    }
  }

  const output = [];
  for (let i = 1; i <= maxLineNumber; i++) {
    output.push(i in byLineNumber ? byLineNumber[i] : '');
  }

  return output.join('\n');
}

function buildFileInfo(vars) {
  const filePath = vars.filePath || 'unknown.ts';
  const rawContent = vars.fullContent || vars.fileContent || '';
  const rawDiff = vars.diff || vars.patchWithLinesStr || '';

  const content = normalizeKodusContent(rawContent);
  const diff = parseDiffLines(rawDiff);

  return {
    path: filePath,
    content,
    diff,
    rawDiff,
  };
}

let _providerModule = null;

async function getProviderModule() {
  if (_providerModule) return _providerModule;

  try {
    require('ts-node').register({
      transpileOnly: true,
      project: path.join(QUALOPS_ROOT, 'tsconfig.base.json'),
    });
  } catch {
    // ts-node may already be registered
  }

  try {
    const { register } = require('tsconfig-paths');
    register({
      baseUrl: QUALOPS_ROOT,
      paths: {
        '@/*': ['src/*'],
        '@evals/*': ['evals/src/*'],
      },
    });
  } catch {
    // tsconfig-paths may not be available
  }

  _providerModule = true;
  return _providerModule;
}

class QualOpsProvider {
  constructor(modelName, providerName, mode) {
    this.modelName = modelName || 'claude-sonnet-4-20250514';
    this.providerName = providerName || 'anthropic';
    this.mode = mode || 'file-by-file';
    this._initialized = false;
  }

  id() {
    return `qualops:${this.modelName}:${this.providerName}:${this.mode}`;
  }

  async _ensureInit() {
    if (this._initialized) return;
    loadEnv();
    await getProviderModule();

    // QualOps expects cwd to be repo root (ConfigService resolves
    // .qualopsrc.json relative to cwd). Must set before first require()
    // of any QualOps TS module since GlobalRateLimiter triggers
    // ConfigService.getInstance() at module load time.
    if (!fs.existsSync(path.join(process.cwd(), '.qualops/.qualopsrc.json'))) {
      process.chdir(QUALOPS_ROOT);
    }

    this._initialized = true;
  }

  async callApi(prompt, context) {
    await this._ensureInit();

    const vars = context?.vars || {};
    const fileInfo = buildFileInfo(vars);

    // Lazy-import: must happen after _ensureInit sets cwd for ConfigService
    const { runReview } = require('../src/provider');

    const config = {
      name: this.id(),
      model: this.modelName,
      mode: this.mode,
      provider: this.providerName,
    };

    try {
      const result = await runReview(
        {
          id: vars.caseId || 'promptfoo-case',
          language: vars.language || 'typescript',
          filePath: fileInfo.path,
          diff: vars.diff || vars.patchWithLinesStr || '',
          fullContent: fileInfo.content,
          expected: [], // not needed for running, only for scoring
        },
        config,
      );

      const output = JSON.stringify(result.issues, null, 2);
      return {
        output,
        tokenUsage: {
          total: result.tokenUsage?.input + result.tokenUsage?.output || 0,
          prompt: result.tokenUsage?.input || 0,
          completion: result.tokenUsage?.output || 0,
        },
      }
    } catch (error) {
      return {
        error: error.message || String(error),
      };
    }
  }
}

module.exports = class {
  constructor(options) {
    this.provider = new QualOpsProvider(
      options?.config?.model || 'claude-sonnet-4-20250514',
      options?.config?.provider || 'anthropic',
      options?.config?.mode || 'file-by-file',
    );
  }

  id() {
    return this.provider.id();
  }

  async callApi(prompt, context) {
    return this.provider.callApi(prompt, context);
  }
};
