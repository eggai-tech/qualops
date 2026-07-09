export interface ReviewIssue {
  id: string;
  file: string;
  line?: number;
  type: 'bug' | 'security' | 'performance' | 'maintainability';
  severity: 'critical' | 'high' | 'medium' | 'low';
  category?: string;
  description: string;
  location: string;
  reasoning: string;
  suggestion: string;
  context: string;
  confidence: number;
  tags?: string[];
  priority?: number;
  estimatedEffort?: 'low' | 'medium' | 'high';
  knowledge_source?: string;
  impact?: string;
  cwe?: string;
  threat_model?: string;
  validation_reasoning?: string;
}

export interface FixSuggestion {
  issueId: string;
  file: string;
  line: number;
  originalCode: string;
  suggestedCode: string;
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
  breaking: boolean;
  applied: boolean;
}
