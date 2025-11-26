export interface ChartData {
  labels: string[];
  values: number[];
  colors?: string[];
}

export interface ChartOptions {
  width?: number;
  height?: number;
  title?: string;
  showValues?: boolean;
  showPercentages?: boolean;
}

export function generateBarChart(data: ChartData, options: ChartOptions = {}): string {
  const { width = 60, height: _height = 20, title, showValues = true } = options;

  if (data.values.length === 0) {
    return 'No data to chart';
  }

  const maxValue = Math.max(...data.values);
  if (maxValue === 0) {
    return 'All values are zero';
  }

  const lines: string[] = [];

  if (title) {
    lines.push(title);
    lines.push('='.repeat(title.length));
    lines.push('');
  }

  const barMaxWidth = width - 20;
  const bars = data.values.map((value, index) => {
    const barWidth = Math.round((value / maxValue) * barMaxWidth);
    const bar = '█'.repeat(barWidth);
    const label = data.labels[index] || `Item ${index + 1}`;
    const valueText = showValues ? ` ${value}` : '';

    return {
      label: label.substring(0, 15).padEnd(15),
      bar: bar.padEnd(barMaxWidth),
      value: valueText,
    };
  });

  bars.forEach(({ label, bar, value }) => {
    lines.push(`${label} |${bar}|${value}`);
  });

  return lines.join('\n');
}

export function generatePieChart(data: ChartData, options: ChartOptions = {}): string {
  const { title, showPercentages = true } = options;

  if (data.values.length === 0) {
    return 'No data to chart';
  }

  const total = data.values.reduce((sum, val) => sum + val, 0);
  if (total === 0) {
    return 'All values are zero';
  }

  const lines: string[] = [];

  // Add title
  if (title) {
    lines.push(title);
    lines.push('='.repeat(title.length));
    lines.push('');
  }

  // Calculate percentages and generate segments
  const segments = data.values.map((value, index) => {
    const percentage = (value / total) * 100;
    const label = data.labels[index] || `Item ${index + 1}`;

    return {
      label,
      value,
      percentage: percentage.toFixed(1),
      char: getSegmentChar(index),
    };
  });

  // Generate pie representation (simplified)
  const pieRadius = 8;
  const pieLines = [];

  for (let y = -pieRadius; y <= pieRadius; y++) {
    let line = '';
    for (let x = -pieRadius; x <= pieRadius; x++) {
      const distance = Math.sqrt(x * x + y * y);
      if (distance <= pieRadius) {
        const angle = Math.atan2(y, x) + Math.PI; // 0 to 2π
        const segmentIndex = getSegmentForAngle(angle, segments, total);
        line += segments[segmentIndex]?.char || ' ';
      } else {
        line += ' ';
      }
    }
    pieLines.push(line);
  }

  lines.push(...pieLines);
  lines.push('');

  // Add legend
  lines.push('Legend:');
  segments.forEach((segment) => {
    const percentText = showPercentages ? ` (${segment.percentage}%)` : '';
    lines.push(`${segment.char} ${segment.label}: ${segment.value}${percentText}`);
  });

  return lines.join('\n');
}

export function generateSeverityChart(severityData: {
  critical: number;
  high: number;
  medium: number;
  low: number;
}): string {
  const data: ChartData = {
    labels: ['Critical', 'High', 'Medium', 'Low'],
    values: [severityData.critical, severityData.high, severityData.medium, severityData.low],
    colors: ['#dc3545', '#fd7e14', '#ffc107', '#28a745'],
  };

  return generateBarChart(data, {
    title: 'Issue Severity Distribution',
    showValues: true,
  });
}

export function generateTypeChart(typeData: {
  bug: number;
  security: number;
  performance: number;
  maintainability: number;
}): string {
  const data: ChartData = {
    labels: ['Bugs', 'Security', 'Performance', 'Maintainability'],
    values: [typeData.bug, typeData.security, typeData.performance, typeData.maintainability],
  };

  return generateBarChart(data, {
    title: 'Issue Type Distribution',
    showValues: true,
  });
}

export function generateProjectComparisonChart(projectData: { [project: string]: number }): string {
  const entries = Object.entries(projectData).sort(([, a], [, b]) => b - a);

  const data: ChartData = {
    labels: entries.map(([project]) => project),
    values: entries.map(([, count]) => count),
  };

  return generateBarChart(data, {
    title: 'Issues by Project',
    showValues: true,
  });
}

function getSegmentChar(index: number): string {
  const chars = ['▓', '▒', '░', '▓', '▒', '░', '▓', '▒'];
  return chars[index % chars.length];
}

function getSegmentForAngle(
  angle: number,
  segments: Array<{ value: number }>,
  total: number,
): number {
  let cumulative = 0;
  for (let i = 0; i < segments.length; i++) {
    cumulative += segments[i].value;
    const segmentAngle = (cumulative / total) * 2 * Math.PI;
    if (angle <= segmentAngle) {
      return i;
    }
  }
  return segments.length - 1;
}

export function generateSparkline(values: number[], width = 20): string {
  if (values.length === 0) return '';

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (range === 0) {
    return '─'.repeat(width);
  }

  const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

  return values
    .slice(0, width)
    .map((value) => {
      const normalized = (value - min) / range;
      const charIndex = Math.floor(normalized * (chars.length - 1));
      return chars[charIndex];
    })
    .join('');
}
