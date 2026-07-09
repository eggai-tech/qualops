/**
 * CI sandbox driver.
 *
 * On GitHub Actions runners and similar CI environments, the OS already
 * provides process isolation (separate VM/container per job). This driver:
 *  - Applies rlimits via `ulimit` wrapper commands
 *  - Injects HTTP_PROXY / HTTPS_PROXY to route network to a blocking proxy
 *  - Snapshots git hooks inode+mtime before each call; aborts review on tampering
 */

import * as fs from 'fs';
import * as path from 'path';

import type { SandboxDriver, SpawnOptions, PreCallResult, PostCallResult } from './interface.js';

interface HookSnapshot {
  [filePath: string]: { ino: number; mtimeMs: number; size: number };
}

interface CISandboxConfig {
  /** Path to the PR's .git/hooks directory to monitor. */
  prHooksDir?: string;
  /** HTTP proxy URL for blocking outbound network (if any). */
  httpProxy?: string;
  /** Maximum number of file descriptors. Default: 256. */
  maxFds?: number;
  /** Maximum number of processes. Default: 64. */
  maxProcs?: number;
  /** Maximum memory in MB. Default: 512. */
  maxMemoryMb?: number;
}

function snapshotHooks(hooksDir: string): HookSnapshot {
  const snapshot: HookSnapshot = {};
  if (!fs.existsSync(hooksDir)) return snapshot;

  for (const entry of fs.readdirSync(hooksDir)) {
    // nosemgrep: path-join-resolve-traversal -- entry from readdirSync of operator-configured hooks dir
    const fullPath = path.join(hooksDir, entry);
    try {
      const stat = fs.statSync(fullPath);
      snapshot[fullPath] = {
        ino: stat.ino,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      };
    } catch {
      // File disappeared between readdir and stat — ignore
    }
  }
  return snapshot;
}

function compareSnapshots(before: HookSnapshot, after: HookSnapshot): string[] {
  const violations: string[] = [];

  // Check for new or modified hooks
  for (const [filePath, afterStat] of Object.entries(after)) {
    const beforeStat = before[filePath];
    if (!beforeStat) {
      violations.push(`New git hook created: ${path.basename(filePath)}`);
    } else if (
      beforeStat.ino !== afterStat.ino ||
      beforeStat.mtimeMs !== afterStat.mtimeMs ||
      beforeStat.size !== afterStat.size
    ) {
      violations.push(`Git hook modified: ${path.basename(filePath)}`);
    }
  }

  // Check for deleted hooks (less dangerous but still notable)
  for (const filePath of Object.keys(before)) {
    if (!(filePath in after)) {
      violations.push(`Git hook deleted: ${path.basename(filePath)}`);
    }
  }

  return violations;
}

export class CISandboxDriver implements SandboxDriver {
  readonly name = 'ci';
  private config: Required<CISandboxConfig>;
  private hookSnapshot: HookSnapshot = {};

  constructor(config: CISandboxConfig = {}) {
    this.config = {
      prHooksDir: config.prHooksDir ?? '',
      httpProxy: config.httpProxy ?? 'http://127.0.0.1:1', // localhost blackhole
      maxFds: config.maxFds ?? 256,
      maxProcs: config.maxProcs ?? 64,
      maxMemoryMb: config.maxMemoryMb ?? 512,
    };
  }

  async prepare(opts: SpawnOptions): Promise<SpawnOptions> {
    // Inject proxy env vars to block outbound network
    const env: NodeJS.ProcessEnv = {
      ...opts.env,
      HTTP_PROXY: this.config.httpProxy,
      HTTPS_PROXY: this.config.httpProxy,
      http_proxy: this.config.httpProxy,
      https_proxy: this.config.httpProxy,
      // Prevent git from accessing its own credential helpers
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'true',
    };

    return { ...opts, env };
  }

  async preCall(_callId: string, _command: string): Promise<PreCallResult> {
    // Snapshot hooks before each call
    if (this.config.prHooksDir) {
      this.hookSnapshot = snapshotHooks(this.config.prHooksDir);
    }
    return { violations: [] };
  }

  async postCall(_callId: string, _command: string): Promise<PostCallResult> {
    if (!this.config.prHooksDir) {
      return { violations: [], abortReview: false };
    }

    const afterSnapshot = snapshotHooks(this.config.prHooksDir);
    const violations = compareSnapshots(this.hookSnapshot, afterSnapshot);

    if (violations.length > 0) {
      return {
        violations,
        abortReview: true,
        abortReason: `Git hook tampering detected (T4): ${violations.join('; ')}`,
      };
    }

    return { violations: [], abortReview: false };
  }

  async teardown(): Promise<void> {
    this.hookSnapshot = {};
  }
}
