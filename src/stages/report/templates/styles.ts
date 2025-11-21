export const CSS_STYLES = `
    :root {
      --color-text: #24292f;
      --color-text-secondary: #656d76;
      --color-bg: #ffffff;
      --color-bg-secondary: #f6f8fa;
      --color-bg-tertiary: #f1f3f5;
      --color-border: #d1d9e0;
      --color-border-secondary: #e1e4e8;
      --color-accent: #0969da;
      --color-danger: #cf222e;
      --color-warning: #fb8500;
      --color-success: #1a7f37;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
      background: var(--color-bg-secondary);
      color: var(--color-text);
      line-height: 1.5;
      font-size: 14px;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: var(--color-bg);
      min-height: 100vh;
    }

    .main-content {
      padding: 24px;
    }

    .page-header {
      margin-bottom: 32px;
      padding-bottom: 20px;
    }

    .header-main {
      margin-bottom: 12px;
    }

    .component-name {
      font-size: 28px;
      font-weight: 600;
      color: var(--color-text);
      font-family: "SF Mono", Consolas, monospace;
      margin-bottom: 12px;
    }

    .projects-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }

    .project-tag {
      display: inline-block;
      padding: 4px 12px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .project-tag:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.15);
    }

    .header-status {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 4px;
    }

    .total-issues {
      font-size: 16px;
      font-weight: 500;
      color: var(--color-text);
    }

    .issue-breakdown {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 13px;
      color: var(--color-text-secondary);
      font-family: "SF Mono", Consolas, monospace;
    }

    .issue-count {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .issue-count .count {
      font-weight: 600;
      color: var(--color-text);
    }

    .critical-count { color: var(--color-danger); }
    .high-count { color: var(--color-warning); }
    .medium-count { color: var(--color-accent); }
    .low-count { color: var(--color-success); }

    .status-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
    }

    .status-badge.passed {
      background: var(--color-success);
      color: white;
      border: 1px solid var(--color-success);
    }

    .status-badge.failed {
      background: var(--color-danger);
      color: white;
      border: 1px solid var(--color-danger);
    }

    .meta-info {
      font-size: 13px;
      color: var(--color-text);
      margin-top: 8px;
      font-weight: 500;
    }

    .section {
      margin: 20px 0;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0;
      margin-bottom: 16px;
    }

    .section-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--color-text);
    }

    .filter-container {
      margin-bottom: 24px;
    }

    .filters-section-title {
      font-size: 24px;
      font-weight: 600;
      color: var(--color-text);
      margin-bottom: 20px;
      padding-bottom: 12px;
    }

    .filter-group {
      margin-bottom: 12px;
    }

    .filter-group-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--color-text-secondary);
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }

    .filter-bar {
      display: flex;
      gap: 0;
      flex-wrap: wrap;
    }

    .filter-button {
      border: 1px solid var(--color-border);
      padding: 8px 12px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.1s ease;
      font-weight: 500;
      text-align: center;
      min-width: 80px;
      background: var(--color-bg);
      color: var(--color-text);
    }

    .filter-bar .filter-button:first-child {
      border-radius: 6px 0 0 6px;
    }

    .filter-bar .filter-button:last-child {
      border-radius: 0 6px 6px 0;
    }

    .filter-bar .filter-button:only-child {
      border-radius: 6px;
    }

    .filter-bar .filter-button:not(:first-child) {
      margin-left: -1px;
    }

    .filter-button:hover {
      background: var(--color-bg-tertiary);
      border-color: var(--color-accent);
      z-index: 1;
      position: relative;
    }

    .filter-button.active {
      background: var(--color-accent);
      color: white;
      border-color: var(--color-accent);
      z-index: 1;
      position: relative;
    }

    .filter-button.critical {
      background: rgba(207, 34, 46, 0.1);
      color: var(--color-danger);
      border-color: var(--color-danger);
    }

    .filter-button.critical:hover,
    .filter-button.critical.active {
      background: var(--color-danger);
      color: white;
    }

    .filter-button.high {
      background: rgba(251, 133, 0, 0.1);
      color: var(--color-warning);
      border-color: var(--color-warning);
    }

    .filter-button.high:hover,
    .filter-button.high.active {
      background: var(--color-warning);
      color: white;
    }

    .filter-button.medium {
      background: rgba(9, 105, 218, 0.1);
      color: var(--color-accent);
      border-color: var(--color-accent);
    }

    .filter-button.medium:hover,
    .filter-button.medium.active {
      background: var(--color-accent);
      color: white;
    }

    .filter-button.low {
      background: rgba(26, 127, 55, 0.1);
      color: var(--color-success);
      border-color: var(--color-success);
    }

    .filter-button.low:hover,
    .filter-button.low.active {
      background: var(--color-success);
      color: white;
    }

    .file-section {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      margin-bottom: 16px;
      overflow: hidden;
    }

    .file-header {
      background: var(--color-bg-secondary);
      padding: 8px 12px;
      border-bottom: 1px solid var(--color-border);
      font-family: "SF Mono", Consolas, monospace;
      font-size: 12px;
      font-weight: 600;
      color: var(--color-text);
    }

    .issue-card {
      margin: 6px 0;
      border-left: 2px solid transparent;
      transition: border-color 0.15s ease;
    }

    .issue-card[data-severity="critical"] {
      border-left-color: var(--color-danger);
    }

    .issue-card[data-severity="high"] {
      border-left-color: var(--color-warning);
    }

    .issue-card[data-severity="medium"] {
      border-left-color: var(--color-accent);
    }

    .issue-card[data-severity="low"] {
      border-left-color: var(--color-success);
    }

    .issue-header {
      padding: 6px 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: background-color 0.1s ease;
    }

    .issue-header:hover {
      background: var(--color-bg-secondary);
      border-radius: 4px;
    }

    .issue-title {
      font-weight: 500;
      flex: 1;
      margin-right: 12px;
      font-size: 13px;
    }

    .issue-badges {
      display: flex;
      gap: 4px;
      align-items: center;
    }

    .severity-badge {
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      background: var(--color-bg-tertiary);
      color: var(--color-text-secondary);
      border: 1px solid var(--color-border);
    }

    .type-badge {
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 500;
      background: var(--color-bg-tertiary);
      color: var(--color-text-secondary);
      text-transform: uppercase;
    }

    .issue-id-badge {
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      background: #2d3748;
      color: #e2e8f0;
      margin-right: 8px;
      border: 1px solid #4a5568;
    }

    .confidence-badge {
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 500;
      margin-left: 4px;
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }

    .confidence-high {
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
    }

    .confidence-medium {
      background: #fff3cd;
      color: #856404;
      border: 1px solid #ffeaa7;
    }

    .confidence-low {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }

    .issue-details {
      padding: 8px 4px 8px 20px;
      display: none;
      margin-top: 8px;
      border-top: 1px solid var(--color-border-secondary);
    }

    .issue-details.expanded {
      display: block;
    }

    .detail-section {
      margin-bottom: 16px;
    }

    .detail-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--color-text);
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .detail-content {
      font-size: 13px;
      line-height: 1.5;
      color: var(--color-text);
      padding: 4px 0;
    }

    .code-section {
      margin: 12px 0;
    }

    .code-header {
      background: #f6f8fa;
      color: var(--color-text);
      padding: 8px 12px;
      font-size: 11px;
      font-family: "SF Mono", Consolas, monospace;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-radius: 6px 6px 0 0;
      border: 1px solid var(--color-border);
      border-bottom: none;
    }

    .copy-button {
      background: var(--color-bg);
      color: var(--color-text);
      border: 1px solid var(--color-border);
      padding: 4px 8px;
      border-radius: 3px;
      font-size: 10px;
      cursor: pointer;
      transition: background-color 0.1s ease;
    }

    .copy-button:hover {
      background: var(--color-bg-tertiary);
    }

    .code-content {
      background: white;
      margin: 0;
      border-radius: 0 0 6px 6px;
      font-size: 12px;
      line-height: 1.4;
      padding: 0;
      overflow-x: auto;
    }

    .code-line {
      display: flex;
      font-family: "SF Mono", Consolas, monospace;
      white-space: pre;
    }

    .code-line.highlighted {
      background-color: #fff8dc;
      border-left: 3px solid #fb8500;
      margin-left: -3px;
    }

    .line-number {
      background: #f6f8fa;
      color: #656d76;
      padding: 0 8px;
      min-width: 50px;
      text-align: right;
      border-right: 1px solid #e1e4e8;
      user-select: none;
      font-size: 11px;
      flex-shrink: 0;
    }

    .line-content {
      padding: 0 8px;
      flex: 1;
      color: #24292f;
      white-space: pre;
      tab-size: 2;
    }

    .diff-line.added {
      background: #f0fff4;
    }

    .diff-line.added .line-number {
      background: #dcffe4;
      color: #1f883d;
    }

    .diff-line.added .line-content::before {
      content: '+';
      color: #1f883d;
      margin-right: 4px;
    }

    .diff-line.removed {
      background: #ffeef0;
    }

    .diff-line.removed .line-number {
      background: #ffdce0;
      color: #cf222e;
    }

    .diff-line.removed .line-content::before {
      content: '-';
      color: #cf222e;
      margin-right: 4px;
    }

    .diff-header {
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 8px 12px;
      font-size: 11px;
      font-family: "SF Mono", Consolas, monospace;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-radius: 6px 6px 0 0;
    }

    .diff-content {
      background: #ffffff;
    }

    .code-header .diff-stats {
      font-size: 10px;
      color: var(--color-text-secondary);
      display: flex;
      gap: 8px;
    }

    .code-header .diff-stats .added {
      color: var(--color-success);
      font-weight: 600;
    }

    .code-header .diff-stats .removed {
      color: var(--color-danger);
      font-weight: 600;
    }

    .expand-icon {
      font-size: 10px;
      color: var(--color-text-secondary);
      transition: transform 0.1s ease;
      margin-right: 8px;
    }

    .expanded .expand-icon {
      transform: rotate(90deg);
    }

    .directory-section {
      margin-bottom: 20px;
    }

    .directory-header {
      padding: 12px 4px;
      font-family: "SF Mono", Consolas, monospace;
      font-size: 14px;
      font-weight: 600;
      color: var(--color-text);
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      transition: color 0.15s ease;
      border-bottom: 1px solid var(--color-border-secondary);
    }

    .directory-header:hover {
      color: var(--color-accent);
    }

    .directory-content {
      background: var(--color-bg);
      padding-left: 20px;
    }

    .file-section {
      margin: 4px 0;
    }

    .file-header {
      padding: 8px 4px;
      font-family: "SF Mono", Consolas, monospace;
      font-size: 13px;
      font-weight: 500;
      color: var(--color-text-secondary);
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      transition: color 0.15s ease;
    }

    .file-header:hover {
      color: var(--color-text);
    }

    .file-content {
      padding-left: 16px;
      margin-top: 4px;
    }

    .expand-icon {
      font-size: 10px;
      color: var(--color-text-secondary);
      transition: transform 0.1s ease;
      margin-right: 8px;
    }

    .expanded .expand-icon {
      transform: rotate(90deg);
    }

    @media (max-width: 768px) {
      .filter-bar {
        flex-direction: column;
        gap: 0;
      }
      .filter-button {
        min-width: auto;
        border-radius: 0 !important;
        margin-left: 0 !important;
        border-bottom-width: 1px;
      }
      .filter-bar .filter-button:first-child {
        border-radius: 6px 6px 0 0 !important;
      }
      .filter-bar .filter-button:last-child {
        border-radius: 0 0 6px 6px !important;
        border-bottom-width: 2px;
      }
      .filter-bar .filter-button:not(:last-child) {
        margin-bottom: -1px;
      }
    }
`;
