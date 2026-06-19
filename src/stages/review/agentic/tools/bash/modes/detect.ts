/**
 * Auto-detects the appropriate sandbox mode based on the current environment.
 *
 * Priority order:
 * 1. QUALOPS_SANDBOX_MODE env var (explicit override)
 * 2. CI environment → CISandboxDriver
 * 3. Linux + bwrap available → BestEffortLinuxDriver
 * 4. macOS → BestEffortMacOSDriver
 * 5. Windows → BestEffortWindowsDriver
 * 6. QUALOPS_ALLOW_UNSANDBOXED=1 → NoneSandboxDriver (test only)
 * 7. Error — cannot run without a sandbox
 */

import { BestEffortLinuxDriver } from './besteffort.linux.js';
import { BestEffortMacOSDriver } from './besteffort.macos.js';
import { BestEffortWindowsDriver } from './besteffort.win.js';
import { CISandboxDriver } from './ci.js';
import type { SandboxDriver } from './interface.js';
import { NoneSandboxDriver } from './none.js';

export type SandboxMode = 'ci' | 'local-besteffort' | 'none' | 'auto';

function isCI(): boolean {
  return !!(
    process.env['CI'] ||
    process.env['GITHUB_ACTIONS'] ||
    process.env['GITLAB_CI'] ||
    process.env['CIRCLECI'] ||
    process.env['TRAVIS'] ||
    process.env['JENKINS_URL'] ||
    process.env['BUILDKITE']
  );
}

export interface DetectOptions {
  /** Explicit mode override. If 'auto', detection runs normally. */
  mode?: SandboxMode;
  /** Path to the PR's workspace (used by best-effort drivers). */
  workspaceRoot?: string;
  /** Path to the PR's .git/hooks dir (used by CI driver). */
  prHooksDir?: string;
  /** HTTP proxy URL for CI driver. */
  httpProxy?: string;
}

/**
 * Returns the appropriate SandboxDriver for the current environment.
 * Throws if no suitable driver can be found and unsandboxed mode is not allowed.
 */
export function detectSandboxDriver(opts: DetectOptions = {}): SandboxDriver {
  const { mode = 'auto', workspaceRoot = '/workspace/pr', prHooksDir, httpProxy } = opts;

  const explicitMode =
    mode !== 'auto' ? mode : (process.env['QUALOPS_SANDBOX_MODE'] as SandboxMode | undefined);

  if (explicitMode === 'none') {
    return NoneSandboxDriver.create();
  }

  if (explicitMode === 'ci' || (!explicitMode && isCI())) {
    return new CISandboxDriver({ prHooksDir, httpProxy });
  }

  if (explicitMode === 'local-besteffort' || !explicitMode) {
    if (BestEffortLinuxDriver.isAvailable()) {
      return new BestEffortLinuxDriver(workspaceRoot);
    }
    if (BestEffortMacOSDriver.isAvailable()) {
      return new BestEffortMacOSDriver(workspaceRoot);
    }
    if (BestEffortWindowsDriver.isAvailable()) {
      return new BestEffortWindowsDriver();
    }
  }

  if (process.env['QUALOPS_ALLOW_UNSANDBOXED'] === '1') {
    return NoneSandboxDriver.create();
  }

  throw new Error(
    'No sandbox driver available for this environment. ' +
      'Set QUALOPS_ALLOW_UNSANDBOXED=1 to run without sandboxing (not recommended). ' +
      'Or set QUALOPS_SANDBOX_MODE=ci for CI environments.',
  );
}
