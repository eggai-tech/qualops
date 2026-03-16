import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

const schemaPath = join(__dirname, '../../docs/qualops-config.schema.json');

// Zod definitions mirroring the JSON Schema meta-structure
// Note that future support for JSON schema is in preview: https://zod.dev/json-schema
const jsonSchemaPrimitive = z.enum(['string', 'number', 'integer', 'boolean', 'object', 'array']);

const defObject = z.object({
  type: jsonSchemaPrimitive.optional(),
  description: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  required: z.array(z.string()).optional(),
  $ref: z.string().optional(),
  anyOf: z.array(z.unknown()).optional(),
  oneOf: z.array(z.unknown()).optional(),
  enum: z.array(z.unknown()).optional(),
  items: z.unknown().optional(),
});

const topLevelSchema = z.object({
  $schema: z.string().min(1),
  $id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  type: z.literal('object'),
  additionalProperties: z.boolean(),
  required: z.array(z.string()).min(1),
  properties: z.record(z.string(), z.unknown()),
  $defs: z.record(z.string(), defObject),
});

// Required top-level property keys
const REQUIRED_TOP_LEVEL_REQUIRED = ['ai', 'review'];

// Required $defs keys
const REQUIRED_DEFS = [
  'aiStageConfig',
  'aiProvider',
  'reviewConfig',
  'pipelineJob',
  'pipelineJobFileByFile',
  'pipelineJobAgentic',
  'reviewPass',
  'validationConfig',
  'deduplicationConfig',
  'performanceConfig',
  'fixConfig',
  'reportConfig',
  'githubConfig',
  'gitlabConfig',
  'loggerConfig',
  'severity',
  'issueType',
];

// Required properties on specific $defs
const DEF_REQUIRED_FIELDS: Record<string, string[]> = {
  aiStageConfig: ['provider', 'model', 'inputPerMillion', 'outputPerMillion'],
  reviewPass: ['name', 'enabled', 'prompt'],
  pipelineJobFileByFile: ['name', 'enabled', 'passes'],
  pipelineJobAgentic: ['name', 'enabled', 'mode'],
  customAgentDefinition: ['name', 'description', 'prompt'],
  promptConfig: ['file'],
  reviewConfig: ['pipeline'],
};

describe('qualops-config.schema.json integrity', () => {
  let raw: unknown;
  let schema: z.infer<typeof topLevelSchema>;

  beforeAll(() => {
    const content = readFileSync(schemaPath, 'utf-8');
    raw = JSON.parse(content);
    schema = topLevelSchema.parse(raw);
  });

  it('parses as valid JSON and matches top-level schema shape', () => {
    expect(schema).toBeDefined();
  });

  it('has the correct $schema and $id', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toContain('qualops-config.schema.json');
  });

  it('requires "ai" and "review" at the top level', () => {
    for (const field of REQUIRED_TOP_LEVEL_REQUIRED) {
      expect(schema.required).toContain(field);
    }
  });

  it('has all expected $defs', () => {
    for (const def of REQUIRED_DEFS) {
      expect(schema.$defs).toHaveProperty(def);
    }
  });

  it.each(Object.entries(DEF_REQUIRED_FIELDS))(
    '$defs.%s has the expected required fields',
    (defName, requiredFields) => {
      const def = schema.$defs[defName];
      expect(def).toBeDefined();
      for (const field of requiredFields) {
        expect(def.required).toContain(field);
      }
    },
  );

  it('aiProvider enum contains the three supported providers', () => {
    const aiProvider = schema.$defs['aiProvider'];
    expect(aiProvider.enum).toEqual(expect.arrayContaining(['anthropic', 'openai', 'bedrock']));
  });

  it('severity enum contains all four severity levels', () => {
    const severity = schema.$defs['severity'];
    expect(severity.enum).toEqual(expect.arrayContaining(['critical', 'high', 'medium', 'low']));
  });

  it('issueType enum contains all four issue types', () => {
    const issueType = schema.$defs['issueType'];
    expect(issueType.enum).toEqual(
      expect.arrayContaining(['bug', 'security', 'performance', 'maintainability']),
    );
  });

  it('pipelineJob uses oneOf referencing agentic and file-by-file variants', () => {
    const pipelineJob = schema.$defs['pipelineJob'];
    expect(pipelineJob.oneOf).toBeDefined();
    expect(pipelineJob.oneOf).toHaveLength(2);
    const refs = (pipelineJob.oneOf as Array<{ $ref: string }>).map((o) => o.$ref);
    expect(refs).toContain('#/$defs/pipelineJobAgentic');
    expect(refs).toContain('#/$defs/pipelineJobFileByFile');
  });

  it('all $ref values within $defs point to existing definitions or valid paths', () => {
    const refPattern = /^#\/\$defs\/(.+)$/;
    for (const [defName, def] of Object.entries(schema.$defs)) {
      const checkRefs = (node: unknown, path: string) => {
        if (node === null || typeof node !== 'object') return;
        const obj = node as Record<string, unknown>;
        if ('$ref' in obj && typeof obj.$ref === 'string') {
          const match = obj.$ref.match(refPattern);
          if (match) {
            expect(schema.$defs).toHaveProperty(
              match[1],
              // include path for easier debugging
            );
          }
        }
        for (const value of Object.values(obj)) {
          checkRefs(value, `${path} > ${JSON.stringify(value)?.slice(0, 40)}`);
        }
      };
      checkRefs(def, defName);
    }
  });

  it('top-level properties that use $ref point to existing $defs', () => {
    const refPattern = /^#\/\$defs\/(.+)$/;
    for (const [_propName, propValue] of Object.entries(schema.properties)) {
      const prop = propValue as Record<string, unknown>;
      if (typeof prop.$ref === 'string') {
        const match = prop.$ref.match(refPattern);
        if (match) {
          expect(schema.$defs).toHaveProperty(match[1]);
        }
      }
    }
  });
});
