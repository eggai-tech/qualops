export interface FrameworkContext {
  framework: 'angular' | 'react' | 'nodejs' | 'typescript';
  version?: string;
  dependencies: string[];
  fileType?: 'service' | 'component' | 'guard' | 'pipe' | 'directive';
}
