import type { RootCauseTaxonomy } from '../../shared/types';

export type { RootCauseTaxonomy } from '../../shared/types';

export const ROOT_CAUSE_TAXONOMY: RootCauseTaxonomy[] = [
  {
    key: 'memory_leaks_cleanup',
    label: 'Memory Leaks & Cleanup',
    description: 'Issues related to resources not being properly cleaned up',
    patterns: [
      'storage event listener not removed',
      'afterRenderEffect without cleanup',
      'subscription without takeUntilDestroyed',
      'BehaviorSubject not cleaned up',
      'effect without cleanup',
      'listener not removed',
      'memory leak',
      'resource not released',
    ],
  },
  {
    key: 'race_conditions_async',
    label: 'Race Conditions & Async Timing',
    description: 'Issues related to asynchronous operation timing and race conditions',
    patterns: [
      'IndexedDB operation not awaited',
      'race condition',
      'state update before async',
      'async timing',
      'concurrent access',
      'timing issue',
      'paginator initialization race',
      'promise not awaited',
    ],
  },
  {
    key: 'null_undefined_safety',
    label: 'Null/Undefined Safety',
    description: 'Issues related to null or undefined values',
    patterns: [
      'array access without bounds check',
      'form control access before initialization',
      'missing null check',
      'potential null',
      'undefined access',
      'null reference',
      'optional chaining missing',
    ],
  },
  {
    key: 'rxjs_operator_misuse',
    label: 'RxJS Operator Misuse',
    description: 'Issues related to incorrect usage of RxJS operators',
    patterns: [
      'map without return',
      'catchError returning error',
      'side effect in wrong operator',
      'unsubscribed observable',
      'tap instead of map',
      'map instead of tap',
      'switchMap instead of mergeMap',
      'operator misuse',
      'observable not subscribed',
    ],
  },
  {
    key: 'security_input_validation',
    label: 'Security - Input Validation',
    description: 'Security issues related to input validation and sanitization',
    patterns: [
      'CSV injection',
      'XSS vulnerability',
      'missing input validation',
      'unsafe JSON parsing',
      'unsanitized input',
      'base64 without validation',
      'user input not validated',
      'injection vulnerability',
    ],
  },
  {
    key: 'security_authorization',
    label: 'Security - Authorization',
    description: 'Security issues related to authorization and access control',
    patterns: [
      'missing authorization check',
      'CSRF protection',
      'critical ID not validated',
      'access control',
      'permission check missing',
      'authentication missing',
    ],
  },
  {
    key: 'architecture_violations',
    label: 'Architecture Violations (ADR)',
    description: 'Issues violating architecture decision records',
    patterns: [
      'using NgRx Store instead of Signal Store',
      'using @ngrx/signals',
      'mixing state management',
      'direct import from internal',
      'ADR violation',
      'architecture violation',
      'pattern violation',
    ],
  },
  {
    key: 'performance',
    label: 'Performance',
    description: 'Performance-related issues and optimizations',
    patterns: [
      'inefficient nested operation',
      'O(n*m) complexity',
      'selector factory preventing memoization',
      'unbounded concurrent request',
      'unnecessary debounceTime',
      'performance issue',
      'slow operation',
      'expensive computation',
    ],
  },
  {
    key: 'code_quality',
    label: 'Code Quality',
    description: 'General code quality and maintainability issues',
    patterns: [
      'typo in name',
      'duplicate import',
      'missing return type',
      'complex nested chain',
      'code smell',
      'maintainability',
      'readability',
    ],
  },
  {
    key: 'other',
    label: 'Other',
    description: 'Issues that do not fit into other categories',
    patterns: [],
  },
];

export function getRootCauseByKey(key: string): RootCauseTaxonomy | undefined {
  return ROOT_CAUSE_TAXONOMY.find((rc) => rc.key === key);
}

export function getRootCauseKeys(): string[] {
  return ROOT_CAUSE_TAXONOMY.map((rc) => rc.key);
}
