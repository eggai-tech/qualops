// Core pipeline stages - main functionality
export { analyzeProjects } from './stages/analyze/index.ts';
export { generateFixes } from './stages/fix/index.ts';
export { judgeQuality } from './stages/judge/index.ts';
export { generateReport } from './stages/report/main.ts';
export { reviewProjects } from './stages/review/index.ts';

// Configuration and setup
export * from './config/config.ts';
export * from './shared/runtime/session-context.ts';

// AI providers for external integrations
export * from './ai/providers/index.ts';

// Core types for external usage
export * from './shared/types/index.ts';
