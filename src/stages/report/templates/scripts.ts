export const JAVASCRIPT_CODE = `
    function toggleDirectory(dirId) {
      const content = document.getElementById('dir-content-' + dirId);
      const icon = document.getElementById('dir-icon-' + dirId);
      const header = document.getElementById('dir-header-' + dirId);

      if (content && icon && header) {
        const isExpanded = content.style.display !== 'none';
        content.style.display = isExpanded ? 'none' : 'block';
        icon.textContent = isExpanded ? '▶' : '▼';
        header.classList.toggle('expanded', !isExpanded);
      }
    }

    function toggleFile(fileId) {
      const content = document.getElementById('file-content-' + fileId);
      const icon = document.getElementById('file-icon-' + fileId);

      if (content && icon) {
        const isExpanded = content.style.display !== 'none';
        content.style.display = isExpanded ? 'none' : 'block';
        icon.textContent = isExpanded ? '▶' : '▼';

        if (!isExpanded) {
          const issues = content.querySelectorAll('.issue-card');
          if (issues.length === 1) {
            const singleIssue = issues[0];
            const issueId = singleIssue.id.replace('issue-', '');
            setTimeout(() => toggleIssue(issueId), 100);
          }
        }
      }
    }

    function toggleIssue(issueId) {
      const details = document.getElementById('details-' + issueId);
      const icon = document.getElementById('icon-' + issueId);

      if (details && icon) {
        details.classList.toggle('expanded');
        icon.textContent = details.classList.contains('expanded') ? '▼' : '▶';
      }
    }

    function copyCode(button) {
      const codeBlock = button.parentElement.nextElementSibling;
      navigator.clipboard.writeText(codeBlock.textContent).then(() => {
        button.textContent = 'Copied';
        setTimeout(() => button.textContent = 'Copy', 2000);
      });
    }

    let currentFilters = { severity: 'all', type: 'all', source: 'all' };
    let allIssues = [];

    function initializeIssues() {
      allIssues = Array.from(document.querySelectorAll('.issue-card')).map(card => ({
        element: card,
        severity: card.dataset.severity,
        type: card.dataset.type,
        source: card.dataset.source || 'none'
      }));
    }

    function updateCounts() {
      // Calculate filtered counts based on current filters
      const visibleIssues = allIssues.filter(issue => {
        const severityMatch = currentFilters.severity === 'all' || issue.severity === currentFilters.severity;
        const typeMatch = currentFilters.type === 'all' || issue.type === currentFilters.type;
        const sourceMatch = currentFilters.source === 'all' || issue.source === currentFilters.source;
        return severityMatch && typeMatch && sourceMatch;
      });

      // Update type filter counts based on current severity and source filters
      const typeCounts = {
        all: allIssues.filter(i =>
          (currentFilters.severity === 'all' || i.severity === currentFilters.severity) &&
          (currentFilters.source === 'all' || i.source === currentFilters.source)).length,
        bug: allIssues.filter(i => i.type === 'bug' &&
          (currentFilters.severity === 'all' || i.severity === currentFilters.severity) &&
          (currentFilters.source === 'all' || i.source === currentFilters.source)).length,
        security: allIssues.filter(i => i.type === 'security' &&
          (currentFilters.severity === 'all' || i.severity === currentFilters.severity) &&
          (currentFilters.source === 'all' || i.source === currentFilters.source)).length,
        performance: allIssues.filter(i => i.type === 'performance' &&
          (currentFilters.severity === 'all' || i.severity === currentFilters.severity) &&
          (currentFilters.source === 'all' || i.source === currentFilters.source)).length,
        maintainability: allIssues.filter(i => i.type === 'maintainability' &&
          (currentFilters.severity === 'all' || i.severity === currentFilters.severity) &&
          (currentFilters.source === 'all' || i.source === currentFilters.source)).length
      };

      // Update severity filter counts based on current type and source filters
      const severityCounts = {
        all: allIssues.filter(i =>
          (currentFilters.type === 'all' || i.type === currentFilters.type) &&
          (currentFilters.source === 'all' || i.source === currentFilters.source)).length,
        critical: allIssues.filter(i => i.severity === 'critical' &&
          (currentFilters.type === 'all' || i.type === currentFilters.type) &&
          (currentFilters.source === 'all' || i.source === currentFilters.source)).length,
        high: allIssues.filter(i => i.severity === 'high' &&
          (currentFilters.type === 'all' || i.type === currentFilters.type) &&
          (currentFilters.source === 'all' || i.source === currentFilters.source)).length,
        medium: allIssues.filter(i => i.severity === 'medium' &&
          (currentFilters.type === 'all' || i.type === currentFilters.type) &&
          (currentFilters.source === 'all' || i.source === currentFilters.source)).length,
        low: allIssues.filter(i => i.severity === 'low' &&
          (currentFilters.type === 'all' || i.type === currentFilters.type) &&
          (currentFilters.source === 'all' || i.source === currentFilters.source)).length
      };

      // Update source filter counts based on current type and severity filters
      const sourceCounts = {
        all: allIssues.filter(i =>
          (currentFilters.type === 'all' || i.type === currentFilters.type) &&
          (currentFilters.severity === 'all' || i.severity === currentFilters.severity)).length,
        adr: allIssues.filter(i => i.source === 'adr' &&
          (currentFilters.type === 'all' || i.type === currentFilters.type) &&
          (currentFilters.severity === 'all' || i.severity === currentFilters.severity)).length,
        owasp: allIssues.filter(i => i.source === 'owasp' &&
          (currentFilters.type === 'all' || i.type === currentFilters.type) &&
          (currentFilters.severity === 'all' || i.severity === currentFilters.severity)).length,
        angular: allIssues.filter(i => i.source === 'angular' &&
          (currentFilters.type === 'all' || i.type === currentFilters.type) &&
          (currentFilters.severity === 'all' || i.severity === currentFilters.severity)).length,
        ngrx: allIssues.filter(i => i.source === 'ngrx' &&
          (currentFilters.type === 'all' || i.type === currentFilters.type) &&
          (currentFilters.severity === 'all' || i.severity === currentFilters.severity)).length,
        rxjs: allIssues.filter(i => i.source === 'rxjs' &&
          (currentFilters.type === 'all' || i.type === currentFilters.type) &&
          (currentFilters.severity === 'all' || i.severity === currentFilters.severity)).length,
        material: allIssues.filter(i => i.source === 'material' &&
          (currentFilters.type === 'all' || i.type === currentFilters.type) &&
          (currentFilters.severity === 'all' || i.severity === currentFilters.severity)).length,
        other: allIssues.filter(i => i.source === 'other' &&
          (currentFilters.type === 'all' || i.type === currentFilters.type) &&
          (currentFilters.severity === 'all' || i.severity === currentFilters.severity)).length,
        none: allIssues.filter(i => i.source === 'none' &&
          (currentFilters.type === 'all' || i.type === currentFilters.type) &&
          (currentFilters.severity === 'all' || i.severity === currentFilters.severity)).length
      };

      // Update the count displays
      Object.entries(typeCounts).forEach(([key, count]) => {
        const element = document.getElementById('type-' + key + '-count');
        if (element) element.textContent = count;
      });

      Object.entries(severityCounts).forEach(([key, count]) => {
        const element = document.getElementById('severity-' + key + '-count');
        if (element) element.textContent = count;
      });

      Object.entries(sourceCounts).forEach(([key, count]) => {
        const element = document.getElementById('source-' + key + '-count');
        if (element) element.textContent = count;
      });
    }

    function filterIssues(filterType, value) {
      // Update the current filter state
      currentFilters[filterType] = value;

      // Update active button states
      document.querySelectorAll('[data-filter="' + filterType + '"]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === value);
      });

      // Update counts
      updateCounts();

      // Apply combined filters to 3-level hierarchy
      const directorySections = document.querySelectorAll('.directory-section');
      directorySections.forEach(dirSection => {
        const fileSections = dirSection.querySelectorAll('.file-section');
        let dirHasVisibleIssues = false;

        fileSections.forEach(fileSection => {
          const issues = fileSection.querySelectorAll('.issue-card');
          let fileHasVisibleIssues = false;

          issues.forEach(card => {
            const severityMatch = currentFilters.severity === 'all' || card.dataset.severity === currentFilters.severity;
            const typeMatch = currentFilters.type === 'all' || card.dataset.type === currentFilters.type;
            const sourceMatch = currentFilters.source === 'all' || card.dataset.source === currentFilters.source;

            if (severityMatch && typeMatch && sourceMatch) {
              card.style.display = 'block';
              fileHasVisibleIssues = true;
              dirHasVisibleIssues = true;
            } else {
              card.style.display = 'none';
            }
          });

          fileSection.style.display = fileHasVisibleIssues ? 'block' : 'none';

          // Auto-expand file if it has visible issues
          if (fileHasVisibleIssues) {
            const fileContent = fileSection.querySelector('.file-content');
            const fileIcon = fileSection.querySelector('.expand-icon');
            if (fileContent && fileIcon) {
              fileContent.style.display = 'block';
              fileIcon.textContent = '▼';
            }
          }
        });

        dirSection.style.display = dirHasVisibleIssues ? 'block' : 'none';
      });
    }

    function applyUrlFilters() {
      const params = new URLSearchParams(window.location.search);
      const severity = params.get('severity');
      const type = params.get('type');
      const knowledgeSource = params.get('knowledgeSource');

      if (severity) {
        filterIssues('severity', severity);
      }
      if (type) {
        filterIssues('type', type);
      }
      if (knowledgeSource) {
        const sourceMap = {
          'Architecture Decision Records (ADRs)': 'adr',
          'OWASP Security - Part 1': 'owasp',
          'OWASP Security - Part 2': 'owasp',
          'Angular Best Practices': 'angular',
          'NgRx State Management': 'ngrx',
          'RxJS Patterns': 'rxjs'
        };
        const sourceValue = sourceMap[knowledgeSource] || 'all';
        if (sourceValue !== 'all') {
          filterIssues('source', sourceValue);
        }
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      initializeIssues();
      applyUrlFilters();
    });
`;
