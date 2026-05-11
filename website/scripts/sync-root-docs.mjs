// Copies authoritative markdown files from elsewhere in the repo into the
// Starlight content directory, normalising them so Starlight can render them:
//   - prepends the frontmatter Starlight requires (title, description, editUrl)
//   - optionally strips a pre-existing frontmatter block (showing it as an
//     adjacent `yaml` code block when relevant)
//   - optionally strips a leading H1 line so we don't render two H1s
//
// Output files are gitignored — only the source files are committed. Run via
// `predev` and `prebuild` in package.json. To add a new synced page, append to
// SOURCES; no other changes are needed.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteDir = resolve(fileURLToPath(import.meta.url), '../..');
const repoRoot = resolve(websiteDir, '..');
const contentDir = join(websiteDir, 'src', 'content', 'docs');

const SOURCES = [
  {
    from: 'CHANGELOG.md',
    to: 'changelog.md',
    title: 'Changelog',
    description: 'All notable changes to QualOps. Synced from CHANGELOG.md in the repository root.',
  },
  {
    from: 'CONTRIBUTING.md',
    to: 'contributing.md',
    title: 'Contributing',
    description:
      'How to contribute to QualOps. Synced from CONTRIBUTING.md in the repository root.',
  },
  {
    from: 'docs/github-setup.md',
    to: 'github-action/setup.md',
    title: 'GitHub Action setup',
    description:
      'Configure secrets, permissions, and the QualOps GitHub Action workflow for your repository.',
    stripFirstH1: true,
  },
  {
    from: 'examples/agents/comment-rewriter.md',
    to: 'examples/agents/comment-rewriter.md',
    title: 'Comment rewriter agent',
    description:
      'Reviews code comments and inline documentation quality, flagging missing or outdated docs.',
    stripFrontmatter: 'show-as-yaml',
  },
  {
    from: 'examples/agents/migration-checker.md',
    to: 'examples/agents/migration-checker.md',
    title: 'Migration checker agent',
    description:
      'Reviews database migration patterns for safety, reversibility, and lock-time impact.',
    stripFrontmatter: 'show-as-yaml',
  },
  {
    from: 'examples/agents/rxjs-migration.md',
    to: 'examples/agents/rxjs-migration.md',
    title: 'RxJS migration agent',
    description: 'Identifies deprecated RxJS patterns and suggests modern alternatives.',
    stripFrontmatter: 'show-as-yaml',
  },
  {
    from: 'examples/agents/angular-signals.md',
    to: 'examples/agents/angular-signals.md',
    title: 'Angular Signals agent',
    description:
      'Identifies Angular code that could migrate to the Signals reactivity model and flags anti-patterns.',
    stripFrontmatter: 'show-as-yaml',
  },
  {
    from: 'examples/claude-commands/setup-qualops.md',
    to: 'examples/claude-code-command.md',
    title: 'Claude Code: /setup-qualops',
    description:
      'Interactively configure QualOps from inside Claude Code using the bundled slash command.',
  },
];

// Wrap a value in YAML double quotes, escaping any embedded quotes/backslashes.
// Necessary for titles/descriptions that may contain colons (e.g. "Claude
// Code: /setup-qualops") which YAML would otherwise mis-tokenise as keys.
function yamlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function frontmatter({ title, description, sourcePath }) {
  const editUrl = `https://github.com/eggai-tech/qualops/edit/main/${sourcePath}`;
  return [
    '---',
    `title: ${yamlString(title)}`,
    `description: ${yamlString(description)}`,
    `editUrl: ${editUrl}`,
    '---',
    '',
  ].join('\n');
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n+/;
const LEADING_H1_RE = /^\s*# .+\r?\n+/;

function processBody(raw, { stripFrontmatter, stripFirstH1 }) {
  let body = raw;
  let strippedFrontmatter = '';
  const fmMatch = FRONTMATTER_RE.exec(body);
  if (fmMatch) {
    strippedFrontmatter = fmMatch[1];
    if (stripFrontmatter) body = body.slice(fmMatch[0].length);
  }
  if (stripFirstH1) body = body.replace(LEADING_H1_RE, '');

  if (stripFrontmatter === 'show-as-yaml' && strippedFrontmatter) {
    const trimmed = body.replace(/\s+$/, '');
    body =
      trimmed +
      '\n\n## Agent metadata\n\n' +
      'These fields are read by the Claude Agent SDK when the agent is loaded:\n\n' +
      '```yaml\n' +
      strippedFrontmatter +
      '\n```\n';
  }
  return body;
}

async function sync() {
  for (const src of SOURCES) {
    const sourcePath = join(repoRoot, src.from);
    if (!existsSync(sourcePath)) {
      throw new Error(`sync-root-docs: source file not found: ${relative(repoRoot, sourcePath)}`);
    }
    const raw = await readFile(sourcePath, 'utf8');
    const body = processBody(raw, src);
    const targetPath = join(contentDir, src.to);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(
      targetPath,
      frontmatter({ title: src.title, description: src.description, sourcePath: src.from }) + body,
    );
    console.log(`synced ${src.from} -> ${relative(websiteDir, targetPath)}`);
  }
}

sync().catch((err) => {
  console.error(err);
  process.exit(1);
});
