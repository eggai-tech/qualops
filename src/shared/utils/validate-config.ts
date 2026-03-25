import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import schema from '../../../docs/qualops-config.schema.json';

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

export function validateConfig(config: object): { valid: boolean; errors: string[] } {
  const valid = validate(config);
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validate.errors || []).map((err) => {
    const path = err.instancePath || '/';
    return `${path}: ${err.message}`;
  });
  return { valid: false, errors };
}
