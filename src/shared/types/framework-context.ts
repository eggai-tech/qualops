/**
 * Framework context for AI analysis.
 *
 * NOTE: a second, drifted definition of this concept lives in
 * `shared/utils/framework-detector.ts`. Reconciling the two is a
 * behaviour-touching change and is intentionally deferred (not part of the
 * structure-only refactor).
 */
export interface FrameworkContext {
  framework: 'angular' | 'react' | 'nodejs' | 'typescript';
  version?: string;
  dependencies: string[];
  fileType?: 'service' | 'component' | 'guard' | 'pipe' | 'directive';
}
