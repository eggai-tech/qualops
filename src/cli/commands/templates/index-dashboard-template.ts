interface Summary {
  metadata: {
    generatedAt: string;
    version: string;
    description: string;
    filter: string | null;
  };
  overall: {
    totalSessions: number;
    completedSessions: number;
    completionRate: number;
    issues: {
      total: number;
      bySeverity: Record<string, number>;
      byType: Record<string, number>;
      byEffort: Record<string, number>;
      byKnowledgeSource: Record<string, number>;
    };
    generatedAt: string;
  };
  batches: Record<string, unknown>;
  allSessions: unknown[];
}

export function generateDashboardHTML(summary: Summary): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QualOps Reports Dashboard</title>
    <style>
        :root {
            --primary: #0969da;
            --success: #1a7f37;
            --warning: #fb8500;
            --danger: #cf222e;
            --text: #24292f;
            --text-secondary: #656d76;
            --bg: #ffffff;
            --bg-secondary: #f6f8fa;
            --bg-tertiary: #f1f3f5;
            --border: #d1d9e0;
            --border-secondary: #e1e4e8;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: var(--bg);
            color: var(--text);
            line-height: 1.6;
        }

        .header {
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border);
            padding: 1rem 2rem;
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .header h1 {
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
        }

        .header .subtitle {
            color: var(--text-secondary);
            font-size: 0.875rem;
        }

        .main-container {
            display: grid;
            grid-template-columns: 350px 1fr;
            height: calc(100vh - 100px);
            overflow: hidden;
        }

        .sidebar {
            background: var(--bg-tertiary);
            border-right: 1px solid var(--border);
            overflow-y: auto;
            padding: 1rem;
        }

        .content {
            background: var(--bg);
            overflow: hidden;
        }

        .stats-overview {
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 1rem;
            margin-bottom: 1.5rem;
        }

        .stats-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 0.75rem;
            margin-top: 0.75rem;
        }

        .stat-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            min-width: 80px;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 500;
            background: var(--bg-secondary);
            border: 1px solid var(--border-secondary);
        }

        .stat-value {
            font-weight: 600;
            margin-left: 0.25rem;
            white-space: nowrap;
        }

        .stat-label {
            font-size: 0.75rem;
            color: var(--text-secondary);
            white-space: nowrap;
        }

        .batch-section {
            margin-bottom: 1.5rem;
        }

        .batch-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: var(--primary);
            color: white;
            padding: 0.75rem 1rem;
            border-radius: 6px 6px 0 0;
            cursor: pointer;
            user-select: none;
        }

        .batch-header:hover {
            background: #0860ca;
        }

        .batch-title {
            font-weight: 600;
            font-size: 0.875rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .batch-badge {
            background: rgba(255, 255, 255, 0.2);
            padding: 0.25rem 0.5rem;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 500;
        }

        .batch-stats {
            background: var(--bg);
            border: 1px solid var(--border);
            border-top: none;
            padding: 0.75rem 1rem;
            font-size: 0.75rem;
            color: var(--text-secondary);
        }

        .batch-sessions {
            background: var(--bg);
            border: 1px solid var(--border);
            border-top: none;
            border-radius: 0 0 6px 6px;
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease-out;
        }

        .batch-sessions.expanded {
            max-height: 400px;
            overflow-y: auto;
        }

        .session-item {
            padding: 0.75rem 1rem;
            border-bottom: 1px solid var(--border-secondary);
            cursor: pointer;
            transition: background-color 0.15s ease;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .session-item:hover {
            background: var(--bg-secondary);
        }

        .session-item:last-child {
            border-bottom: none;
        }

        .session-item.active {
            background: var(--primary);
            color: white;
        }

        .session-name {
            font-size: 0.8rem;
            font-weight: 500;
            flex: 1;
        }

        .session-stats {
            font-size: 0.7rem;
            color: var(--text-secondary);
            margin-left: 0.5rem;
        }

        .session-item.active .session-stats {
            color: rgba(255, 255, 255, 0.8);
        }

        .report-frame {
            width: 100%;
            height: 100%;
            border: none;
        }

        .welcome-screen {
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            height: 100%;
            text-align: center;
            padding: 2rem;
            background: var(--bg-secondary);
        }

        .welcome-screen h2 {
            color: var(--text-secondary);
            margin-bottom: 1rem;
            font-weight: 400;
        }

        .welcome-screen p {
            color: var(--text-secondary);
            max-width: 500px;
        }

        .filter-section {
            margin-bottom: 1rem;
        }

        .filter-input {
            width: 100%;
            padding: 0.5rem;
            border: 1px solid var(--border);
            border-radius: 4px;
            font-size: 0.875rem;
            background: var(--bg);
        }

        .filter-input:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 2px rgba(9, 105, 218, 0.1);
        }

        .status-indicator {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 0.5rem;
        }

        .status-completed {
            background: var(--success);
        }

        .status-pending {
            background: var(--warning);
        }

        .status-error {
            background: var(--danger);
        }

        .issues-breakdown {
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 1rem;
            margin-bottom: 1.5rem;
        }

        .issues-breakdown h3 {
            margin-bottom: 1rem;
            color: var(--text);
        }

        .issues-section {
            margin-bottom: 1rem;
        }

        .issues-section:last-child {
            margin-bottom: 0;
        }

        .issues-section h4 {
            font-size: 0.875rem;
            color: var(--text-secondary);
            margin-bottom: 0.5rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .issues-list {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
        }

        .issue-badge {
            display: flex;
            align-items: center;
            justify-content: space-between;
            min-width: 80px;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 500;
            background: var(--bg-secondary);
            border: 1px solid var(--border-secondary);
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .issue-badge:hover {
            background: var(--primary);
            color: white;
            transform: translateY(-1px);
        }

        .issue-badge.active {
            background: var(--primary);
            color: white;
            border-color: var(--primary);
        }

        .issue-count {
            font-weight: 600;
            margin-left: 0.25rem;
        }

        .loading {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100%;
            color: var(--text-secondary);
        }

        @media (max-width: 1024px) {
            .main-container {
                grid-template-columns: 300px 1fr;
            }
        }

        @media (max-width: 768px) {
            .main-container {
                grid-template-columns: 1fr;
                grid-template-rows: auto 1fr;
            }

            .sidebar {
                max-height: 300px;
            }

            .issues-list {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>QualOps Reports Dashboard</h1>
        <p class="subtitle">Comprehensive analysis and navigation for all quality operations reports</p>
    </div>

    <div class="main-container">
        <div class="sidebar">
            <div class="filter-section">
                <input type="text" class="filter-input" placeholder="Search sessions..." id="searchInput">
            </div>

            <div class="stats-overview">
                <h3>Overall Statistics</h3>
                <div class="stats-grid" id="overallStats">
                    <div class="loading">Loading statistics...</div>
                </div>
            </div>

            <div class="issues-breakdown">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h3>Issue Analysis</h3>
                    <button id="clearFilters" onclick="clearAllFilters()" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; display: none;">Clear Filters</button>
                </div>
                <div class="issues-section">
                    <h4>By Severity</h4>
                    <div class="issues-list" id="severityBreakdown">
                        <div class="loading">Loading...</div>
                    </div>
                </div>
                <div class="issues-section">
                    <h4>By Type</h4>
                    <div class="issues-list" id="typeBreakdown">
                        <div class="loading">Loading...</div>
                    </div>
                </div>
                <div class="issues-section">
                    <h4>Knowledge Source</h4>
                    <div class="issues-list" id="knowledgeSourceBreakdown">
                        <div class="loading">Loading...</div>
                    </div>
                </div>
            </div>

            <div id="batchesContainer">
                <div class="loading">Loading batches...</div>
            </div>
        </div>

        <div class="content">
            <div class="welcome-screen" id="welcomeScreen">
                <h2>Welcome to QualOps Reports Dashboard</h2>
                <p>
                    This dashboard provides comprehensive insights into all QualOps analysis sessions.
                    Select a session from the sidebar to view its detailed report, or browse the statistics
                    to get an overview of the analysis results across all projects.
                </p>
                <p id="welcomeStats" style="margin-top: 1rem; font-size: 0.875rem;">
                    <span class="loading">Loading statistics...</span>
                </p>
            </div>
            <iframe class="report-frame" id="reportFrame" style="display: none;"></iframe>
        </div>
    </div>

    <script>
        const allData = ${JSON.stringify(summary).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')};
        let activeFilters = {
            severity: null,
            type: null,
            knowledgeSource: null
        };

        function loadData() {
            initializeDashboard();
        }

        function initializeDashboard() {
            renderOverallStats();
            renderIssuesBreakdown();
            renderBatches();
            renderWelcomeStats();
            setupSearch();
        }

        function renderOverallStats() {
            const stats = allData.overall;
            const container = document.getElementById('overallStats');

            container.innerHTML = \`
                <div class="stat-item">
                    <span class="stat-label">Sessions</span>
                    <span class="stat-value">\${stats.totalSessions}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Completed</span>
                    <span class="stat-value">\${stats.completionRate}%</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Issues</span>
                    <span class="stat-value">\${stats.issues.total.toLocaleString()}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Critical</span>
                    <span class="stat-value">\${stats.issues.bySeverity.critical}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">High</span>
                    <span class="stat-value">\${stats.issues.bySeverity.high}</span>
                </div>
            \`;
        }

        function renderIssuesBreakdown() {
            const issues = allData.overall.issues;

            const severityContainer = document.getElementById('severityBreakdown');
            let severityHtml = '';

            const severityOrder = ['critical', 'high', 'medium', 'low'];
            severityOrder.forEach(severity => {
                const count = issues.bySeverity[severity];
                if (count > 0) {
                    const isActive = activeFilters.severity === severity;
                    severityHtml += \`
                        <div class="issue-badge \${isActive ? 'active' : ''}" onclick="filterBySeverity('\${severity}')">
                            <span>\${severity.charAt(0).toUpperCase() + severity.slice(1)}</span>
                            <span class="issue-count">\${count.toLocaleString()}</span>
                        </div>
                    \`;
                }
            });

            severityContainer.innerHTML = severityHtml || '<span style="color: var(--text-secondary);">No issues found</span>';

            const typeContainer = document.getElementById('typeBreakdown');
            let typeHtml = '';

            const typeOrder = ['security', 'maintainability', 'bug', 'performance'];
            typeOrder.forEach(type => {
                const count = issues.byType[type];
                if (count > 0) {
                    const isActive = activeFilters.type === type;
                    typeHtml += \`
                        <div class="issue-badge \${isActive ? 'active' : ''}" onclick="filterByType('\${type}')">
                            <span>\${type.charAt(0).toUpperCase() + type.slice(1)}</span>
                            <span class="issue-count">\${count.toLocaleString()}</span>
                        </div>
                    \`;
                }
            });

            typeContainer.innerHTML = typeHtml || '<span style="color: var(--text-secondary);">No issues found</span>';

            const knowledgeSourceContainer = document.getElementById('knowledgeSourceBreakdown');
            let knowledgeSourceHtml = '';

            const knowledgeSources = Object.entries(issues.byKnowledgeSource)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 5);

            knowledgeSources.forEach(([source, count]) => {
                if (count > 0) {
                    let displayName = source;
                    if (source.startsWith('Architecture Decision Records')) {
                        displayName = 'ADR';
                    } else if (source.startsWith('OWASP Security')) {
                        displayName = 'OWASP';
                    } else if (source.startsWith('Angular Best Practices')) {
                        displayName = 'ANGULAR';
                    } else if (source.startsWith('RxJS Patterns')) {
                        displayName = 'RXJS';
                    } else if (source.startsWith('NgRx State Management')) {
                        displayName = 'NGRX';
                    } else {
                        displayName = source.length > 15 ? source.substring(0, 15) + '...' : source;
                    }

                    const isActive = activeFilters.knowledgeSource === source;
                    knowledgeSourceHtml += \`
                        <div class="issue-badge \${isActive ? 'active' : ''}" title="\${source}" onclick="filterByKnowledgeSource('\${source}')">
                            <span>\${displayName}</span>
                            <span class="issue-count">\${count.toLocaleString()}</span>
                        </div>
                    \`;
                }
            });

            knowledgeSourceContainer.innerHTML = knowledgeSourceHtml || '<span style="color: var(--text-secondary);">No issues found</span>';
        }

        function renderWelcomeStats() {
            const stats = allData.overall;
            const welcomeStatsContainer = document.getElementById('welcomeStats');

            welcomeStatsContainer.innerHTML = \`
                <strong>\${stats.totalSessions.toLocaleString()} sessions analyzed</strong> •
                <strong>\${stats.issues.total.toLocaleString()} issues found</strong> •
                <strong>\${stats.completionRate}% completion rate</strong>
            \`;
        }

        function renderBatches() {
            const container = document.getElementById('batchesContainer');
            const batches = allData.batches;

            let html = '';
            Object.values(batches).forEach(batch => {
                html += \`
                    <div class="batch-section">
                        <div class="batch-header" onclick="toggleBatch('\${batch.name}')">
                            <div class="batch-title">\${batch.name}</div>
                            <div class="batch-badge">\${batch.sessionCount}</div>
                        </div>
                        <div class="batch-stats">
                            \${batch.completedSessions}/\${batch.sessionCount} completed •
                            \${batch.issues.total} issues
                        </div>
                        <div class="batch-sessions" id="batch-\${batch.name}">
                            \${renderSessions(batch.sessions)}
                        </div>
                    </div>
                \`;
            });

            container.innerHTML = html;
        }

        function renderSessions(sessions) {
            return sessions.map(session => {
                const statusClass = session.hasReport ? 'status-completed' :
                                  session.error ? 'status-error' : 'status-pending';

                return \`
                    <div class="session-item" onclick="loadReport('\${session.sessionName}')" data-session="\${session.sessionName}">
                        <div class="session-name">
                            <span class="status-indicator \${statusClass}"></span>
                            \${session.projectName}
                        </div>
                        <div class="session-stats">
                            \${session.issues.total} issues
                        </div>
                    </div>
                \`;
            }).join('');
        }

        function toggleBatch(batchName) {
            const batchElement = document.getElementById(\`batch-\${batchName}\`);
            batchElement.classList.toggle('expanded');
        }

        function loadReport(sessionName) {
            document.querySelectorAll('.session-item').forEach(item => {
                item.classList.remove('active');
            });
            document.querySelector(\`[data-session="\${sessionName}"]\`).classList.add('active');

            const frame = document.getElementById('reportFrame');
            const welcome = document.getElementById('welcomeScreen');

            let reportUrl = \`./sessions/\${sessionName}/report.html\`;

            const params = new URLSearchParams();
            if (activeFilters.severity) params.append('severity', activeFilters.severity);
            if (activeFilters.type) params.append('type', activeFilters.type);
            if (activeFilters.knowledgeSource) params.append('knowledgeSource', activeFilters.knowledgeSource);

            if (params.toString()) {
                reportUrl += '?' + params.toString();
            }

            welcome.style.display = 'none';
            frame.style.display = 'block';
            frame.src = reportUrl;
        }

        function setupSearch() {
            const searchInput = document.getElementById('searchInput');
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                filterSessions(query);
            });
        }

        function filterSessions(query) {
            const sessionItems = document.querySelectorAll('.session-item');

            sessionItems.forEach(item => {
                const sessionName = item.querySelector('.session-name').textContent.toLowerCase();
                if (sessionName.includes(query)) {
                    item.style.display = 'flex';
                } else {
                    item.style.display = 'none';
                }
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case 'k':
                        e.preventDefault();
                        document.getElementById('searchInput').focus();
                        break;
                    case 'h':
                        e.preventDefault();
                        document.getElementById('welcomeScreen').style.display = 'flex';
                        document.getElementById('reportFrame').style.display = 'none';
                        document.querySelectorAll('.session-item').forEach(item => {
                            item.classList.remove('active');
                        });
                        break;
                }
            }
        });

        function filterBySeverity(severity) {
            if (activeFilters.severity === severity) {
                activeFilters.severity = null;
            } else {
                activeFilters.severity = severity;
            }
            applyFilters();
        }

        function filterByType(type) {
            if (activeFilters.type === type) {
                activeFilters.type = null;
            } else {
                activeFilters.type = type;
            }
            applyFilters();
        }

        function filterByKnowledgeSource(source) {
            if (activeFilters.knowledgeSource === source) {
                activeFilters.knowledgeSource = null;
            } else {
                activeFilters.knowledgeSource = source;
            }
            applyFilters();
        }

        function applyFilters() {
            renderIssuesBreakdown();

            const hasActiveFilters = activeFilters.severity || activeFilters.type || activeFilters.knowledgeSource;
            document.getElementById('clearFilters').style.display = hasActiveFilters ? 'block' : 'none';

            const sessionItems = document.querySelectorAll('.session-item');
            sessionItems.forEach(item => {
                const sessionName = item.getAttribute('data-session');
                const session = findSessionByName(sessionName);

                if (!session) {
                    item.style.display = 'none';
                    return;
                }

                let shouldShow = true;

                if (activeFilters.severity) {
                    const severityCount = session.issues.bySeverity[activeFilters.severity] || 0;
                    if (severityCount === 0) shouldShow = false;
                }

                if (activeFilters.type) {
                    const typeCount = session.issues.byType[activeFilters.type] || 0;
                    if (typeCount === 0) shouldShow = false;
                }

                if (activeFilters.knowledgeSource) {
                    const sourceCount = session.issues.byKnowledgeSource[activeFilters.knowledgeSource] || 0;
                    if (sourceCount === 0) shouldShow = false;
                }

                item.style.display = shouldShow ? 'flex' : 'none';
            });

            updateBatchVisibility();
        }

        function findSessionByName(sessionName) {
            for (const batch of Object.values(allData.batches)) {
                const session = batch.sessions.find(s => s.sessionName === sessionName);
                if (session) return session;
            }
            return null;
        }

        function updateBatchVisibility() {
            const batchSections = document.querySelectorAll('.batch-section');
            batchSections.forEach(batchSection => {
                const visibleSessions = batchSection.querySelectorAll('.session-item[style*="flex"], .session-item:not([style*="none"])');
                if (visibleSessions.length === 0) {
                    batchSection.style.display = 'none';
                } else {
                    batchSection.style.display = 'block';
                }
            });
        }

        function clearAllFilters() {
            activeFilters.severity = null;
            activeFilters.type = null;
            activeFilters.knowledgeSource = null;
            applyFilters();
        }

        document.addEventListener('DOMContentLoaded', loadData);
    </script>
</body>
</html>`;
}
