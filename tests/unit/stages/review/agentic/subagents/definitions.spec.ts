import {
  getAllSubagentTypes,
  createSubagentDefinitions,
} from '@/stages/review/agentic/subagents/definitions';

describe('subagent definitions', () => {
  it('getAllSubagentTypes returns all built-in subagent type keys', () => {
    const types = getAllSubagentTypes();
    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBeGreaterThan(0);
    expect(types).toContain('security-analyzer');
  });

  it('createSubagentDefinitions includes enabled subagents', () => {
    const defs = createSubagentDefinitions({ enabledSubagents: ['security-analyzer'] });
    expect(defs['security-analyzer']).toBeDefined();
    expect(defs['dependency-tracer']).toBeUndefined();
  });

  it('createSubagentDefinitions includes all subagents when enabledSubagents is not provided', () => {
    const defs = createSubagentDefinitions({});
    const types = getAllSubagentTypes();
    expect(Object.keys(defs).length).toBe(types.length);
  });

  it('createSubagentDefinitions skips unknown subagent types', () => {
    const defs = createSubagentDefinitions({ enabledSubagents: ['__unknown__' as never] });
    expect(Object.keys(defs).length).toBe(0);
  });

  it('createSubagentDefinitions adds Bash tool when bash.subagentAccess is all', () => {
    const defs = createSubagentDefinitions({
      enabledSubagents: ['security-analyzer'],
      bash: { subagentAccess: 'all' },
    });
    expect(defs['security-analyzer']?.tools).toContain('Bash');
  });

  it('createSubagentDefinitions does not add Bash tool when bash.subagentAccess is none', () => {
    const defs = createSubagentDefinitions({
      enabledSubagents: ['security-analyzer'],
      bash: { subagentAccess: 'none' },
    });
    expect(defs['security-analyzer']?.tools).not.toContain('Bash');
  });
});
