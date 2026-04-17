import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { qualopsConfigSchema } from '../src/config/config-schema';
import { orderProperties, postProcessDefs } from './config-schema/post-process';

const jsonSchema = z.toJSONSchema(qualopsConfigSchema, {
  reused: 'ref',
}) as Record<string, unknown>;

jsonSchema.$id = 'https://egg-ai.com/schemas/qualops-config.schema.json';
jsonSchema.title = 'QualOps Configuration';
jsonSchema.description = 'Schema for QualOps project configuration.';

postProcessDefs(jsonSchema);

const outPath = join(__dirname, '../qualops-config.schema.json');
writeFileSync(outPath, JSON.stringify(orderProperties(jsonSchema), null, 2) + '\n');
console.log(`Generated JSON Schema at ${outPath}`);
