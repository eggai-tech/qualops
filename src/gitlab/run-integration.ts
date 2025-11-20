#!/usr/bin/env node --experimental-strip-types

import { GitLabIntegration } from './gitlab-integration';

(async () => {
  try {
    const integration = new GitLabIntegration();
    await integration.run();
  } catch (error) {
    console.error('GitLab integration failed:', error instanceof Error ? error.message : 'Unknown error');
    if (error instanceof Error && error.stack) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
})().catch((error) => {
  console.error('Fatal error in GitLab integration:', error instanceof Error ? error.message : 'Unknown error');
  process.exit(1);
});
