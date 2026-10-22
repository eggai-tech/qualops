import type { ReviewIssue } from '../../../shared/types';
import { CONFIDENCE_DISPLAY_THRESHOLDS } from '../constants';
import { calculateIssueCounts, generateSafeId } from '../utils/data-transformer';
import { getConfidenceBadge } from '../utils/formatters';

export interface FilterData {
  totalIssues: number;
  issuesByType: {
    bug: ReviewIssue[];
    security: ReviewIssue[];
    performance: ReviewIssue[];
    maintainability: ReviewIssue[];
  };
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  issuesByKnowledgeSource: {
    adr: ReviewIssue[];
    owasp: ReviewIssue[];
    angular: ReviewIssue[];
    ngrx: ReviewIssue[];
    rxjs: ReviewIssue[];
    material: ReviewIssue[];
    other: ReviewIssue[];
    none: ReviewIssue[];
  };
}

export function generateFiltersSection(data: FilterData): string {
  return `
    <div class="filter-container">
      <div class="filters-section-title">Issues</div>
      <div class="filter-group">
        <div class="filter-group-label">Issue Type</div>
        <div class="filter-bar">
          <button class="filter-button active" data-filter="type" data-value="all" onclick="filterIssues('type', 'all')">ALL (<span id="type-all-count">${data.totalIssues}</span>)</button>
          <button class="filter-button" data-filter="type" data-value="bug" onclick="filterIssues('type', 'bug')">BUG (<span id="type-bug-count">${data.issuesByType.bug.length}</span>)</button>
          <button class="filter-button" data-filter="type" data-value="security" onclick="filterIssues('type', 'security')">SECURITY (<span id="type-security-count">${data.issuesByType.security.length}</span>)</button>
          <button class="filter-button" data-filter="type" data-value="performance" onclick="filterIssues('type', 'performance')">PERFORMANCE (<span id="type-performance-count">${data.issuesByType.performance.length}</span>)</button>
          <button class="filter-button" data-filter="type" data-value="maintainability" onclick="filterIssues('type', 'maintainability')">MAINTAINABILITY (<span id="type-maintainability-count">${data.issuesByType.maintainability.length}</span>)</button>
        </div>
      </div>

      <div class="filter-group">
        <div class="filter-group-label">Issue Severity</div>
        <div class="filter-bar">
          <button class="filter-button active" data-filter="severity" data-value="all" onclick="filterIssues('severity', 'all')">ALL (<span id="severity-all-count">${data.totalIssues}</span>)</button>
          <button class="filter-button" data-filter="severity" data-value="critical" onclick="filterIssues('severity', 'critical')">CRITICAL (<span id="severity-critical-count">${data.summary.critical}</span>)</button>
          <button class="filter-button" data-filter="severity" data-value="high" onclick="filterIssues('severity', 'high')">HIGH (<span id="severity-high-count">${data.summary.high}</span>)</button>
          <button class="filter-button" data-filter="severity" data-value="medium" onclick="filterIssues('severity', 'medium')">MEDIUM (<span id="severity-medium-count">${data.summary.medium}</span>)</button>
          <button class="filter-button" data-filter="severity" data-value="low" onclick="filterIssues('severity', 'low')">LOW (<span id="severity-low-count">${data.summary.low}</span>)</button>
        </div>
      </div>

      <div class="filter-group">
        <div class="filter-group-label">Knowledge Source</div>
        <div class="filter-bar">
          <button class="filter-button active" data-filter="source" data-value="all" onclick="filterIssues('source', 'all')">ALL (<span id="source-all-count">${data.totalIssues}</span>)</button>
          <button class="filter-button" data-filter="source" data-value="adr" onclick="filterIssues('source', 'adr')">ADR (<span id="source-adr-count">${data.issuesByKnowledgeSource.adr.length}</span>)</button>
          <button class="filter-button" data-filter="source" data-value="owasp" onclick="filterIssues('source', 'owasp')">OWASP (<span id="source-owasp-count">${data.issuesByKnowledgeSource.owasp.length}</span>)</button>
          <button class="filter-button" data-filter="source" data-value="angular" onclick="filterIssues('source', 'angular')">ANGULAR (<span id="source-angular-count">${data.issuesByKnowledgeSource.angular.length}</span>)</button>
          <button class="filter-button" data-filter="source" data-value="ngrx" onclick="filterIssues('source', 'ngrx')">NGRX (<span id="source-ngrx-count">${data.issuesByKnowledgeSource.ngrx.length}</span>)</button>
          <button class="filter-button" data-filter="source" data-value="rxjs" onclick="filterIssues('source', 'rxjs')">RXJS (<span id="source-rxjs-count">${data.issuesByKnowledgeSource.rxjs.length}</span>)</button>
          <button class="filter-button" data-filter="source" data-value="material" onclick="filterIssues('source', 'material')">MATERIAL (<span id="source-material-count">${data.issuesByKnowledgeSource.material.length}</span>)</button>
          <button class="filter-button" data-filter="source" data-value="other" onclick="filterIssues('source', 'other')">OTHER (<span id="source-other-count">${data.issuesByKnowledgeSource.other.length}</span>)</button>
          <button class="filter-button" data-filter="source" data-value="none" onclick="filterIssues('source', 'none')">NONE (<span id="source-none-count">${data.issuesByKnowledgeSource.none.length}</span>)</button>
        </div>
      </div>
    </div>
  `;
}

