'use strict';

/**
 * Single source of truth for CRB repo slugs and their primary languages.
 * Imported by both config.ts (for dataset name resolution) and
 * upload-datasets.ts (for language metadata and dataset descriptions).
 */
export const CRB_REPOS: Record<string, string> = {
  sentry: 'python',
  grafana: 'go',
  cal_dot_com: 'typescript',
  discourse: 'ruby',
  keycloak: 'java',
};
