import { stripAnsi } from './ansi-strip.js';
import { getSemanticHint } from './exit-semantics.js';
import type { SandboxDriver } from './modes/interface.js';
import { truncateOutput } from './output-limit.js';
import type { BashInput, BashOutput, BashExitReason } from './schema.js';
import { redactOutput } from './secret-redact.js';
import type { BashShellSession, SessionExecResult } from './session-impl.js';
import { logger } from '../../../../../shared/utils/logger.js';

export interface ExecOptions {
  reviewId: string;
  callId: string;
  workspaceRoot?: string;
  knownTokens?: string[];
}

export async function execBashCommand(
  input: BashInput,
  session: BashShellSession,
  driver: SandboxDriver,
  opts: ExecOptions,
): Promise<BashOutput> {
  const timeoutMs = input.timeout_ms ?? 60000;
  const { reviewId, callId, workspaceRoot = '/workspace', knownTokens = [] } = opts;

  let result: SessionExecResult;
  let exitReason: BashExitReason = 'exited';
  const violations: string[] = [];

  logger.info(`[bash] → command: ${input.command.substring(0, 300)}`);

  const preResult = await driver.preCall(callId, input.command);
  violations.push(...preResult.violations);

  const timeoutHandle = setTimeout(() => {}, timeoutMs);

  try {
    const raceResult = await Promise.race([
      session.exec(input.command, workspaceRoot),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);

    clearTimeout(timeoutHandle);

    if (raceResult === null) {
      exitReason = 'timed_out';
      result = {
        stdout: '',
        stderr: `[qualops/exec] Command timed out after ${timeoutMs}ms`,
        exitCode: 124,
        durationMs: timeoutMs,
        cwdDrifted: false,
        cwdDriftNotice: '',
      };
    } else {
      result = raceResult;
    }
  } catch (err) {
    clearTimeout(timeoutHandle);
    logger.error('[bash/exec] Unexpected error during exec', { err, callId });
    result = {
      stdout: '',
      stderr: `[qualops/exec] Internal error: ${String(err)}`,
      exitCode: 1,
      durationMs: 0,
      cwdDrifted: false,
      cwdDriftNotice: '',
    };
  }

  const postResult = await driver.postCall(callId, input.command);
  violations.push(...postResult.violations);

  if (postResult.abortReview) {
    logger.warn('[bash/exec] Sandbox abort triggered', { callId, reason: postResult.abortReason });
    violations.push(`ABORT_REVIEW: ${postResult.abortReason}`);
  }

  let stderrWithDrift = result.stderr;
  if (result.cwdDrifted) {
    stderrWithDrift = (stderrWithDrift ? stderrWithDrift + '\n' : '') + result.cwdDriftNotice;
  }

  const strippedStdout = stripAnsi(result.stdout);
  const strippedStderr = stripAnsi(stderrWithDrift);

  const redactedStdout = redactOutput(strippedStdout, knownTokens);
  const redactedStderr = redactOutput(strippedStderr, knownTokens);

  const truncatedStdout = truncateOutput(redactedStdout, reviewId, callId, 'stdout');
  const truncatedStderr = truncateOutput(redactedStderr, reviewId, callId, 'stderr');

  const binary = input.command.trim().split(/\s+/)[0]?.replace(/^.*\//, '') ?? '';
  const semanticHint = getSemanticHint(binary, result.exitCode);

  const hint = semanticHint ? ` (${semanticHint})` : '';
  logger.info(`[bash] ← exit=${result.exitCode}${hint}, duration=${result.durationMs}ms`);
  if (truncatedStdout.content) {
    logger.info(`[bash] ← stdout: ${truncatedStdout.content.substring(0, 500)}`);
  }
  if (truncatedStderr.content) {
    logger.info(`[bash] ← stderr: ${truncatedStderr.content.substring(0, 200)}`);
  }

  return {
    stdout: truncatedStdout.content,
    stderr: truncatedStderr.content,
    exit_code: result.exitCode,
    exit_reason: exitReason,
    duration_ms: result.durationMs,
    stdout_truncated: truncatedStdout.truncated,
    stderr_truncated: truncatedStderr.truncated,
    stdout_full_path: truncatedStdout.fullPath,
    semantic_hint: semanticHint,
    sandbox_violations: violations,
  };
}
