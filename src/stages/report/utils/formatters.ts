import type { ReviewIssue } from '../../../shared/types';

export function getConfidenceBadge(confidence: number | undefined): string {
  if (confidence === undefined) return '';

  let _level: string;
  let className: string;

  if (confidence >= 8) {
    _level = 'high';
    className = 'confidence-high';
  } else if (confidence >= 6) {
    _level = 'medium';
    className = 'confidence-medium';
  } else {
    _level = 'low';
    className = 'confidence-low';
  }

  return `<span class="confidence-badge ${className}" title="Confidence: ${confidence}/10">${confidence}/10</span>`;
}

export function getQualityStatus(summary: {
  critical: number;
  high: number;
  medium: number;
  low: number;
}): {
  status: 'FAILED' | 'WARNING' | 'PASSED';
  color: string;
  emoji: string;
} {
  if (summary.critical > 0 || summary.high > 0) {
    return {
      status: 'FAILED',
      color: '#dc3545',
      emoji: 'FAILED',
    };
  }

  if (summary.medium > 0) {
    return {
      status: 'WARNING',
      color: '#ffc107',
      emoji: 'WARNING',
    };
  }

  return {
    status: 'PASSED',
    color: '#28a745',
    emoji: 'PASSED',
  };
}

export function extractProblem(issue: ReviewIssue): string {
  // Extract a clear, concise problem statement from the issue
  const reasoning = issue.reasoning || '';
  const description = issue.description || '';

  // Try to find the core problem in the reasoning
  const problemIndicators = [
    /^(.*?(?:but|however|although|which|that|causing|leads to|results in).*?)(?:\.|$)/i,
    /^(.*?(?:is not|isn't|won't|will not|doesn't|does not|can't|cannot).*?)(?:\.|$)/i,
    /^(The\s+(?:problem|issue)\s+is.*?)(?:\.|$)/i,
  ];

  for (const pattern of problemIndicators) {
    const match = reasoning.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  // If no clear problem statement, create one from the description
  if (description.toLowerCase().includes('missing')) {
    return `Required ${description.toLowerCase().replace('missing', '').trim()} is not present`;
  }

  if (description.toLowerCase().includes('incorrect')) {
    return `The implementation is incorrect and may cause unexpected behavior`;
  }

  // Default to first sentence of reasoning or description
  const firstSentence = reasoning.split('.')[0] || description;
  return firstSentence.trim();
}

export function formatSource(source: string): string {
  // Format documentation source references
  if (source.startsWith('angular/')) {
    const [, component, section] = source.split('/');
    return `<a href="https://angular.dev/api/${component}" target="_blank" style="color: var(--color-accent);">Angular ${component} - ${section || 'Documentation'}</a>`;
  }

  if (source.includes('guide/')) {
    return `<a href="https://angular.dev/${source}" target="_blank" style="color: var(--color-accent);">${source.replace('guide/', 'Guide: ')}</a>`;
  }

  // Clean up file paths for readability
  if (source.includes('.md')) {
    const fileName = source.split('/').pop()?.replace('.md', '') || source;
    return fileName.replace(/-/g, ' ').replace(/_/g, ' ');
  }

  return source;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
