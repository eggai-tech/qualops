export const IssueSeverity = {
  Critical: 'critical',
  Error: 'error',
  Warning: 'warning',
  Info: 'info',
} as const;

export type IssueSeverity = (typeof IssueSeverity)[keyof typeof IssueSeverity];

export const IssueCategory = {
  MemoryLeak: 'memory-leak',
  Performance: 'performance',
  Security: 'security',
  BestPractice: 'best-practice',
  CodeQuality: 'code-quality',
  Accessibility: 'accessibility',
  TypeSafety: 'type-safety',
  StyleGuide: 'style-guide',
} as const;

export type IssueCategory = (typeof IssueCategory)[keyof typeof IssueCategory];

export class Issue {
  public readonly file: string;
  public readonly line: number;
  public readonly message: string;
  public readonly severity: IssueSeverity;
  public readonly category: IssueCategory;
  public readonly column?: number;
  public readonly endLine?: number;
  public readonly endColumn?: number;
  public readonly suggestion?: string;
  public readonly pattern?: string;
  public readonly evidence?: string;
  public readonly confidence?: number;
  public readonly ruleId?: string;
  public readonly metadata?: Record<string, unknown>;

  constructor(data: {
    file: string;
    line: number;
    message: string;
    severity: IssueSeverity;
    category: IssueCategory;
    column?: number;
    endLine?: number;
    endColumn?: number;
    suggestion?: string;
    pattern?: string;
    evidence?: string;
    confidence?: number;
    ruleId?: string;
    metadata?: Record<string, unknown>;
  }) {
    this.file = data.file;
    this.line = data.line;
    this.message = data.message;
    this.severity = data.severity;
    this.category = data.category;
    this.column = data.column;
    this.endLine = data.endLine;
    this.endColumn = data.endColumn;
    this.suggestion = data.suggestion;
    this.pattern = data.pattern;
    this.evidence = data.evidence;
    this.confidence = data.confidence;
    this.ruleId = data.ruleId;
    this.metadata = data.metadata;
  }

  get id(): string {
    return `${this.file}:${this.line}:${this.column || 0}:${this.ruleId || this.category}`;
  }

  get isCritical(): boolean {
    return this.severity === IssueSeverity.Critical;
  }

  get isError(): boolean {
    return this.severity === IssueSeverity.Error;
  }

  get isWarning(): boolean {
    return this.severity === IssueSeverity.Warning;
  }

  get isInfo(): boolean {
    return this.severity === IssueSeverity.Info;
  }

  get hasAutoFix(): boolean {
    return !!this.suggestion;
  }

  get location(): string {
    return `${this.file}:${this.line}${this.column ? ':' + this.column : ''}`;
  }

  toJSON(): Record<string, unknown> {
    return {
      file: this.file,
      line: this.line,
      column: this.column,
      endLine: this.endLine,
      endColumn: this.endColumn,
      message: this.message,
      severity: this.severity,
      category: this.category,
      suggestion: this.suggestion,
      pattern: this.pattern,
      evidence: this.evidence,
      confidence: this.confidence,
      ruleId: this.ruleId,
      metadata: this.metadata,
    };
  }

  static fromJSON(data: Record<string, unknown>): Issue {
    return new Issue({
      file: data.file as string,
      line: data.line as number,
      message: data.message as string,
      severity: data.severity as IssueSeverity,
      category: data.category as IssueCategory,
      column: data.column as number | undefined,
      endLine: data.endLine as number | undefined,
      endColumn: data.endColumn as number | undefined,
      suggestion: data.suggestion as string | undefined,
      pattern: data.pattern as string | undefined,
      evidence: data.evidence as string | undefined,
      confidence: data.confidence as number | undefined,
      ruleId: data.ruleId as string | undefined,
      metadata: data.metadata as Record<string, unknown> | undefined,
    });
  }
}
