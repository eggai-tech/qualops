import * as crypto from 'crypto';

import { execBashCommand } from './exec.js';
import { detectSandboxDriver, type SandboxMode, type DetectOptions } from './modes/detect.js';
import type { SandboxDriver } from './modes/interface.js';
import { evaluatePolicy } from './policy.js';
import type { BashInput, BashOutput } from './schema.js';
import { BashShellSession } from './session-impl.js';
import { logger } from '../../../../../shared/utils/logger.js';
import { redactTokens } from '../../../../../shared/utils/security.js';

export interface BashConfig {
  /** Sandbox mode override. Default: auto-detect. */
  mode?: SandboxMode;
  /** Absolute path to the workspace root. Default: /workspace. */
  workspaceRoot?: string;
  /** Absolute path to the PR's .git/hooks dir. Used by CI driver. */
  prHooksDir?: string;
  /** Per-review maximum number of bash tool calls. Default: 200. */
  maxCallsPerReview?: number;
  /** Known secret tokens to redact from output. */
  knownTokens?: string[];
  /** Extra binary names to deny (added to policy hard-deny list). */
  extraDeniedBinaries?: string[];
}

const DEFAULT_MAX_CALLS = 200;

export class BashSession {
  private shell: BashShellSession | null = null;
  private driver: SandboxDriver;
  private config: Required<BashConfig>;
  private reviewId: string;
  private callCount = 0;

  private constructor(driver: SandboxDriver, config: Required<BashConfig>, reviewId: string) {
    this.driver = driver;
    this.config = config;
    this.reviewId = reviewId;
  }

  static async start(config: BashConfig = {}): Promise<BashSession> {
    const reviewId = process.env['QUALOPS_REVIEW_ID'] ?? crypto.randomUUID();
    const workspaceRoot = config.workspaceRoot ?? '/workspace';

    const resolvedConfig: Required<BashConfig> = {
      mode: config.mode ?? 'auto',
      workspaceRoot,
      prHooksDir: config.prHooksDir ?? '',
      maxCallsPerReview: config.maxCallsPerReview ?? DEFAULT_MAX_CALLS,
      knownTokens: config.knownTokens ?? [],
      extraDeniedBinaries: config.extraDeniedBinaries ?? [],
    };

    const detectOpts: DetectOptions = {
      mode: resolvedConfig.mode,
      workspaceRoot,
      prHooksDir: resolvedConfig.prHooksDir || undefined,
    };

    const driver = detectSandboxDriver(detectOpts);
    const session = new BashSession(driver, resolvedConfig, reviewId);

    session.shell = await BashShellSession.create(workspaceRoot, driver);

    logger.info('[bash/session] BashSession started', { reviewId, sandboxMode: driver.name });
    return session;
  }

  async exec(input: BashInput): Promise<BashOutput> {
    if (!this.shell || !this.shell.isAlive) {
      throw new Error('[bash/session] BashSession is not running');
    }

    if (this.callCount >= this.config.maxCallsPerReview) {
      return errorOutput(
        `Budget exhausted: maximum ${this.config.maxCallsPerReview} bash calls per review`,
        'killed_by_limit',
      );
    }

    const policyResult = evaluatePolicy(input.command, {
      workspaceRoot: this.config.workspaceRoot,
      extraDeniedBinaries: this.config.extraDeniedBinaries,
    });

    if (policyResult.deny) {
      logger.warn(
        `[bash/policy] denied (rule=${policyResult.rule}): ${redactTokens(input.command, this.config.knownTokens).substring(0, 200)} — ${policyResult.reason}`,
      );

      return {
        stdout: '',
        stderr: `[qualops/policy] Command denied: ${policyResult.reason} (rule: ${policyResult.rule})`,
        exit_code: 126,
        exit_reason: 'cancelled',
        duration_ms: 0,
        stdout_truncated: false,
        stderr_truncated: false,
        semantic_hint: undefined,
        sandbox_violations: [`policy:${policyResult.rule}`],
      };
    }

    this.callCount++;
    const callId = `${this.reviewId}-${this.callCount}`;

    return execBashCommand(input, this.shell, this.driver, {
      reviewId: this.reviewId,
      callId,
      workspaceRoot: this.config.workspaceRoot,
      knownTokens: this.config.knownTokens,
    });
  }

  async dispose(): Promise<void> {
    if (this.shell) {
      await this.shell.dispose();
      this.shell = null;
    }
    logger.info('[bash/session] BashSession disposed', { reviewId: this.reviewId });
  }

  get isAlive(): boolean {
    return this.shell?.isAlive ?? false;
  }
}

function errorOutput(message: string, reason: BashOutput['exit_reason']): BashOutput {
  return {
    stdout: '',
    stderr: message,
    exit_code: 1,
    exit_reason: reason,
    duration_ms: 0,
    stdout_truncated: false,
    stderr_truncated: false,
    semantic_hint: undefined,
    sandbox_violations: [],
  };
}

export async function startBashSession(
  config: BashConfig,
  logPrefix: string,
): Promise<{ session: BashSession; dispose: () => Promise<void> }> {
  const session = await BashSession.start(config);
  return {
    session,
    dispose: async () => {
      await session
        .dispose()
        .catch((err) => logger.warn(`[${logPrefix}] Error disposing BashSession`, { err }));
    },
  };
}
