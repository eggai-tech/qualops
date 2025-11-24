#!/usr/bin/env node --experimental-strip-types

import { GitHubIntegration } from './github-integration.js';

(async () => {
  try {
    const integration = new GitHubIntegration();
    await integration.run();
  } catch (error) {
    console.error('GitHub integration failed:', error instanceof Error ? error.message : 'Unknown error');
    if (error instanceof Error && error.stack) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
})().catch((error) => {
  console.error('Fatal error in GitHub integration:', error instanceof Error ? error.message : 'Unknown error');
  process.exit(1);
});