export function generateDirectoryHeader(
  directory: string,
  dirId: string,
  issues: ReviewIssue[],
): string {
  const counts = calculateIssueCounts(issues);

  return `
    <div class="directory-header" onclick="toggleDirectory('${dirId}')" id="dir-header-${dirId}">
      <div>
        <span class="expand-icon" id="dir-icon-${dirId}">▶</span>
        ${directory === 'root' ? 'Root Files' : escapeHtml(directory)}
      </div>
      <div style="font-size: 11px; color: var(--color-text-secondary); font-weight: normal;">
        ${issues.length} issue${issues.length !== 1 ? 's' : ''}
        ${counts.critical > 0 ? ` | ${counts.critical} critical` : ''}
        ${counts.high > 0 ? ` | ${counts.high} high` : ''}
        ${counts.medium > 0 ? ` | ${counts.medium} medium` : ''}
        ${counts.low > 0 ? ` | ${counts.low} low` : ''}
      </div>
    </div>
  `;
}

export function generateFileHeader(fileName: string, fileId: string, issueCount: number): string {
  return `
    <div class="file-header" onclick="toggleFile('${fileId}')">
      <div>
        <span class="expand-icon" id="file-icon-${fileId}">▶</span>
        ${escapeHtml(fileName)}
      </div>
      <span style="font-size: 11px; color: var(--color-text-secondary); font-weight: normal;">
        ${issueCount} issue${issueCount !== 1 ? 's' : ''}
      </span>
    </div>
  `;
}

export async function generateIssueCard(
  issue: ReviewIssue,
  codeSection: string,
  issueId?: number,
): Promise<string> {
  const safeId = generateSafeId(issue.id);

  const knowledgeSource = extractKnowledgeSource(issue);
  const issueIdBadge = issueId
    ? `<span class="issue-id-badge">ISSUE-${issueId.toString().padStart(3, '0')}</span>`
    : '';

  return `
    <div id="issue-${safeId}" class="issue-card" data-severity="${issue.severity}" data-type="${issue.type}" data-source="${knowledgeSource}">
      <div class="issue-header" onclick="toggleIssue('${safeId}')">
        <div class="issue-title">
          <span class="expand-icon" id="icon-${safeId}">▶</span>
          ${issueIdBadge}
          ${escapeHtml(issue.description)}
        </div>
        <div class="issue-badges">
          <span class="severity-badge ${issue.severity}">${issue.severity}</span>
          <span class="type-badge">${issue.type}</span>
          ${getConfidenceBadge(issue.confidence)}
        </div>
      </div>
      <div id="details-${safeId}" class="issue-details">
        ${generateIssueDetails(issue)}
        ${codeSection}
      </div>
    </div>
  `;
}

function generateIssueDetails(
  issue: ReviewIssue & {
    problem?: string;
    impact?: string;
    rootCause?: string;
    education?: string;
  },
): string {
  // Use enhanced fields if available, otherwise fallback to original
  const problem = issue.problem || issue.description;
  const impact = issue.impact || '';

  return `
    <div class="detail-section">
      <div class="detail-label">Problem</div>
      <div class="detail-content" style="font-weight: 500;">${escapeHtml(problem)}</div>
    </div>
    <div class="detail-section">
      <div class="detail-label">Analysis</div>
      <div class="detail-content">${escapeHtml(issue.reasoning)}</div>
    </div>
    ${generateKnowledgeSourceSection(issue)}
    ${
      impact
        ? `
    <div class="detail-section">
      <div class="detail-label">Impact</div>
      <div class="detail-content" style="color: var(--color-text-secondary);">${escapeHtml(impact)}</div>
    </div>`
        : ''
    }
    ${
      issue.rootCause
        ? `
    <div class="detail-section">
      <div class="detail-label">Root Cause</div>
      <div class="detail-content" style="color: var(--color-text-secondary);">${escapeHtml(issue.rootCause)}</div>
    </div>`
        : ''
    }
    <div class="detail-section">
      <div class="detail-label">Solution</div>
      <div class="detail-content">${escapeHtml(issue.suggestion)}</div>
    </div>
    ${
      issue.education
        ? `
    <div class="detail-section">
      <div class="detail-label">Learn More</div>
      <div class="detail-content" style="background: var(--color-bg-secondary); padding: 12px; border-radius: 6px;">
        ${escapeHtml(issue.education)}
      </div>
    </div>`
        : ''
    }
    ${generateConfidenceSection(issue)}
  `;
}

