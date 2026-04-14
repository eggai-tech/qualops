import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import {
  ConfigParseError,
  assertValidConfig,
  collectConfigWarnings,
} from '../../config/schema-validator';
import { logger } from '../../shared/utils/logger';

export async function validateCommand(options: Record<string, unknown>): Promise<void> {
  const configPath = (options.config as string) || '.qualops/.qualopsrc.json';
  const rcPath = isAbsolute(configPath) ? configPath : join(process.cwd(), configPath);

  if (!existsSync(rcPath)) {
    logger.error(`Config file not found: ${rcPath}`);
    process.exit(1);
  }

  let rawConfig: Record<string, unknown>;
  try {
    rawConfig = JSON.parse(readFileSync(rcPath, 'utf-8'));
  } catch (error) {
    throw new ConfigParseError(rcPath, error instanceof Error ? error : new Error(String(error)));
  }

  assertValidConfig(rawConfig);

  const warnings = collectConfigWarnings(rawConfig);

  for (const dep of warnings.deprecations) {
    logger.warn(`Deprecated field "${dep.path}": ${dep.description}`);
  }
  for (const unknown of warnings.unknownFields) {
    logger.warn(
      `Unknown field "${unknown.field}" at ${unknown.path} — ` +
        `if this is a provider-specific option it will be passed through; otherwise check for a typo.`,
    );
  }

  const warningCount = warnings.deprecations.length + warnings.unknownFields.length;
  if (warningCount > 0) {
    logger.info(`Config is valid with ${warningCount} warning(s).`);
  } else {
    logger.info('Config is valid.');
  }
}
