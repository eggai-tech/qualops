jest.mock('@/stages/review/agentic/tools/bash/modes/ci', () => ({
  CISandboxDriver: jest.fn().mockImplementation(() => ({ name: 'ci' })),
}));
jest.mock('@/stages/review/agentic/tools/bash/modes/besteffort.linux', () => ({
  BestEffortLinuxDriver: Object.assign(
    jest.fn().mockImplementation(() => ({ name: 'local-besteffort-linux' })),
    { isAvailable: jest.fn().mockReturnValue(false) },
  ),
}));
jest.mock('@/stages/review/agentic/tools/bash/modes/besteffort.macos', () => ({
  BestEffortMacOSDriver: Object.assign(
    jest.fn().mockImplementation(() => ({ name: 'local-besteffort-macos' })),
    { isAvailable: jest.fn().mockReturnValue(false) },
  ),
}));
jest.mock('@/stages/review/agentic/tools/bash/modes/besteffort.win', () => ({
  BestEffortWindowsDriver: Object.assign(
    jest.fn().mockImplementation(() => ({ name: 'local-besteffort-win' })),
    { isAvailable: jest.fn().mockReturnValue(false) },
  ),
}));
jest.mock('@/stages/review/agentic/tools/bash/modes/none', () => ({
  NoneSandboxDriver: { create: jest.fn().mockReturnValue({ name: 'none' }) },
}));

import { BestEffortLinuxDriver } from '@/stages/review/agentic/tools/bash/modes/besteffort.linux';
import { BestEffortMacOSDriver } from '@/stages/review/agentic/tools/bash/modes/besteffort.macos';
import { BestEffortWindowsDriver } from '@/stages/review/agentic/tools/bash/modes/besteffort.win';
import { CISandboxDriver } from '@/stages/review/agentic/tools/bash/modes/ci';
import { detectSandboxDriver } from '@/stages/review/agentic/tools/bash/modes/detect';
import { NoneSandboxDriver } from '@/stages/review/agentic/tools/bash/modes/none';

const CI_ENV_VARS = [
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'CIRCLECI',
  'TRAVIS',
  'JENKINS_URL',
  'BUILDKITE',
];

function clearCIEnv() {
  for (const v of CI_ENV_VARS) delete process.env[v];
  delete process.env['QUALOPS_SANDBOX_MODE'];
  delete process.env['QUALOPS_ALLOW_UNSANDBOXED'];
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCIEnv();
  // Default: no local driver available (forces explicit setup per test)
  (BestEffortLinuxDriver.isAvailable as jest.Mock).mockReturnValue(false);
  (BestEffortMacOSDriver.isAvailable as jest.Mock).mockReturnValue(false);
  (BestEffortWindowsDriver.isAvailable as jest.Mock).mockReturnValue(false);
});

afterEach(() => {
  clearCIEnv();
});

describe('detectSandboxDriver — explicit mode override', () => {
  it('mode: ci returns CISandboxDriver regardless of env', () => {
    const driver = detectSandboxDriver({ mode: 'ci' });
    expect(driver.name).toBe('ci');
    expect(CISandboxDriver).toHaveBeenCalledTimes(1);
  });

  it('mode: none returns NoneSandboxDriver', () => {
    process.env['QUALOPS_ALLOW_UNSANDBOXED'] = '1';
    const driver = detectSandboxDriver({ mode: 'none' });
    expect(driver.name).toBe('none');
    expect(NoneSandboxDriver.create).toHaveBeenCalledTimes(1);
  });

  it('QUALOPS_SANDBOX_MODE=ci overrides auto-detection', () => {
    process.env['QUALOPS_SANDBOX_MODE'] = 'ci';
    const driver = detectSandboxDriver();
    expect(driver.name).toBe('ci');
  });

  it('QUALOPS_SANDBOX_MODE=none returns NoneSandboxDriver', () => {
    process.env['QUALOPS_SANDBOX_MODE'] = 'none';
    process.env['QUALOPS_ALLOW_UNSANDBOXED'] = '1';
    const driver = detectSandboxDriver();
    expect(driver.name).toBe('none');
  });
});

describe('detectSandboxDriver — CI environment detection', () => {
  it.each(CI_ENV_VARS)('%s=true routes to CISandboxDriver', (varName) => {
    process.env[varName] = 'true';
    const driver = detectSandboxDriver();
    expect(driver.name).toBe('ci');
    expect(CISandboxDriver).toHaveBeenCalledTimes(1);
  });

  it('passes prHooksDir and httpProxy to CISandboxDriver', () => {
    process.env['CI'] = 'true';
    detectSandboxDriver({ prHooksDir: '/workspace/pr/.git/hooks', httpProxy: 'http://proxy:3128' });
    expect(CISandboxDriver).toHaveBeenCalledWith({
      prHooksDir: '/workspace/pr/.git/hooks',
      httpProxy: 'http://proxy:3128',
    });
  });
});

describe('detectSandboxDriver — local best-effort selection', () => {
  it('prefers Linux driver when available', () => {
    (BestEffortLinuxDriver.isAvailable as jest.Mock).mockReturnValue(true);
    const driver = detectSandboxDriver();
    expect(driver.name).toBe('local-besteffort-linux');
    expect(BestEffortMacOSDriver.isAvailable).not.toHaveBeenCalled();
  });

  it('falls back to macOS driver when Linux is unavailable', () => {
    (BestEffortMacOSDriver.isAvailable as jest.Mock).mockReturnValue(true);
    const driver = detectSandboxDriver();
    expect(driver.name).toBe('local-besteffort-macos');
  });

  it('falls back to Windows driver when Linux and macOS are unavailable', () => {
    (BestEffortWindowsDriver.isAvailable as jest.Mock).mockReturnValue(true);
    const driver = detectSandboxDriver();
    expect(driver.name).toBe('local-besteffort-win');
  });

  it('passes workspaceRoot to Linux driver', () => {
    (BestEffortLinuxDriver.isAvailable as jest.Mock).mockReturnValue(true);
    detectSandboxDriver({ workspaceRoot: '/home/runner/work/repo' });
    expect(BestEffortLinuxDriver).toHaveBeenCalledWith('/home/runner/work/repo');
  });

  it('passes workspaceRoot to macOS driver', () => {
    (BestEffortMacOSDriver.isAvailable as jest.Mock).mockReturnValue(true);
    detectSandboxDriver({ workspaceRoot: '/home/runner/work/repo' });
    expect(BestEffortMacOSDriver).toHaveBeenCalledWith('/home/runner/work/repo');
  });
});

describe('detectSandboxDriver — QUALOPS_ALLOW_UNSANDBOXED fallback', () => {
  it('returns NoneSandboxDriver when set and no driver is available', () => {
    process.env['QUALOPS_ALLOW_UNSANDBOXED'] = '1';
    const driver = detectSandboxDriver();
    expect(driver.name).toBe('none');
  });

  it('throws when no driver is available and QUALOPS_ALLOW_UNSANDBOXED is unset', () => {
    expect(() => detectSandboxDriver()).toThrow('No sandbox driver available');
  });
});
