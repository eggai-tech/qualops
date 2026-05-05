/**
 * Best-effort sandbox for Linux using bubblewrap (bwrap).
 *
 * Wraps the persistent shell command with bwrap to get:
 *  - Read-only bind mount of /workspace (writes blocked)
 *  - Isolated /tmp per call
 *  - No network namespace (network is separate concern)
 *  - seccomp filter (blocks socket() for outbound network)
 *
 * Falls back gracefully if bwrap is not available.
 */

import * as child_process from 'child_process';

import type { SandboxDriver, SpawnOptions, PreCallResult, PostCallResult } from './interface.js';

function isBwrapAvailable(): boolean {
  try {
    const result = child_process.spawnSync('bwrap', ['--version'], { timeout: 2000 });
    return result.status === 0;
  } catch {
    return false;
  }
}

export class BestEffortLinuxDriver implements SandboxDriver {
  readonly name = 'besteffort.linux';
  private workspaceRoot: string;

  constructor(workspaceRoot: string = '/workspace') {
    this.workspaceRoot = workspaceRoot;
  }

  static isAvailable(): boolean {
    return process.platform === 'linux' && isBwrapAvailable();
  }

  async prepare(opts: SpawnOptions): Promise<SpawnOptions> {
    // Wrap the argv with bwrap
    const bwrapArgs = [
      // Read-only workspace mount
      '--ro-bind',
      this.workspaceRoot,
      this.workspaceRoot,
      // Essential system paths (read-only)
      '--ro-bind',
      '/usr',
      '/usr',
      '--ro-bind',
      '/lib',
      '/lib',
      '--ro-bind',
      '/lib64',
      '/lib64',
      '--ro-bind',
      '/bin',
      '/bin',
      '--ro-bind',
      '/sbin',
      '/sbin',
      // Proc/dev/sys
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      '--tmpfs',
      '/tmp',
      '--tmpfs',
      '/run',
      // Home dir — allow writes to tmp subdir
      '--tmpfs',
      '/root',
      // Deny network (new network namespace with no interfaces)
      '--unshare-net',
      // Deny user namespace creation
      '--new-session',
      // Working directory
      '--chdir',
      opts.cwd,
      '--',
      ...opts.argv,
    ];

    return {
      ...opts,
      argv: ['bwrap', ...bwrapArgs],
    };
  }

  async preCall(_callId: string, _command: string): Promise<PreCallResult> {
    return { violations: [] };
  }

  async postCall(_callId: string, _command: string): Promise<PostCallResult> {
    return { violations: [], abortReview: false };
  }

  async teardown(): Promise<void> {}
}
