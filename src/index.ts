// Core pipeline stages - main functionality
export { analyzeProjects } from './stages/analyze';
export { generateFixes } from './stages/fix';
export { judgeQuality } from './stages/judge';
export { generateReport } from './stages/report/main';
export { reviewProjects } from './stages/review';

// Configuration and setup
export * from './config/config';
export * from './shared/runtime/session-context';

// AI providers for external integrations
export * from './ai/providers';

// Core types for external usage
export * from './shared/types';
