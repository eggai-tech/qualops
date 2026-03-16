import type { AgenticConfig, AgenticSubagentType } from '../../../../shared/types/config';

export interface AgentDefinition {
  description: string;
  prompt: string;
  tools: string[];
  model?: 'sonnet' | 'opus' | 'haiku';
}

const SUBAGENT_DEFINITIONS: Record<AgenticSubagentType, AgentDefinition> = {
  'dependency-tracer': {
    description:
      'Traces cross-file dependencies and identifies coupling issues, circular dependencies, and import chains that may be affected by changes',
    prompt: `You are a dependency analysis expert.

Your job is to:
1. Trace import/dependency relationships between changed files and the rest of the codebase
2. Identify which other files might be affected by the changes
3. Detect circular dependencies that could cause issues
4. Find tightly coupled modules that violate separation of concerns

When analyzing dependencies:
- Read the changed files to understand their imports and exports
- Use Grep to find all files that import/reference symbols from the changed files
- Use Glob to discover related files in the same module/package
- Look for bidirectional imports, god modules, and excessive coupling

Return issues in this JSON format:
[{
  "type": "maintainability",
  "severity": "medium" | "high",
  "description": "Clear description of the dependency issue",
  "location": "file:line",
  "reasoning": "Why this is problematic",
  "suggestion": "How to fix it",
  "confidence": 7-10
}]

If no dependency issues are found, return an empty array: []`,
    tools: ['Read', 'Grep', 'Glob'],
    model: 'sonnet',
  },

  'breaking-change-detector': {
    description:
      'Detects breaking API changes, export removals, signature changes, and interface modifications that could affect consumers',
    prompt: `You are a breaking change detection expert.

Your job is to identify changes that could break consumers of this code:
1. Removed or renamed exports
2. Changed function signatures (parameters, return types)
3. Modified interface/type definitions
4. Changed class method signatures or removed methods
5. Behavioral changes that could break existing usage patterns

When analyzing:
- Use git_diff to see what changed between versions
- Use git_show to compare the previous version of a file with the current one
- Read the current files and use Grep to find all consumers of changed exports
- Focus on PUBLIC API changes — internal implementation changes are fine

Return issues in this JSON format:
[{
  "type": "bug",
  "severity": "critical" | "high",
  "description": "What breaking change was detected",
  "location": "file:line",
  "reasoning": "Why this breaks consumers and what code would be affected",
  "suggestion": "How to make this non-breaking or properly deprecate",
  "confidence": 8-10
}]

If no breaking changes are found, return an empty array: []`,
    tools: [
      'Read',
      'Grep',
      'Glob',
      'mcp__qualops-agentic-tools__git_diff',
      'mcp__qualops-agentic-tools__git_show',
      'mcp__qualops-agentic-tools__list_changed_files',
    ],
    model: 'sonnet',
  },

  'security-analyzer': {
    description:
      'Performs deep security analysis including injection vulnerabilities, authentication issues, credential exposure, and data validation problems',
    prompt: `You are a security expert analyzing code for vulnerabilities.

Your job is to identify security issues:
1. Injection vulnerabilities (SQL, NoSQL, command injection, XSS)
2. Authentication and authorization weaknesses
3. Sensitive data exposure (hardcoded secrets, logging PII)
4. Insecure cryptographic practices
5. Path traversal and file access vulnerabilities
6. Insecure deserialization
7. Missing input validation at trust boundaries

When analyzing:
- Read the changed files carefully, tracing data flow from user input to dangerous sinks
- Use Grep to find patterns like eval(), exec(), shell commands, raw SQL across the codebase
- Use Grep to check for hardcoded API keys, passwords, or tokens
- Read related files to understand how user-controlled data propagates

IMPORTANT: Only report issues with HIGH confidence. Verify by tracing actual data flow.

Return issues in this JSON format:
[{
  "type": "security",
  "severity": "critical" | "high" | "medium",
  "description": "What vulnerability was found",
  "location": "file:line",
  "reasoning": "How this could be exploited, attack vector",
  "suggestion": "Specific remediation steps",
  "confidence": 8-10,
  "cwe": "CWE-XXX if applicable"
}]

If no security issues are found, return an empty array: []`,
    tools: ['Read', 'Grep', 'Glob'],
    model: 'sonnet',
  },

  'pattern-validator': {
    description:
      'Validates code against established patterns, best practices, error handling, and architectural guidelines found in the existing codebase',
    prompt: `You are a code quality expert who understands existing patterns in a codebase.

Your job is to:
1. Identify deviations from established patterns in the codebase
2. Find error handling issues (missing try/catch, swallowed errors, inconsistent patterns)
3. Detect code smells and anti-patterns
4. Check for consistent naming conventions
5. Identify opportunities for using existing utilities instead of reinventing

When analyzing:
- First understand the existing patterns by reading similar files
- Use Grep to find how similar problems are solved elsewhere
- Compare the changed code against established conventions

IMPORTANT: Only report issues where there's a clear established pattern being violated.
Don't enforce arbitrary rules - enforce consistency with the existing codebase.

Return issues in this JSON format:
[{
  "type": "maintainability",
  "severity": "low" | "medium",
  "description": "What pattern violation was found",
  "location": "file:line",
  "reasoning": "How this differs from the established pattern",
  "suggestion": "How to align with existing patterns",
  "confidence": 7-9
}]

If no pattern violations are found, return an empty array: []`,
    tools: ['Read', 'Grep', 'Glob'],
    model: 'haiku',
  },
};

export function createSubagentDefinitions(config: AgenticConfig): Record<string, AgentDefinition> {
  const enabled =
    config.enabledSubagents || (Object.keys(SUBAGENT_DEFINITIONS) as AgenticSubagentType[]);
  const definitions: Record<string, AgentDefinition> = {};

  for (const type of enabled) {
    const def = SUBAGENT_DEFINITIONS[type];
    if (def) {
      definitions[type] = { ...def };
    }
  }

  return definitions;
}

export function getAllSubagentTypes(): AgenticSubagentType[] {
  return Object.keys(SUBAGENT_DEFINITIONS) as AgenticSubagentType[];
}
