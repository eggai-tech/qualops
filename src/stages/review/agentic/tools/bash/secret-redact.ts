import { SENSITIVE_VALUE_PATTERN_SOURCE, REDACTED } from '../../../../../shared/utils/security.js';

// Extended patterns beyond the base SENSITIVE_VALUE_PATTERN_SOURCE.
// Sources: gitleaks rule set, common CI token shapes.
const EXTENDED_PATTERNS: readonly string[] = [
  // Anthropic API keys
  'sk-ant-[A-Za-z0-9_-]{10,}',

  // Slack tokens
  'xox[baprs]-[A-Za-z0-9-]{10,}',

  // GCP service account JSON (partial — the key field)
  '"private_key"\\s*:\\s*"-----BEGIN [A-Z ]+-----[^"]{20,}"',

  // npm tokens
  'npm_[A-Za-z0-9]{36}',

  // Docker Hub tokens
  'dckr_pat_[A-Za-z0-9_-]{27,}',

  // HashiCorp Vault tokens
  's\\.hvs\\.[A-Za-z0-9]{24,}',
  'hvs\\.[A-Za-z0-9]{24,}',

  // Stripe keys
  'sk_live_[A-Za-z0-9]{24,}',
  'rk_live_[A-Za-z0-9]{24,}',
  'pk_live_[A-Za-z0-9]{24,}',

  // SendGrid
  'SG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}',

  // Twilio
  'SK[A-Za-z0-9]{32}',
  'AC[A-Za-z0-9]{32}',

  // Generic high-entropy base64 segments that look like tokens
  // (32+ base64 chars after an = sign, commonly seen in .env files)
  '(?<==)[A-Za-z0-9+/]{32,}={0,2}(?=\\s|$|")',
];

const EXTENDED_PATTERN_SOURCE = EXTENDED_PATTERNS.join('|');
const COMBINED_PATTERN_SOURCE = `${SENSITIVE_VALUE_PATTERN_SOURCE}|${EXTENDED_PATTERN_SOURCE}`;

export function redactOutput(text: string, knownTokens: string[] = []): string {
  if (!text) return text;

  let redacted = text.replace(new RegExp(COMBINED_PATTERN_SOURCE, 'g'), REDACTED);

  for (const token of knownTokens) {
    if (token && token.length >= 8) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // nosemgrep: detect-non-literal-regexp -- token escaped via metacharacter replace before RegExp
      redacted = redacted.replace(new RegExp(escaped, 'g'), REDACTED);
    }
  }

  return redacted;
}
