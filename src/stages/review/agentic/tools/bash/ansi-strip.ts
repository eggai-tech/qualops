// CSI (Control Sequence Introducer) sequences: ESC [ ... final-byte
// OSC (Operating System Command) sequences: ESC ] ... ST (ESC \\ or BEL)
// Other ESC sequences: ESC + single char
const ANSI_PATTERN = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}
