// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://eggai-tech.github.io',
	base: '/qualops',
	trailingSlash: 'ignore',
	integrations: [
		starlight({
			title: 'QualOps',
			description: 'AI-powered code review for your PRs.',
			lastUpdated: true,
			customCss: ['./src/styles/custom.css'],
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/eggai-tech/qualops',
				},
				{
					icon: 'npm',
					label: 'npm',
					href: 'https://www.npmjs.com/package/@eggai/qualops',
				},
			],
			editLink: {
				baseUrl: 'https://github.com/eggai-tech/qualops/edit/main/website/',
			},
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Quick start', slug: 'getting-started/quick-start' },
						{ label: 'Installation', slug: 'getting-started/installation' },
					],
				},
				{
					label: 'GitHub Action',
					items: [
						{ label: 'Setup', slug: 'github-action/setup' },
						{ label: 'Inputs & outputs', slug: 'github-action/inputs' },
					],
				},
				{
					label: 'CLI usage',
					slug: 'cli/usage',
				},
				{
					label: 'Configuration',
					items: [
						{ label: 'Reference', slug: 'configuration/reference' },
						{ label: 'JSON Schema', slug: 'configuration/json-schema' },
					],
				},
				{
					label: 'Review modes',
					items: [
						{ label: 'File-by-file', slug: 'review-modes/file-by-file' },
						{ label: 'Agentic', slug: 'review-modes/agentic' },
					],
				},
				{
					label: 'AI providers',
					slug: 'ai-providers',
				},
				{
					label: 'Examples',
					items: [
						{ label: 'Configurations', slug: 'examples/configurations' },
						{
							label: 'Custom agents',
							items: [
								{ label: 'Overview', slug: 'examples/custom-agents' },
								{ label: 'Comment rewriter', slug: 'examples/agents/comment-rewriter' },
								{ label: 'Migration checker', slug: 'examples/agents/migration-checker' },
								{ label: 'RxJS migration', slug: 'examples/agents/rxjs-migration' },
								{ label: 'Angular Signals', slug: 'examples/agents/angular-signals' },
							],
						},
						{ label: 'Claude Code command', slug: 'examples/claude-code-command' },
					],
				},
				{ label: 'Contributing', slug: 'contributing' },
				{ label: 'Changelog', slug: 'changelog' },
			],
		}),
	],
});
