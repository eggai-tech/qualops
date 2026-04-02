import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { qualopsConfigSchema } from '@/config/config-schema';

const schemaPath = join(__dirname, '../../docs/qualops-config.schema.json');

describe('qualops-config.schema.json integrity (Zod-generated)', () => {
  let schema: Record<string, unknown>;

  beforeAll(() => {
    const content = readFileSync(schemaPath, 'utf-8');
    schema = JSON.parse(content);
  });

  function resolveDef(prop: Record<string, unknown>): Record<string, unknown> {
    const ref = prop.$ref as string | undefined;
    if (!ref) return prop;
    const name = ref.replace('#/$defs/', '');
    return (schema.$defs as Record<string, Record<string, unknown>>)[name];
  }

  it('is valid JSON with expected top-level structure', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toContain('qualops-config.schema.json');
    expect(schema.title).toBe('QualOps Configuration');
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
  });

  it('requires "ai" and "review"', () => {
    expect(schema.required).toEqual(expect.arrayContaining(['ai', 'review']));
  });

  it('has top-level properties for all config sections', () => {
    const props = Object.keys(schema.properties as Record<string, unknown>);
    expect(props).toEqual(
      expect.arrayContaining([
        '$schema',
        'ai',
        'review',
        'performance',
        'fix',
        'report',
        'github',
        'gitlab',
        'logger',
        'paths',
        'skipPatterns',
      ]),
    );
  });

  it('marks deprecated top-level fields', () => {
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const deprecatedFields = [
      'paths',
      'skipPatterns',
      'includePatterns',
      'maxFilesPerBatch',
      'maxConcurrency',
      'cacheEnabled',
      'cacheTTL',
      'outputFormat',
      'outputPath',
      'verbose',
      'debug',
      'maxFileSizeKB',
      'maxTokensPerFile',
      'maxReactSteps',
    ];
    for (const field of deprecatedFields) {
      expect(properties[field]?.deprecated).toBe(true);
    }
  });

  it('ai.reviewStage has required fields: provider, model, inputPerMillion, outputPerMillion', () => {
    const aiProp = (schema.properties as any).ai;
    const aiDef = resolveDef(aiProp);
    const reviewStageRef = aiDef.properties?.reviewStage?.$ref;
    expect(reviewStageRef).toBeDefined();

    const defName = reviewStageRef.replace('#/$defs/', '');
    const def = (schema.$defs as Record<string, any>)[defName];
    expect(def).toBeDefined();
    expect(def.required).toEqual(
      expect.arrayContaining(['provider', 'model', 'inputPerMillion', 'outputPerMillion']),
    );
  });

  it('review section requires pipeline', () => {
    const reviewProp = (schema.properties as any).review;
    const reviewDef = resolveDef(reviewProp);
    expect(reviewDef.required).toContain('pipeline');
  });

  it('all $ref values point to existing $defs', () => {
    const defs = schema.$defs as Record<string, unknown>;
    const refPattern = /^#\/\$defs\/(.+)$/;

    const checkRefs = (node: unknown) => {
      if (node === null || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if ('$ref' in obj && typeof obj.$ref === 'string') {
        const match = obj.$ref.match(refPattern);
        if (match) {
          expect(defs).toHaveProperty(match[1]);
        }
      }
      for (const value of Object.values(obj)) {
        checkRefs(value);
      }
    };

    checkRefs(schema);
  });

  it('matches the Zod schema via round-trip generation', () => {
    // Generate the JSON Schema from the same Zod source
    const generated = z.toJSONSchema(qualopsConfigSchema, {
      reused: 'ref',
    }) as Record<string, unknown>;

    // The file should match the generated output (excluding metadata fields we add)
    expect(schema.type).toBe(generated.type);
    expect(schema.required).toEqual(generated.required);
    expect(schema.additionalProperties).toBe(generated.additionalProperties);
    expect(Object.keys(schema.properties as object).sort()).toEqual(
      Object.keys(generated.properties as object).sort(),
    );
  });

  it('accepts the actual .qualopsrc.json config via Zod parse', () => {
    const configPath = join(__dirname, '../../.qualops/.qualopsrc.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(() => qualopsConfigSchema.parse(config)).not.toThrow();
  });
});
