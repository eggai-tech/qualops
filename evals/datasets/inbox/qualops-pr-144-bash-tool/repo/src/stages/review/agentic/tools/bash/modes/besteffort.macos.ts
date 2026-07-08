/**
 * Best-effort sandbox for macOS using sandbox-exec (Seatbelt).
 *
 * Applies a Seatbelt profile that:
 *  - Allows read access to /workspace and standard system paths
 *  - Denies network outbound connections
 *  - Denies writes outside /tmp and /workspace
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { SandboxDriver, SpawnOptions, PreCallResult, PostCallResult } from './interface.js';

function buildSeatbeltProfile(workspaceRoot: string): string {
  return `
(version 1)
(deny default)

; Allow reading the workspace (PR code under review)
(allow file-read* (subpath "${workspaceRoot}"))

; Allow standard system reads
(allow file-read*
  (subpath "/usr")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/lib")
  (subpath "/private/etc")
  (literal "/dev/urandom")
  (literal "/dev/random")
  (literal "/dev/null")
  (literal "/dev/zero")
)

; Allow writes only to /tmp and sandbox tmp
(allow file-write* (subpath "/private/tmp"))
(allow file-write* (subpath "/tmp"))

; Allow process operations
(allow process-exec*)
(allow process-fork)

; Allow IPC (pipes between child processes)
(allow ipc-posix-shm)
(allow ipc-posix-sem)
(allow ipc-sysv-shm)
(allow ipc-sysv-sem)

; Deny all network
(deny network*)
(deny system-socket)
`.trim();
}

export class BestEffortMacOSDriver implements SandboxDriver {
  readonly name = 'besteffort.macos';
  private workspaceRoot: string;
  private profilePath: string | null = null;

  constructor(workspaceRoot: string = '/workspace') {
    this.workspaceRoot = workspaceRoot;
  }

  static isAvailable(): boolean {
    return process.platform === 'darwin';
  }

  private getProfilePath(): string {
    if (this.profilePath) return this.profilePath;
    const dir = path.join(os.tmpdir(), `qualops-seatbelt-${process.pid}`);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const profilePath = path.join(dir, 'profile.sb');
    fs.writeFileSync(profilePath, buildSeatbeltProfile(this.workspaceRoot), { mode: 0o600 });
    this.profilePath = profilePath;
    return profilePath;
  }

  async prepare(opts: SpawnOptions): Promise<SpawnOptions> {
    const profilePath = this.getProfilePath();
    return {
      ...opts,
      argv: ['sandbox-exec', '-f', profilePath, '--', ...opts.argv],
    };
  }

  async preCall(_callId: string, _command: string): Promise<PreCallResult> {
    return { violations: [] };
  }

  async postCall(_callId: string, _command: string): Promise<PostCallResult> {
    return { violations: [], abortReview: false };
  }

  async teardown(): Promise<void> {
    if (this.profilePath) {
      try {
        fs.rmSync(path.dirname(this.profilePath), { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
      this.profilePath = null;
    }
  }
}
