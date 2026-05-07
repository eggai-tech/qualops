// Copies authoritative markdown files from the repo root into the Starlight
// content directory, prepending the frontmatter Starlight requires. The output
// files are gitignored — only the source files in the repo root are committed.
//
// Run via `prebuild` and `predev` in package.json. Update the SOURCES array
// when adding more synced root documents.

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
		description: 'How to contribute to QualOps. Synced from CONTRIBUTING.md in the repository root.',
	},
];

function frontmatter({ title, description, sourcePath }) {
	const editUrl = `https://github.com/eggai-tech/qualops/edit/main/${sourcePath}`;
	return [
		'---',
		`title: ${title}`,
		`description: ${description}`,
		`editUrl: ${editUrl}`,
		'---',
		'',
	].join('\n');
}

async function sync() {
	for (const { from, to, title, description } of SOURCES) {
		const sourcePath = join(repoRoot, from);
		if (!existsSync(sourcePath)) {
			throw new Error(`sync-root-docs: source file not found: ${relative(repoRoot, sourcePath)}`);
		}
		const body = await readFile(sourcePath, 'utf8');
		const targetPath = join(contentDir, to);
		await mkdir(dirname(targetPath), { recursive: true });
		await writeFile(targetPath, frontmatter({ title, description, sourcePath: from }) + body);
		console.log(`synced ${from} -> ${relative(websiteDir, targetPath)}`);
	}
}

sync().catch((err) => {
	console.error(err);
	process.exit(1);
});
