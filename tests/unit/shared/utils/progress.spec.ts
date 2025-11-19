import { createProgressBar, createSpinner } from '@/shared/utils/progress';

describe('createProgressBar', () => {
  let stdoutWriteSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    stdoutWriteSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.useFakeTimers();
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    jest.useRealTimers();
  });

  describe('update', () => {
    it('should display progress bar with percentage', () => {
      const progress = createProgressBar(100);

      progress.update(50);

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('['));
      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining(']'));
      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('50%'));
    });

    it('should display filled bar based on progress', () => {
      const progress = createProgressBar(100, { width: 10 });

      progress.update(50);

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).toContain('█');
    });

    it('should display status message', () => {
      const progress = createProgressBar(100);

      progress.update(50, 'Processing files');

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('Processing files'));
    });

    it('should display current/total when no message provided', () => {
      const progress = createProgressBar(100);

      progress.update(50);

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('50/100'));
    });

    it('should display label when provided', () => {
      const progress = createProgressBar(100, { label: 'Files' });

      progress.update(50);

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('Files'));
    });

    it('should cap percentage at 100%', () => {
      const progress = createProgressBar(100);

      progress.update(150);

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('100%'));
    });

    it('should handle zero total', () => {
      const progress = createProgressBar(0);

      progress.update(0);

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('0%'));
    });

    it('should display ETA when enabled', () => {
      const progress = createProgressBar(100, { showETA: true });

      jest.advanceTimersByTime(1000);
      progress.update(25);

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).toContain('ETA:');
    });

    it('should not display ETA when disabled', () => {
      const progress = createProgressBar(100, { showETA: false });

      jest.advanceTimersByTime(1000);
      progress.update(25);

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).not.toContain('ETA:');
    });

    it('should not display ETA at start', () => {
      const progress = createProgressBar(100, { showETA: true });

      progress.update(0);

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).not.toContain('ETA:');
    });

    it('should not display ETA at completion', () => {
      const progress = createProgressBar(100, { showETA: true });

      jest.advanceTimersByTime(1000);
      progress.update(100);

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).not.toContain('ETA:');
    });

    it('should display rate when enabled', () => {
      const progress = createProgressBar(100, { showRate: true });

      progress.update(10);
      jest.advanceTimersByTime(200);
      progress.update(20);

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).toMatch(/\d+\.\d+\/s/);
    });

    it('should not display rate when disabled', () => {
      const progress = createProgressBar(100, { showRate: false });

      progress.update(10);
      jest.advanceTimersByTime(200);
      progress.update(20);

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).not.toContain('/s');
    });

    it('should only update rate after threshold time', () => {
      const progress = createProgressBar(100, { showRate: true });

      progress.update(10);
      jest.advanceTimersByTime(50);
      progress.update(20);

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).not.toContain('/s');
    });

    it('should clear previous output', () => {
      const progress = createProgressBar(100);

      progress.update(25);
      progress.update(50);

      const calls = stdoutWriteSpy.mock.calls;
      expect(calls.some((call) => call[0].includes('\r'))).toBe(true);
    });

    it('should use custom width', () => {
      const progress = createProgressBar(100, { width: 20 });

      progress.update(50);

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      const match = lastCall.match(/\[(█| )+\]/);
      expect(match).toBeTruthy();
      const barContent = match ? match[0].slice(1, -1) : '';
      expect(match ? barContent.length === 20 : false).toBe(true);
    });

    it('should handle safe rate calculation with zero time delta', () => {
      const progress = createProgressBar(100, { showRate: true });

      progress.update(10);
      progress.update(20);

      expect(stdoutWriteSpy).toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    it('should display completion message', () => {
      const progress = createProgressBar(100);

      jest.advanceTimersByTime(5000);
      progress.complete();

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('Complete'));
    });

    it('should display custom completion message', () => {
      const progress = createProgressBar(100);

      progress.complete('Done processing');

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('Done processing'));
    });

    it('should display elapsed time', () => {
      const progress = createProgressBar(100);

      jest.advanceTimersByTime(5000);
      progress.complete();

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('5s'));
    });

    it('should show 100% progress', () => {
      const progress = createProgressBar(100);

      progress.complete();

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('100%'));
    });

    it('should add newline', () => {
      const progress = createProgressBar(100);

      progress.complete();

      expect(stdoutWriteSpy).toHaveBeenCalledWith('\n');
    });
  });

  describe('fail', () => {
    it('should display failure message', () => {
      const progress = createProgressBar(100);

      progress.fail();

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('Failed'));
    });

    it('should display custom failure message', () => {
      const progress = createProgressBar(100);

      progress.fail('Error occurred');

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('Error occurred'));
    });

    it('should display failure symbol', () => {
      const progress = createProgressBar(100);

      progress.fail();

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('✗'));
    });

    it('should add newline', () => {
      const progress = createProgressBar(100);

      progress.fail();

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringMatching(/\n$/));
    });

    it('should clear previous output', () => {
      const progress = createProgressBar(100);

      progress.update(50);
      progress.fail();

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('\r'));
    });
  });

  describe('formatDuration', () => {
    it('should format milliseconds', () => {
      const progress = createProgressBar(100);

      progress.complete();

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 2][0];
      expect(lastCall).toMatch(/\d+(ms|s)/);
    });

    it('should format seconds', () => {
      const progress = createProgressBar(100);

      jest.advanceTimersByTime(5000);
      progress.complete();

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('5s'));
    });

    it('should format minutes and seconds', () => {
      const progress = createProgressBar(100);

      jest.advanceTimersByTime(125000);
      progress.complete();

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('2m'));
    });

    it('should format hours and minutes', () => {
      const progress = createProgressBar(100);

      jest.advanceTimersByTime(7500000);
      progress.complete();

      expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringMatching(/\dh \d+m/));
    });
  });

  describe('default options', () => {
    it('should use default width of 40', () => {
      const progress = createProgressBar(100);

      progress.update(100);

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      const match = lastCall.match(/\[(█| )+\]/);
      expect(match).toBeTruthy();
      const barContent = match ? match[0].slice(1, -1) : '';
      expect(match ? barContent.length === 40 : false).toBe(true);
    });

    it('should enable ETA by default', () => {
      const progress = createProgressBar(100);

      jest.advanceTimersByTime(1000);
      progress.update(25);

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).toContain('ETA:');
    });

    it('should disable rate by default', () => {
      const progress = createProgressBar(100);

      progress.update(10);
      jest.advanceTimersByTime(200);
      progress.update(20);

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).not.toContain('/s');
    });

    it('should have empty label by default', () => {
      const progress = createProgressBar(100);

      progress.update(50);

      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      expect(lastCall).toMatch(/^\r\[/);
    });
  });
});

