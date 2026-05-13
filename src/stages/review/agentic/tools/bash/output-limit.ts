/**
 * Output truncation with tail-keep strategy.
 *
 * If output exceeds 64 KiB or 1500 lines, the inline copy is truncated
 * to the last 1500 lines / 64 KiB (whichever is smaller), with a notice
 * prepended. The full output is spilled to a file for audit.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const MAX_BYTES = 64 * 1024; // 64 KiB
const MAX_LINES = 1500;

export interface TruncateResult {
  content: string;
  truncated: boolean;
  fullPath?: string;
}

function spillToFile(
  content: string,
  reviewId: string,
  callId: string,
  stream: 'stdout' | 'stderr',
): string {
  const dir = path.join(process.env['SANDBOX_TMP'] ?? os.tmpdir(), 'tool-output', reviewId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = path.join(dir, `${callId}.${stream}`);
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
  return filePath;
}

/**
 * Truncates `content` to the tail (last lines/bytes) and optionally spills
 * the full content to a file.
 *
 * Returns the (possibly truncated) content, whether truncation occurred,
 * and the path to the spilled full content if applicable.
 */
export function truncateOutput(
  content: string,
  reviewId: string,
  callId: string,
  stream: 'stdout' | 'stderr',
): TruncateResult {
  const lines = content.split('\n');
  const byteLength = Buffer.byteLength(content, 'utf8');

  if (lines.length <= MAX_LINES && byteLength <= MAX_BYTES) {
    return { content, truncated: false };
  }

  // Spill full output to file before truncating
  const fullPath = spillToFile(content, reviewId, callId, stream);

  // Take tail
  let tailLines = lines.slice(-MAX_LINES);
  let tailContent = tailLines.join('\n');

  // If still over MAX_BYTES, truncate by bytes from the end
  while (Buffer.byteLength(tailContent, 'utf8') > MAX_BYTES && tailLines.length > 1) {
    tailLines = tailLines.slice(1);
    tailContent = tailLines.join('\n');
  }

  const droppedLines = lines.length - tailLines.length;
  const notice =
    `[qualops/output-limit] Output truncated: showing last ${tailLines.length} of ${lines.length} lines ` +
    `(${droppedLines} lines dropped). Full output: ${fullPath}\n` +
    `────────────────────────────────────────────────────────────────\n`;

  return {
    content: notice + tailContent,
    truncated: true,
    fullPath,
  };
}
