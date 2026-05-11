/**
 * SandboxDriver interface — implemented by each sandbox mode.
 *
 * Drivers wrap the persistent shell process to add OS-level confinement.
 * The driver is responsible for:
 *   1. pre-call setup (rlimits, cwd validation, hook snapshot)
 *   2. post-call verification (hook snapshot comparison)
 *   3. reporting violations
 */

export interface SpawnOptions {
  /** Absolute path to use as the initial working directory. */
  cwd: string;
  /** Environment variables for the child process. */
  env: NodeJS.ProcessEnv;
  /** The command + args to spawn (first element is the executable). */
  argv: string[];
}

export interface PreCallResult {
  /** Any pre-call violations detected (e.g. suspicious hook state). */
  violations: string[];
}

export interface PostCallResult {
  /** Any post-call violations detected (e.g. hooks were tampered). */
  violations: string[];
  /** If true, the calling code should abort the current review session. */
  abortReview: boolean;
  abortReason?: string;
}

export interface SandboxDriver {
  readonly name: string;

  /**
   * Called once before the persistent shell is spawned.
   * Returns the modified SpawnOptions (may wrap argv with sandbox commands).
   */
  prepare(opts: SpawnOptions): Promise<SpawnOptions>;

  /**
   * Called before each bash tool call.
   */
  preCall(callId: string, command: string): Promise<PreCallResult>;

  /**
   * Called after each bash tool call completes.
   */
  postCall(callId: string, command: string): Promise<PostCallResult>;

  /**
   * Called when the session is disposed.
   */
  teardown(): Promise<void>;
}
