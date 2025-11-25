import { Issue } from './issue.model';

export const SessionStage = {
  Analyze: 'analyze',
  Review: 'review',
  Fix: 'fix',
  Judge: 'judge',
  Report: 'report',
} as const;

export type SessionStage = (typeof SessionStage)[keyof typeof SessionStage];

export const SessionStatus = {
  Pending: 'pending',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;

export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export class Session {
  public readonly id: string;
  public readonly startTime: Date;
  public endTime?: Date;
  public status: SessionStatus;
  public currentStage?: SessionStage;
  public stages: SessionStage[];
  public files: string[];
  public issues: Issue[];
  public fixes: unknown[];
  public metadata: Record<string, unknown>;

  constructor(id: string, stages: SessionStage[] = [], metadata: Record<string, unknown> = {}) {
    this.id = id;
    this.startTime = new Date();
    this.status = SessionStatus.Pending;
    this.stages = stages;
    this.files = [];
    this.issues = [];
    this.fixes = [];
    this.metadata = metadata;
  }

  get duration(): number | null {
    if (!this.endTime) return null;
    return this.endTime.getTime() - this.startTime.getTime();
  }

  get isCompleted(): boolean {
    return this.status === SessionStatus.Completed;
  }

  get isFailed(): boolean {
    return this.status === SessionStatus.Failed;
  }

  get isRunning(): boolean {
    return this.status === SessionStatus.Running;
  }

  get summary(): Record<string, unknown> {
    return {
      id: this.id,
      status: this.status,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.duration,
      stages: this.stages,
      currentStage: this.currentStage,
      filesAnalyzed: this.files.length,
      issuesFound: this.issues.length,
      fixesApplied: this.fixes.length,
      criticalIssues: this.issues.filter((i) => i.isCritical).length,
      errorIssues: this.issues.filter((i) => i.isError).length,
      warningIssues: this.issues.filter((i) => i.isWarning).length,
      infoIssues: this.issues.filter((i) => i.isInfo).length,
    };
  }

  start(): void {
    this.status = SessionStatus.Running;
  }

  complete(): void {
    this.status = SessionStatus.Completed;
    this.endTime = new Date();
  }

  fail(error?: Error): void {
    this.status = SessionStatus.Failed;
    this.endTime = new Date();
    if (error) {
      this.metadata.error = {
        message: error.message,
        stack: error.stack,
      };
    }
  }

  cancel(): void {
    this.status = SessionStatus.Cancelled;
    this.endTime = new Date();
  }

  setStage(stage: SessionStage): void {
    this.currentStage = stage;
  }

  addFile(file: string): void {
    if (!this.files.includes(file)) {
      this.files.push(file);
    }
  }

  addIssue(issue: Issue): void {
    this.issues.push(issue);
  }

  addFix(fix: unknown): void {
    this.fixes.push(fix);
  }

  toJSON(): Record<string, unknown> {
    return {
      ...this.summary,
      metadata: this.metadata,
      issues: this.issues.map((i) => i.toJSON()),
      fixes: this.fixes,
    };
  }

  static fromJSON(data: Record<string, unknown>): Session {
    const session = new Session(data.id as string, data.stages as SessionStage[], data.metadata as Record<string, unknown>);
    session.status = data.status as SessionStatus;
    session.currentStage = data.currentStage as SessionStage | undefined;
    session.files = (data.files as string[]) || [];
    session.issues = Array.isArray(data.issues)
      ? data.issues.map((i) => Issue.fromJSON(i as Record<string, unknown>))
      : [];
    session.fixes = (data.fixes as unknown[]) || [];
    if (data.endTime) {
      session.endTime = new Date(data.endTime as string | number);
    }
    return session;
  }
}
