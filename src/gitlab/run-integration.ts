#!/usr/bin/env node --experimental-strip-types

import { GitLabIntegration } from './gitlab-integration';
import { logger } from '../shared/utils/logger';

(async () => {
  try {
    const integration = new GitLabIntegration();
    await integration.run();
  } catch (error) {
    logger.error(
      'GitLab integration failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    if (error instanceof Error && error.stack) {
      logger.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
})().catch((error) => {
  logger.error(
    'Fatal error in GitLab integration:',
    error instanceof Error ? error.message : 'Unknown error',
  );
  process.exit(1);
});