// These functions are no longer needed - replaced by LLM-based IssueEnhancer
// The enhanced fields are now added directly to the issue object

function generateKnowledgeSourceSection(issue: ReviewIssue): string {
  if (!issue.knowledge_source || issue.knowledge_source.trim() === '') {
    return '';
  }

  // Escape HTML first, then apply safe formatting
  const escapedSource = escapeHtml(issue.knowledge_source);
  const formattedSource = escapedSource
    .replace(/^(\w+\s+\w+):/, '<strong>$1:</strong>')
    .replace(/Referenced from/, '<em>Referenced from</em>');

  return `
    <div class="detail-section">
      <div class="detail-label">Grounded in Documentation</div>
      <div class="detail-content" style="background: #e8f4fd; padding: 12px; border-radius: 6px; border-left: 3px solid #0969da;">
        ${formattedSource}
        <div style="font-size: 11px; color: var(--color-text-secondary); margin-top: 8px;">
          This issue was identified using official documentation and best practices as reference.
        </div>
      </div>
    </div>
  `;
}

function generateConfidenceSection(issue: ReviewIssue): string {
  if (issue.confidence === undefined) {
    return '';
  }

  const confidence = issue.confidence;

  let confidenceLevel: string;
  let confidenceColor: string;
  let explanation: string;

  if (confidence >= CONFIDENCE_DISPLAY_THRESHOLDS.HIGH) {
    confidenceLevel = 'High';
    confidenceColor = 'var(--color-success)';
    explanation = 'This finding is highly reliable with strong evidence and clear reasoning.';
  } else if (confidence >= CONFIDENCE_DISPLAY_THRESHOLDS.MEDIUM) {
    confidenceLevel = 'Medium';
    confidenceColor = 'var(--color-warning)';
    explanation = 'This finding has reasonable evidence but may need additional verification.';
  } else {
    confidenceLevel = 'Low';
    confidenceColor = 'var(--color-danger)';
    explanation = 'This finding should be carefully reviewed as evidence is limited or unclear.';
  }

  return `
    <div class="detail-section">
      <div class="detail-label">Confidence Score</div>
      <div class="detail-content" style="background: var(--color-bg-secondary); padding: 12px; border-radius: 6px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <span style="font-weight: 600; color: ${confidenceColor};">${confidenceLevel} (${confidence}/10)</span>
        </div>
        <div style="font-size: 12px; color: var(--color-text-secondary);">
          ${explanation}
        </div>
      </div>
    </div>
  `;
}

export function generateCodeSection(
  filePath: string,
  location: string,
  codePreview: string,
): string {
  const lines = codePreview.split('\n');

  return `
    <div class="code-section">
      <div class="code-header">
        ${escapeHtml(filePath)}:${escapeHtml(location)}
        <button class="copy-button" onclick="copyCode(this)">Copy</button>
      </div>
      <div class="code-content">
        ${lines
          .map((line) => {
            const lineMatch = line.match(/^(\s*\d+)\s*([│►])\s(.*)$/);
            if (lineMatch) {
              const lineNumber = lineMatch[1].trim();
              const marker = lineMatch[2];
              const content = lineMatch[3];
              const isHighlighted = marker === '►';
              return `
            <div class="code-line${isHighlighted ? ' highlighted' : ''}">
              <div class="line-number">${lineNumber}</div>
              <div class="line-content">${escapeHtml(content)}</div>
            </div>
            `;
            } else {
              return `
            <div class="code-line">
              <div class="line-number">?</div>
              <div class="line-content">${escapeHtml(line)}</div>
            </div>
            `;
            }
          })
          .join('')}
      </div>
    </div>
  `;
}

function extractKnowledgeSource(issue: ReviewIssue): string {
  if (!issue.knowledge_source || issue.knowledge_source.trim() === '') {
    return 'none';
  }

  const source = issue.knowledge_source.toLowerCase();

  // Check for specific knowledge sources
  if (source.includes('architecture decision records') || source.includes('adr')) {
    return 'adr';
  }
  if (source.includes('owasp')) {
    return 'owasp';
  }
  if (source.includes('angular') && !source.includes('material')) {
    return 'angular';
  }
  if (source.includes('ngrx') || source.includes('state management')) {
    return 'ngrx';
  }
  if (source.includes('rxjs') || source.includes('observable')) {
    return 'rxjs';
  }
  if (source.includes('material') || source.includes('cdk')) {
    return 'material';
  }

  // If it has a knowledge source but doesn't match specific categories
  return 'other';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
