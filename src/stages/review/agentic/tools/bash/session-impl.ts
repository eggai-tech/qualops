/**
 * Persistent bash shell session.
 *
 * Spawns a single `bash --norc --noprofile` process that lives for the
 * duration of a review session. Each tool call writes a command to stdin
 * and reads until the sentinel PS1 marker appears on stdout.
 *
 * The sentinel PS1 encodes the exit code and cwd as JSON so we can parse
 * them without an extra round-trip.
 */

import * as child_process from 'child_process';

import { makeCleanEnv } from './env-scrub.js';
import { getGitConfigPath } from './git-config-template.js';
import type { SandboxDriver, SpawnOptions } from './modes/interface.js';
import { logger } from '../../../../../shared/utils/logger.js';

const SENTINEL_BEGIN = '###QUALOPS_PS1_BEGIN###';
const SENTINEL_END = '###QUALOPS_PS1_END###';

// Shell init script: HISTFILE=/dev/null, set -o pipefail, no aliases
// Ends with an explicit sentinel echo so spawn() knows the shell is ready.
const SHELL_INIT = [
  'HISTFILE=/dev/null',
  'HISTSIZE=0',
  'set -o pipefail',
  'shopt -u expand_aliases 2>/dev/null || true',
  'unalias -a 2>/dev/null || true',
  // The sentinel is echoed explicitly after each command (non-interactive shell, no PS1).
  // SENTINEL_BEGIN and SENTINEL_END are literal strings injected by JS; $(pwd) is shell-evaluated.
  `echo "${SENTINEL_BEGIN}{\\"exit\\":\\"0\\",\\"cwd\\":\\"$(pwd)\\"}${SENTINEL_END}"`,
  '',
].join('\n');

export interface SessionExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  cwdDrifted: boolean;
  cwdDriftNotice: string;
}

interface SentinelData {
  exit: string;
  cwd: string;
}

function parseSentinel(sentinel: string): SentinelData | null {
  const start = sentinel.indexOf(SENTINEL_BEGIN);
  const end = sentinel.indexOf(SENTINEL_END, start);
  if (start === -1 || end === -1) return null;

  const json = sentinel.slice(start + SENTINEL_BEGIN.length, end);
  try {
    return JSON.parse(json) as SentinelData;
  } catch {
    return null;
  }
}

export class BashShellSession {
  private proc: child_process.ChildProcessWithoutNullStreams | null = null;
  private cwd: string;
  private driver: SandboxDriver;
  private stdoutBuf = '';
  private stderrBuf = '';
  private waiters: Array<() => void> = [];
  private closed = false;

  private constructor(cwd: string, driver: SandboxDriver) {
    this.cwd = cwd;
    this.driver = driver;
  }

  static async create(cwd: string, driver: SandboxDriver): Promise<BashShellSession> {
    const session = new BashShellSession(cwd, driver);
    await session.spawn();
    return session;
  }

  private async spawn(): Promise<void> {
    const gitConfigPath = getGitConfigPath();
    const env = makeCleanEnv(gitConfigPath, {
      TERM: 'dumb',
      QUALOPS_WORKSPACE: this.cwd,
    });

    const baseOpts: SpawnOptions = {
      cwd: this.cwd,
      env,
      argv: ['bash', '--norc', '--noprofile'],
    };

    const opts = await this.driver.prepare(baseOpts);

    this.proc = child_process.spawn(opts.argv[0]!, opts.argv.slice(1), {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout.on('data', (chunk: Buffer) => {
      this.stdoutBuf += chunk.toString('utf8');
      this.drainWaiters();
    });

    this.proc.stderr.on('data', (chunk: Buffer) => {
      this.stderrBuf += chunk.toString('utf8');
    });

    this.proc.on('close', () => {
      this.closed = true;
      this.drainWaiters();
    });

    this.proc.on('error', (err) => {
      logger.error('[bash/session] shell process error', { err });
      this.closed = true;
      this.drainWaiters();
    });

    await this.writeAndWaitForSentinel(SHELL_INIT);
    this.stdoutBuf = '';
    this.stderrBuf = '';
  }

  private drainWaiters(): void {
    const w = this.waiters.splice(0);
    for (const fn of w) fn();
  }

  private waitForData(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.closed || this.stdoutBuf.includes(SENTINEL_END)) {
        resolve();
        return;
      }
      this.waiters.push(resolve);
    });
  }

  private async writeAndWaitForSentinel(
    script: string,
  ): Promise<{ stdout: string; stderr: string }> {
    if (!this.proc || this.closed) {
      throw new Error('[bash/session] Shell process is not running');
    }

    this.stdoutBuf = '';
    this.stderrBuf = '';

    this.proc.stdin.write(script + '\n');

    while (!this.stdoutBuf.includes(SENTINEL_END) && !this.closed) {
      await this.waitForData();
    }

    const stdout = this.stdoutBuf;
    const stderr = this.stderrBuf;
    this.stdoutBuf = '';
    this.stderrBuf = '';

    return { stdout, stderr };
  }

  async exec(command: string, workspaceRoot: string = '/workspace'): Promise<SessionExecResult> {
    if (!this.proc || this.closed) {
      throw new Error('[bash/session] Shell session has been disposed');
    }

    const startMs = Date.now();

    // Wrap command: run it, capture exit code, then echo the sentinel explicitly.
    // Non-interactive shells don't print PS1, so we echo it ourselves after each command.
    const script = `${command}\n__exit__=$?\necho "${SENTINEL_BEGIN}{\\"exit\\":\\"$__exit__\\",\\"cwd\\":\\"$(pwd)\\"}${SENTINEL_END}"\n`;
    const { stdout, stderr } = await this.writeAndWaitForSentinel(script);

    const durationMs = Date.now() - startMs;

    const sentinel = parseSentinel(stdout);
    const exitCode = sentinel ? parseInt(sentinel.exit, 10) : 1;
    const cwd = sentinel?.cwd ?? this.cwd;

    const sentinelStart = stdout.indexOf(SENTINEL_BEGIN);
    const cleanStdout = sentinelStart === -1 ? stdout : stdout.slice(0, sentinelStart).trimEnd();

    let cwdDrifted = false;
    let cwdDriftNotice = '';

    if (cwd && !cwd.startsWith(workspaceRoot) && cwd !== workspaceRoot) {
      cwdDrifted = true;
      cwdDriftNotice = `[qualops/session] CWD drifted to ${cwd} (outside workspace). Reset to ${this.cwd}.`;
      if (this.proc && !this.closed) {
        this.proc.stdin.write(`cd ${JSON.stringify(this.cwd)}\n`);
      }
    }

    return {
      stdout: cleanStdout,
      stderr,
      exitCode: isNaN(exitCode) ? 1 : exitCode,
      durationMs,
      cwdDrifted,
      cwdDriftNotice,
    };
  }

  async dispose(): Promise<void> {
    await this.driver.teardown();
    if (this.proc && !this.closed) {
      this.proc.stdin.end();
      // Give it 1 second to exit cleanly before SIGKILL
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (this.proc && !this.closed) this.proc.kill('SIGKILL');
          resolve();
        }, 1000);
        this.proc!.on('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.proc = null;
    this.closed = true;
  }

  get isAlive(): boolean {
    return !this.closed && this.proc !== null;
  }
}