describe('createSpinner', () => {
  let stdoutWriteSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    stdoutWriteSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.useFakeTimers();
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    jest.useRealTimers();
  });

  it('should display spinner with message', () => {
    const spinner = createSpinner('Loading');

    jest.advanceTimersByTime(80);

    expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('Loading'));

    spinner.stop();
  });

  it('should display spinner frames', () => {
    const spinner = createSpinner('Loading');

    jest.advanceTimersByTime(80);

    expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringMatching(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/));

    spinner.stop();
  });

  it('should animate spinner', () => {
    const spinner = createSpinner('Loading');

    const firstCall = stdoutWriteSpy.mock.calls.length;
    jest.advanceTimersByTime(80);
    const secondCall = stdoutWriteSpy.mock.calls.length;
    jest.advanceTimersByTime(80);
    const thirdCall = stdoutWriteSpy.mock.calls.length;

    expect(secondCall).toBeGreaterThan(firstCall);
    expect(thirdCall).toBeGreaterThan(secondCall);

    spinner.stop();
  });

  it('should cycle through frames', () => {
    const spinner = createSpinner('Loading');

    const frames = new Set<string>();
    for (let i = 0; i < 10; i++) {
      jest.advanceTimersByTime(80);
      const lastCall = stdoutWriteSpy.mock.calls[stdoutWriteSpy.mock.calls.length - 1][0];
      const match = lastCall.match(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
      if (match) frames.add(match[0]);
    }

    expect(frames.size).toBeGreaterThan(1);

    spinner.stop();
  });

  it('should clear spinner on stop', () => {
    const spinner = createSpinner('Loading');

    jest.advanceTimersByTime(80);
    const callCountBefore = stdoutWriteSpy.mock.calls.length;

    spinner.stop();

    expect(stdoutWriteSpy.mock.calls.length).toBeGreaterThan(callCountBefore);
    expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining('\r'));
  });

  it('should stop animation on stop', () => {
    const spinner = createSpinner('Loading');

    jest.advanceTimersByTime(80);
    spinner.stop();

    const callCountAtStop = stdoutWriteSpy.mock.calls.length;
    jest.advanceTimersByTime(160);

    expect(stdoutWriteSpy.mock.calls).toHaveLength(callCountAtStop);
  });

  it('should handle long messages', () => {
    const longMessage = 'A'.repeat(100);
    const spinner = createSpinner(longMessage);

    jest.advanceTimersByTime(80);

    expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining(longMessage));

    spinner.stop();
  });

  it('should handle empty message', () => {
    const spinner = createSpinner('');

    jest.advanceTimersByTime(80);

    expect(stdoutWriteSpy).toHaveBeenCalled();

    spinner.stop();
  });

  it('should run at 80ms intervals', () => {
    const spinner = createSpinner('Loading');

    jest.advanceTimersByTime(79);
    const callCount1 = stdoutWriteSpy.mock.calls.length;

    jest.advanceTimersByTime(1);
    const callCount2 = stdoutWriteSpy.mock.calls.length;

    expect(callCount2).toBeGreaterThan(callCount1);

    spinner.stop();
  });
});
