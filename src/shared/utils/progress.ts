interface ProgressOptions {
  width?: number;
  showETA?: boolean;
  showRate?: boolean;
  label?: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function createProgressBar(
  total: number,
  options: ProgressOptions = {},
): {
  update: (current: number, message?: string) => void;
  complete: (message?: string) => void;
  fail: (message?: string) => void;
} {
  const { width = 40, showETA = true, showRate = false, label = '' } = options;
  let lastOutput = '';
  const startTime = Date.now();
  let lastUpdateTime = startTime;
  let lastUpdateCount = 0;

  const update = (current: number, message?: string) => {
    const now = Date.now();
    const elapsed = now - startTime;
    const percentage = total === 0 ? 0 : Math.min(100, Math.round((current / total) * 100));
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;

    const bar = `[${'█'.repeat(filled)}${' '.repeat(empty)}]`;

    let etaString = '';
    if (showETA && current > 0 && current < total && elapsed > 0) {
      const rate = elapsed > 0 ? current / elapsed : 0;
      const remaining = total - current;
      const eta = rate > 0 && !isNaN(rate) && isFinite(rate) ? remaining / rate : 0;
      etaString = ` | ETA: ${formatDuration(Math.round(eta))}`;
    }

    let rateString = '';
    if (showRate && now - lastUpdateTime > 100) {
      const timeDelta = now - lastUpdateTime;
      const countDelta = current - lastUpdateCount;
      const rate = timeDelta > 0 ? (countDelta / timeDelta) * 1000 : 0;
      const safeRate = isNaN(rate) || !isFinite(rate) ? 0 : rate;
      rateString = ` | ${safeRate.toFixed(1)}/s`;
      lastUpdateTime = now;
      lastUpdateCount = current;
    }

    const status = message || `${current}/${total}`;
    const prefix = label ? `${label} ` : '';
    const output = `\r${prefix}${bar} ${percentage}%${etaString}${rateString} | ${status}`;

    process.stdout.write('\r' + ' '.repeat(lastOutput.length) + '\r');
    process.stdout.write(output);
    lastOutput = output;
  };

  const complete = (message?: string) => {
    const elapsed = Date.now() - startTime;
    const completeMsg = message || `Complete in ${formatDuration(elapsed)}`;
    update(total, completeMsg);
    process.stdout.write('\n');
  };

  const fail = (message?: string) => {
    const failMsg = message || 'Failed';
    process.stdout.write('\r' + ' '.repeat(lastOutput.length) + '\r');
    process.stdout.write(`✗ ${failMsg}\n`);
  };

  return { update, complete, fail };
}

export function createSpinner(message: string): {
  stop: () => void;
} {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let index = 0;

  const interval = setInterval(() => {
    process.stdout.write(`\r${frames[index]} ${message}`);
    index = (index + 1) % frames.length;
  }, 80);

  return {
    stop: () => {
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(message.length + 4) + '\r');
    },
  };
}
