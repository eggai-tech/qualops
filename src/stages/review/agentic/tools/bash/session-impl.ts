/**
 * Persistent bash shell session.
 *
 * Spawns a single `bash --norc --noprofile` process that lives for the
 * duration of a review session. Each tool call writes a command to stdin
 * and reads until the sentinel PS1 marker appears on stdout.
 *
 * The sentinel emits the exit code as JSON between SENTINEL_BEGIN/END markers,
 * then the cwd on a separate plain line prefixed with SENTINEL_PWD_PREFIX.
 * Keeping the cwd out of the JSON string avoids quoting issues for paths that
 * contain characters special to JSON (e.g. backslash, double-quote).
 */

import * as child_process from 'child_process';

import { makeCleanEnv } from './env-scrub.js';
import { getGitConfigPath } from './git-config-template.js';
import type { SandboxDriver, SpawnOptions } from './modes/interface.js';
import { logger } from '../../../../../shared/utils/logger.js';

const SENTINEL_BEGIN = '###QUALOPS_PS1_BEGIN###';
const SENTINEL_END = '###QUALOPS_PS1_END###';
// cwd is emitted on a separate line to avoid JSON quoting issues with special path chars.
const SENTINEL_PWD_PREFIX = 'QUALOPS_PWD:';

// Shell init script: HISTFILE=/dev/null, set -o pipefail, no aliases
// Ends with an explicit sentinel echo so spawn() knows the shell is ready.
const SHELL_INIT = [
  'HISTFILE=/dev/null',
  'HISTSIZE=0',
  'set -o pipefail',
  'shopt -u expand_aliases 2>/dev/null || true',
  'unalias -a 2>/dev/null || true',
  // Exit code JSON between sentinel markers; cwd on a separate plain line.
  `echo "${SENTINEL_BEGIN}{\\"exit\\":\\"0\\"}${SENTINEL_END}"`,
  `echo "${SENTINEL_PWD_PREFIX}$(pwd)"`,
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

function buildExecScript(command: string): string {
  // Wrap the command so bash captures its exit code and emits the sentinel.
  // The sentinel carries the exit code as JSON; cwd follows on a separate line
  // to avoid JSON quoting issues with paths containing backslashes or quotes.
  return (
    `${command}\n` +
    `__exit__=$?\n` +
    `echo "${SENTINEL_BEGIN}{\\"exit\\":\\"$__exit__\\"}${SENTINEL_END}"\n` +
    `echo "${SENTINEL_PWD_PREFIX}$(pwd)"\n`
  );
}

function parseSentinel(output: string): SentinelData | null {
  const start = output.indexOf(SENTINEL_BEGIN);
  const end = output.indexOf(SENTINEL_END, start);
  if (start === -1 || end === -1) return null;

  const json = output.slice(start + SENTINEL_BEGIN.length, end);
  let parsed: { exit: string };
  try {
    parsed = JSON.parse(json) as { exit: string };
  } catch {
    return null;
  }

  // Extract cwd from the dedicated prefix line that follows the sentinel.
  const pwdLineStart = output.indexOf(SENTINEL_PWD_PREFIX, end);
  const pwdLineEnd = pwdLineStart === -1 ? -1 : output.indexOf('\n', pwdLineStart);
  const cwd =
    pwdLineStart === -1
      ? ''
      : output
          .slice(
            pwdLineStart + SENTINEL_PWD_PREFIX.length,
            pwdLineEnd === -1 ? undefined : pwdLineEnd,
          )
          .trim();

  return { exit: parsed.exit, cwd };
}

export class BashShellSession {
  private proc: child_process.ChildProcessWithoutNullStreams | null = null;
  private cwd: string;
  private driver: SandboxDriver;
  private stdoutBuf = '';
  private stderrBuf = '';
  private waiters: Array<() => void> = [];
  private closed = false;
  private interrupting = false;

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

    const result = { stdout: this.stdoutBuf, stderr: this.stderrBuf };
    this.stdoutBuf = '';
    this.stderrBuf = '';
    this.interrupting = false;

    return result;
  }

  async exec(command: string, workspaceRoot: string = '/workspace'): Promise<SessionExecResult> {
    if (!this.proc || this.closed) {
      throw new Error('[bash/session] Shell session has been disposed');
    }
    if (this.interrupting) {
      throw new Error('[bash/session] Cannot exec while previous command is being interrupted');
    }

    const startMs = Date.now();

    const { stdout, stderr } = await this.writeAndWaitForSentinel(buildExecScript(command));

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

  /**
   * Sends SIGINT to the shell process to abort the currently running command.
   * Called by exec.ts when the timeout fires before the command finishes.
   * The session remains usable for subsequent commands.
   */
  interrupt(): void {
    if (this.proc && !this.closed) {
      this.interrupting = true;
      this.proc.kill('SIGINT');
    }
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
