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

const source = args.source || 'qualops';
const lang = args.lang || 'all';
const limit = args.limit ? parseInt(args.limit, 10) : Infinity;
const datasetType = args['dataset-type'] || 'all';

const QUALOPS_DATASETS_DIR = path.join(__dirname, '../datasets');
const KODUS_DATASETS_DIR =
  args.dir ||
  path.join(__dirname, '../datasets/kodus');

const OUTPUT_FILE = path.join(__dirname, 'datasets', 'tests.json');

const ASSERTIONS = [
  'parse-assertion.js',
  'judge-assertion.js',
  'line-accuracy-assertion.js',
  'coverage-assertion.js',
  'severity-assertion.js',
].map((f) => ({ type: 'javascript', value: `file://${path.join(__dirname, f)}` }));

const KODUS_DATASETS = {
  tsjs: 'tsjs.jsonl',
  tsjs_crossfile: 'tsjs_crossfile.jsonl',
  react: 'react.jsonl',
  react_crossfile: 'react_crossfile.jsonl',
  python: 'python.jsonl',
  python_crossfile: 'python_crossfile.jsonl',
  java: 'java.jsonl',
  java_crossfile: 'java_crossfile.jsonl',
  ruby: 'ruby.jsonl',
  ruby_crossfile: 'ruby_crossfile.jsonl',
};

function filterByDatasetType(datasets) {
  if (datasetType === 'all') return datasets;
  if (datasetType === 'normal') {
    return Object.fromEntries(
      Object.entries(datasets).filter(([key]) => !key.endsWith('_crossfile')),
    );
  }
  if (datasetType === 'crossfile') {
    return Object.fromEntries(
      Object.entries(datasets).filter(([key]) => key.endsWith('_crossfile')),
    );
  }
  console.error(
    `Unknown dataset-type: ${datasetType}. Options: normal, crossfile, all`,
  );
  process.exit(1);
}

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

function convertKodusCase(data, index) {
  const inputs = data.inputs?.inputs || data.inputs || {};
  const outputs = data.outputs?.reference_outputs || data.outputs || {};
  const codeSuggestions = outputs.codeSuggestions || [];

  const referenceBugs = codeSuggestions.map((s) => ({
    relevantFile: s.relevantFile,
    relevantLinesStart: s.relevantLinesStart,
    relevantLinesEnd: s.relevantLinesEnd,
    type: s.label || 'bug',
    severity: s.severity || 'medium',
    description: s.suggestionContent || s.oneSentenceSummary || '',
  }));

  const expected = codeSuggestions.map((s) => ({
    line: s.relevantLinesStart,
    lineEnd: s.relevantLinesEnd,
    type: mapKodusLabel(s.label),
    severity: mapKodusSeverity(s.severity),
    category: s.label || 'bug',
    description: s.suggestionContent || s.oneSentenceSummary || '',
  }));

  return {
    description: `[kodus] case-${index + 1}: ${inputs.filePath || 'unknown'}`,
    vars: {
      caseId: `kodus-${index + 1}`,
      source: 'kodus',
      filePath: inputs.filePath || 'unknown.ts',
      language: inputs.language || 'typescript',
      fullContent: escapeTemplatePatterns(inputs.fileContent || ''),
      diff: escapeTemplatePatterns(inputs.patchWithLinesStr || ''),
      fileContent: escapeTemplatePatterns(inputs.fileContent || ''),
      patchWithLinesStr: escapeTemplatePatterns(
        inputs.patchWithLinesStr || '',
      ),
      referenceBugs: JSON.stringify(referenceBugs),
      referenceExpected: JSON.stringify(expected),
      referenceCodeSuggestions: JSON.stringify(codeSuggestions, null, 2),
    },
    assert: ASSERTIONS,
  };
}

function mapKodusLabel(label) {
  const map = {
    bug_risk: 'bug',
    performance: 'performance',
    security: 'security',
    maintainability: 'maintainability',
    possible_bug: 'bug',
    error_handling: 'bug',
  };
  return map[label] || 'bug';
}

function mapKodusSeverity(severity) {
  if (typeof severity === 'number') {
    if (severity >= 8) return 'critical';
    if (severity >= 6) return 'high';
    if (severity >= 4) return 'medium';
    return 'low';
  }
  return severity || 'medium';
}

let tests = [];

if (source === 'qualops') {
  const files = fs
    .readdirSync(QUALOPS_DATASETS_DIR)
    .filter((f) => f.endsWith('.jsonl'));
  for (const file of files) {
    const lines = readJsonlLines(path.join(QUALOPS_DATASETS_DIR, file), limit);
    tests.push(...lines.map((l, i) => convertQualOpsCase(JSON.parse(l), i)));
  }
} else if (source === 'kodus') {
  const filtered = filterByDatasetType(KODUS_DATASETS);
  const files =
    lang === 'all'
      ? Object.values(filtered)
      : filtered[lang]
        ? [filtered[lang]]
        : (() => {
            console.error(
              `Unknown lang: ${lang}. Options: ${Object.keys(filtered).join(', ')}, all`,
            );
            process.exit(1);
          })();

  for (const file of files) {
    const filePath = path.join(KODUS_DATASETS_DIR, file);
    const lines = readJsonlLines(filePath, limit);
    tests.push(...lines.map((l, i) => convertKodusCase(JSON.parse(l), i)));
  }
} else {
  console.error(`Unknown source: ${source}. Options: qualops, kodus`);
  process.exit(1);
}

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(tests, null, 2));
console.log(
  `Converted ${tests.length} examples from ${source} to ${OUTPUT_FILE}`,
);
