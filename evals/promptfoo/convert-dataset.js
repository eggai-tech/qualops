#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(
  process.argv
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v || 'true'];
    }),
);

const limit = args.limit ? parseInt(args.limit, 10) : Infinity;

const QUALOPS_DATASETS_DIR = path.join(__dirname, '../datasets');
const OUTPUT_FILE = path.join(__dirname, 'datasets', 'tests.json');

const ASSERTIONS = [
  'parse-assertion.js',
  'judge-assertion.js',
  'line-accuracy-assertion.js',
  'coverage-assertion.js',
  'severity-assertion.js',
].map((f) => ({ type: 'javascript', value: `file://${path.join(__dirname, f)}` }));

// Escape {{ / {% to prevent nunjucks interpolation
function escapeTemplatePatterns(str) {
  if (!str) return str;
  return str
    .replace(/\{\{/g, '{ {')
    .replace(/\}\}/g, '} }')
    .replace(/\{%/g, '{ %')
    .replace(/%\}/g, '% }');
}

function readJsonlLines(filePath, maxLines) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: ${filePath} not found, skipping`);
    return [];
  }
  const allLines = fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .filter((line) => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        console.warn(`Warning: skipping malformed JSON line in ${filePath}`);
        return false;
      }
    });
  return allLines.slice(0, maxLines);
}

function convertQualOpsCase(data, index) {
  const referenceBugs = (data.expected || []).map((e) => ({
    relevantFile: data.filePath,
    relevantLinesStart: e.line,
    relevantLinesEnd: e.lineEnd || e.line,
    type: e.type,
    severity: e.severity,
    description: e.description,
  }));

  return {
    description: `[qualops] ${data.id || `case-${index + 1}`}: ${data.filePath || 'unknown'}`,
    vars: {
      caseId: data.id || `qualops-${index + 1}`,
      source: 'qualops',
      filePath: data.filePath || 'unknown.ts',
      language: data.language || 'typescript',
      fullContent: escapeTemplatePatterns(data.fullContent || ''),
      diff: escapeTemplatePatterns(data.diff || ''),
      fileContent: '',
      patchWithLinesStr: '',
      referenceBugs: JSON.stringify(referenceBugs),
      referenceExpected: JSON.stringify(data.expected || []),
    },
    assert: ASSERTIONS,
  };
}

const files = fs
  .readdirSync(QUALOPS_DATASETS_DIR)
  .filter((f) => f.endsWith('.jsonl'));

const tests = [];
for (const file of files) {
  const lines = readJsonlLines(path.join(QUALOPS_DATASETS_DIR, file), limit);
  tests.push(...lines.map((l, i) => convertQualOpsCase(JSON.parse(l), i)));
}

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(tests, null, 2));
console.log(`Converted ${tests.length} examples to ${OUTPUT_FILE}`);
