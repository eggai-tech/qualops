#!/usr/bin/env node
import { GitHubIntegration } from './github-integration';
import { logger } from '../shared/utils/logger';

const integration = new GitHubIntegration();
integration.run().catch((error) => {
  logger.error('GitHub integration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
