import { z } from 'zod';

export const BashPurpose = z.enum(['inspect', 'diff', 'search', 'lint', 'test', 'build']);
export type BashPurpose = z.infer<typeof BashPurpose>;

export const BashInput = z.object({
  command: z
    .string()
    .min(1)
    .max(8192)
    .describe(
      'The shell command to execute. Must be a single logical command or a pipeline. ' +
        'No interactive tools, no background processes, no network downloads.',
    ),
  description: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'Human-readable description of what this command does and why. ' +
        'Required — helps with audit logging and policy review.',
    ),
  purpose: BashPurpose.describe(
    'The primary purpose of this command: inspect (read files/metadata), ' +
      'diff (compare versions), search (find code patterns), lint (static analysis), ' +
      'test (run tests), build (compile/bundle).',
  ),
  timeout_ms: z
    .number()
    .int()
    .min(1000)
    .max(300000)
    .default(60000)
    .optional()
    .describe(
      'Maximum wall-clock time for this command in milliseconds. ' +
        'Default: 60000 (60 seconds). Maximum: 300000 (5 minutes).',
    ),
});

export type BashInput = z.infer<typeof BashInput>;

export const BashExitReason = z.enum([
  'exited',
  'timed_out',
  'killed_by_sandbox',
  'killed_by_limit',
  'cancelled',
]);
export type BashExitReason = z.infer<typeof BashExitReason>;

export interface BashOutput {
  /** Captured stdout, possibly truncated. */
  stdout: string;
  /** Captured stderr, possibly truncated. */
  stderr: string;
  /** Exit code of the command. */
  exit_code: number;
  /** How the command ended. */
  exit_reason: BashExitReason;
  /** Wall-clock execution time in milliseconds. */
  duration_ms: number;
  /** True if stdout was truncated due to output cap. */
  stdout_truncated: boolean;
  /** True if stderr was truncated due to output cap. */
  stderr_truncated: boolean;
  /**
   * Absolute path to the full (untreated) stdout on the runner filesystem.
   * Set only if stdout was truncated. Not accessible to the model — for audit only.
   */
  stdout_full_path?: string;
  /**
   * Human-readable explanation of what the exit code means for this command
   * (e.g. "No matches found" for grep exit 1).
   */
  semantic_hint?: string;
  /**
   * List of sandbox policy violations detected during this call.
   * Empty array means no violations.
   */
  sandbox_violations: string[];
}
