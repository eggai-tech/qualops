#!/usr/bin/env node
import { GitHubIntegration } from './github-integration';

const integration = new GitHubIntegration();
integration.run().catch((error) => {
  console.error('GitHub integration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
