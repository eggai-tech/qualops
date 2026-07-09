/**
 * Barrel for the shared type vocabulary.
 *
 * Definitions live in domain-focused sibling files; this file only re-exports
 * them so existing `from '.../shared/types'` imports keep resolving. Add new
 * shared types to the appropriate domain file, not here.
 */

export * from './ai-config';
export * from './framework-context';
export * from './finding';
export * from './pipeline';
export * from './analysis-metadata';
export * from './review-metadata';
export * from './root-cause-metadata';
export * from './fix-metadata';
export * from './report-metadata';
export * from './judge-metadata';
