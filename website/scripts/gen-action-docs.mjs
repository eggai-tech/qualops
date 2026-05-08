// Generates the GitHub Action inputs/outputs reference page from the canonical
// action.yml at the repo root. Output is gitignored; the action.yml is the
// single source of truth.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const websiteDir = resolve(fileURLToPath(import.meta.url), '../..');
const repoRoot = resolve(websiteDir, '..');
const actionPath = join(repoRoot, 'action.yml');
const targetPath = join(websiteDir, 'src', 'content', 'docs', 'github-action', 'inputs.mdx');

function escape(value) {
  if (value == null) return '';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function inputsTable(inputs) {
  if (!inputs || Object.keys(inputs).length === 0) return '_No inputs defined._\n';
  const rows = Object.entries(inputs).map(([name, spec]) => {
    const required = spec.required ? '**yes**' : 'no';
    const defaultValue = spec.default ? `\`${escape(spec.default)}\`` : '—';
    return `| \`${name}\` | ${escape(spec.description)} | ${required} | ${defaultValue} |`;
  });
  return ['| Input | Description | Required | Default |', '|---|---|---|---|', ...rows].join('\n');
}

function outputsTable(outputs) {
  if (!outputs || Object.keys(outputs).length === 0) return '_No outputs defined._\n';
  const rows = Object.entries(outputs).map(
    ([name, spec]) => `| \`${name}\` | ${escape(spec.description)} |`,
  );
  return ['| Output | Description |', '|---|---|', ...rows].join('\n');
}

async function generate() {
  if (!existsSync(actionPath)) {
    throw new Error(`gen-action-docs: action.yml not found at ${actionPath}`);
  }
  const raw = await readFile(actionPath, 'utf8');
  const action = parseYaml(raw);

  const body = `---
title: Action inputs & outputs
description: Reference for every input and output exposed by the QualOps GitHub Action. Generated from action.yml.
editUrl: https://github.com/eggai-tech/qualops/edit/main/action.yml
---

${action.description ? `> ${action.description}\n\n` : ''}This page is generated from [\`action.yml\`](https://github.com/eggai-tech/qualops/blob/main/action.yml). Edit that file, not this page.

## Inputs

${inputsTable(action.inputs)}

## Outputs

${outputsTable(action.outputs)}
`;

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, body);
  console.log(`generated action.yml -> ${targetPath.replace(websiteDir + '/', '')}`);
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
