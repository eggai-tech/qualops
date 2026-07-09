export const PatternType = {
  Observable: 'observable',
  EventListener: 'event-listener',
  Timer: 'timer',
  Promise: 'promise',
  Subscription: 'subscription',
  Resource: 'resource',
} as const;

export type PatternType = (typeof PatternType)[keyof typeof PatternType];

export const CleanupRequirement = {
  Required: 'required',
  NotRequired: 'not-required',
  Conditional: 'conditional',
  Unknown: 'unknown',
} as const;

export type CleanupRequirement = (typeof CleanupRequirement)[keyof typeof CleanupRequirement];

export class Pattern {
  public readonly name: string;
  public readonly type: PatternType;
  public readonly cleanupRequirement: CleanupRequirement;
  public readonly regex?: RegExp;
  public readonly evidence?: string;
  public readonly confidence?: number;
  public readonly framework?: string;
  public readonly documentation?: string;
  public readonly examples?: string[];
  public readonly metadata?: Record<string, unknown>;

  constructor(data: {
    name: string;
    type: PatternType;
    cleanupRequirement: CleanupRequirement;
    regex?: RegExp;
    evidence?: string;
    confidence?: number;
    framework?: string;
    documentation?: string;
    examples?: string[];
    metadata?: Record<string, unknown>;
  }) {
    this.name = data.name;
    this.type = data.type;
    this.cleanupRequirement = data.cleanupRequirement;
    this.regex = data.regex;
    this.evidence = data.evidence;
    this.confidence = data.confidence;
    this.framework = data.framework;
    this.documentation = data.documentation;
    this.examples = data.examples;
    this.metadata = data.metadata;
  }

  get requiresCleanup(): boolean {
    return this.cleanupRequirement === CleanupRequirement.Required;
  }

  get autoCompletes(): boolean {
    return this.cleanupRequirement === CleanupRequirement.NotRequired;
  }

  get isConditional(): boolean {
    return this.cleanupRequirement === CleanupRequirement.Conditional;
  }

  matches(code: string): boolean {
    if (!this.regex) return false;
    return this.regex.test(code);
  }

  extractMatches(code: string): string[] {
    if (!this.regex) return [];
    const matches: string[] = [];
    let match;
    const regex = new RegExp(this.regex, 'g');
    while ((match = regex.exec(code)) !== null) {
      matches.push(match[0]);
    }
    return matches;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      type: this.type,
      cleanupRequirement: this.cleanupRequirement,
      regex: this.regex?.source,
      evidence: this.evidence,
      confidence: this.confidence,
      framework: this.framework,
      documentation: this.documentation,
      examples: this.examples,
      metadata: this.metadata,
    };
  }

  static fromJSON(data: Record<string, unknown>): Pattern {
    return new Pattern({
      name: data.name as string,
      type: data.type as PatternType,
      cleanupRequirement: data.cleanupRequirement as CleanupRequirement,
      // nosemgrep: detect-non-literal-regexp -- pattern from operator's own stored config model, not attacker input
      regex: data.regex ? new RegExp(data.regex as string) : undefined,
      evidence: data.evidence as string | undefined,
      confidence: data.confidence as number | undefined,
      framework: data.framework as string | undefined,
      documentation: data.documentation as string | undefined,
      examples: data.examples as string[] | undefined,
      metadata: data.metadata as Record<string, unknown> | undefined,
    });
  }
}

export class PatternLibrary {
  private patterns: Map<string, Pattern> = new Map();

  add(pattern: Pattern): void {
    this.patterns.set(pattern.name, pattern);
  }

  get(name: string): Pattern | undefined {
    return this.patterns.get(name);
  }

  findMatches(code: string): Pattern[] {
    return Array.from(this.patterns.values()).filter((p) => p.matches(code));
  }

  getByType(type: PatternType): Pattern[] {
    return Array.from(this.patterns.values()).filter((p) => p.type === type);
  }

  getByFramework(framework: string): Pattern[] {
    return Array.from(this.patterns.values()).filter((p) => p.framework === framework);
  }

  getRequiringCleanup(): Pattern[] {
    return Array.from(this.patterns.values()).filter((p) => p.requiresCleanup);
  }

  getAutoCompleting(): Pattern[] {
    return Array.from(this.patterns.values()).filter((p) => p.autoCompletes);
  }

  size(): number {
    return this.patterns.size;
  }

  clear(): void {
    this.patterns.clear();
  }

  toJSON(): Record<string, unknown>[] {
    return Array.from(this.patterns.values()).map((p) => p.toJSON());
  }

  static fromJSON(data: unknown[]): PatternLibrary {
    const library = new PatternLibrary();
    for (const item of data) {
      library.add(Pattern.fromJSON(item as Record<string, unknown>));
    }
    return library;
  }
}
