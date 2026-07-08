/**
 * None sandbox driver — no OS-level confinement.
 * ONLY for local development and unit tests.
 * Gated by QUALOPS_ALLOW_UNSANDBOXED=1.
 */

import type { SandboxDriver, SpawnOptions, PreCallResult, PostCallResult } from './interface.js';

export class NoneSandboxDriver implements SandboxDriver {
  readonly name = 'none';

  static create(): NoneSandboxDriver {
    if (process.env['QUALOPS_ALLOW_UNSANDBOXED'] !== '1') {
      throw new Error(
        'NoneSandboxDriver requires QUALOPS_ALLOW_UNSANDBOXED=1 env var. ' +
          'Do not use in production.',
      );
    }
    return new NoneSandboxDriver();
  }

  async prepare(opts: SpawnOptions): Promise<SpawnOptions> {
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
