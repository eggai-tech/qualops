import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { AgentLoader } from '@/stages/review/agentic/loaders/agent-loader';

const tmpDir = join(__dirname, '__tmp_agent_loader__');
const agentsDir = join(tmpDir, '.qualops', 'agents');

beforeAll(() => {
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(
    join(agentsDir, 'test-agent.md'),
    '---\ndescription: A test agent\ntools: [Read, Grep]\nmodel: sonnet\n---\nYou are a test agent.',
  );
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('AgentLoader', () => {
  describe('path traversal protection', () => {
    it('rejects agentsDir with ../ traversal', () => {
      const loader = new AgentLoader(tmpDir);
      const result = loader.loadCustomAgents({ agentsDir: '../../etc' });
      expect(result).toEqual({});
    });

    it('rejects agentsDir with embedded traversal', () => {
      const loader = new AgentLoader(tmpDir);
      const result = loader.loadCustomAgents({ agentsDir: 'foo/../../../etc' });
      expect(result).toEqual({});
    });

    it('rejects absolute agentsDir outside cwd', () => {
      const loader = new AgentLoader(tmpDir);
      const result = loader.loadCustomAgents({ agentsDir: '/tmp/evil' });
      expect(result).toEqual({});
    });

    it('allows a relative agentsDir within cwd', () => {
      const loader = new AgentLoader(tmpDir);
      const result = loader.loadCustomAgents({ agentsDir: '.qualops/agents' });
      expect(Object.keys(result)).toContain('test-agent');
    });
  });

  describe('loading agents from markdown', () => {
    it('loads agent definition with frontmatter fields', () => {
      const loader = new AgentLoader(tmpDir);
      const result = loader.loadCustomAgents({ agentsDir: '.qualops/agents' });
      const agent = result['test-agent'];
      expect(agent).toBeDefined();
      expect(agent.description).toBe('A test agent');
      expect(agent.prompt).toBe('You are a test agent.');
      expect(agent.tools).toEqual(['Read', 'Grep']);
      expect(agent.model).toBe('sonnet');
    });

    it('skips markdown files with empty body', () => {
      const emptyDir = join(tmpDir, 'empty-agents');
      mkdirSync(emptyDir, { recursive: true });
      writeFileSync(join(emptyDir, 'empty.md'), '---\ndescription: empty\n---\n   ');

      const loader = new AgentLoader(tmpDir);
      const result = loader.loadCustomAgents({ agentsDir: 'empty-agents' });
      expect(result).toEqual({});

      rmSync(emptyDir, { recursive: true, force: true });
    });

    it('returns empty when agents directory does not exist', () => {
      const loader = new AgentLoader(tmpDir);
      const result = loader.loadCustomAgents({ agentsDir: 'nonexistent' });
      expect(result).toEqual({});
    });
  });

  describe('inline custom agents', () => {
    it('loads agents from customAgents config', () => {
      const loader = new AgentLoader(tmpDir);
      const result = loader.loadCustomAgents({
        agentsDir: 'nonexistent',
        customAgents: [
          {
            name: 'inline-agent',
            description: 'An inline agent',
            prompt: 'Do things.',
          },
        ],
      });
      expect(result['inline-agent']).toBeDefined();
      expect(result['inline-agent'].description).toBe('An inline agent');
      expect(result['inline-agent'].prompt).toBe('Do things.');
      expect(result['inline-agent'].tools).toEqual(['Read', 'Grep', 'Glob']);
      expect(result['inline-agent'].model).toBe('sonnet');
    });
  });
});
