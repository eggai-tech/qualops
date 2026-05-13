/**
 * Best-effort sandbox for Windows using a restricted process token.
 * Strips the WRITE_DAC, WRITE_OWNER, and most privileges from the token.
 * Network isolation is not available without Hyper-V or WSL2.
 *
 * NOTE: This is a structural stub for M0. Full implementation requires
 * the `winreg` and `win32api` native modules which are Windows-only.
 * The driver is only instantiated when process.platform === 'win32'.
 */

import type { SandboxDriver, SpawnOptions, PreCallResult, PostCallResult } from './interface.js';

export class BestEffortWindowsDriver implements SandboxDriver {
  readonly name = 'besteffort.win';

  static isAvailable(): boolean {
    return process.platform === 'win32';
  }

  async prepare(opts: SpawnOptions): Promise<SpawnOptions> {
    // On Windows we rely on the caller to spawn with a restricted token.
    // The shell command is passed through unmodified; the caller (session.ts)
    // is responsible for using CreateRestrictedToken via native bindings.
    return opts;
  }

  async preCall(_callId: string, _command: string): Promise<PreCallResult> {
    return { violations: [] };
  }

  async postCall(_callId: string, _command: string): Promise<PostCallResult> {
    return { violations: [], abortReview: false };
  }

  async teardown(): Promise<void> {}
}
