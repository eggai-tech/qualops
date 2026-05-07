import { resolve } from 'node:path';

import { tokenise, toAnalysisCopy, type ParsedCommand } from './parser.js';

export interface PolicyResult {
  deny: false;
}

export interface PolicyDeny {
  deny: true;
  rule: string;
  reason: string;
}

export type PolicyOutcome = PolicyResult | PolicyDeny;

export interface PolicyConfig {
  /** Absolute path that all cd targets must stay under. Defaults to /workspace. */
  workspaceRoot?: string;
  /** Extra binary names to add to the hard-deny list. */
  extraDeniedBinaries?: string[];
  /** Extra regex patterns (applied to analysis copy) to deny. */
  extraDenyPatterns?: string[];
}

function deny(rule: string, reason: string): PolicyDeny {
  return { deny: true, rule, reason };
}

const allow: PolicyResult = { deny: false };

const HARD_DENY_BINARIES: ReadonlySet<string> = new Set([
  // Privilege escalation
  'sudo',
  'su',
  'doas',
  'pkexec',
  'runuser',
  'nsenter',
  'unshare',
  'chroot',
  'capsh',
  'newuidmap',
  'newgidmap',

  // Network tools that can exfiltrate data
  'curl',
  'wget',
  'nc',
  'netcat',
  'ncat',
  'socat',
  'telnet',
  'ssh',
  'scp',
  'sftp',
  'rsync',
  'ftp',
  'tftp',
  'nmap',
  'masscan',
  'zmap',

  // Package managers that can execute remote code
  'apt',
  'apt-get',
  'apt-cache',
  'dpkg',
  'rpm',
  'yum',
  'dnf',
  'pacman',
  'brew',
  'snap',
  'flatpak',
  'pip',
  'pip3',
  'pipx',
  'gem',
  'cargo',
  'go',
  'composer',
  'mvn',
  'gradle',

  // Destructive filesystem ops
  'rm',
  'rmdir',
  'shred',
  'wipe',
  'srm',

  // Mount / device
  'mount',
  'umount',
  'losetup',
  'mkfs',
  'fdisk',
  'parted',
  'blkid',
  'lsblk',

  // Process / signal
  'kill',
  'killall',
  'pkill',
  'reboot',
  'shutdown',
  'halt',
  'poweroff',
  'init',
  'systemctl',
  'service',
  'launchctl',

  // Interactive tools (must not block the persistent shell)
  'vim',
  'vi',
  'nano',
  'emacs',
  'pico',
  'ed',
  'less',
  'more',
  'top',
  'htop',
  'btop',
  'atop',
  'watch',
  'tail', // tail -f is interactive; `tail -n 20 file` is checked below
  'man',
  'tmux',
  'screen',
  'byobu',

  // Crypto / wallet tools
  'gpg',
  'gpg2',
  'pgp',
  'openssl', // blocked; use node crypto instead
  'keychain',
  'ssh-agent',
  'ssh-add',
  'ssh-keygen',
  'pass',
  'gopass',
  'vault',

  // Container / VM escapes
  'docker',
  'podman',
  'nerdctl',
  'crictl',
  'kubectl',
  'helm',
  'kind',
  'k3s',
  'virsh',
  'qemu',
  'kvm',
  'cgroups',

  // Compiler / build tools that network (bare invocations)
  'make',
  'cmake',

  // env / exec wrappers that could bypass policy
  'env', // use direct invocation instead
  'exec',
  'eval',

  // Background/session escape (§3.5)
  'setsid',

  // Misc high-risk
  'crontab',
  'at',
  'batch',
  'iptables',
  'ip6tables',
  'nftables',
  'ufw',
  'firewalld',
  'strace',
  'ltrace',
  'dtrace',
  'perf',
  'gdb',
  'lldb',
  'xxd',
  'od', // can be used to exfiltrate binary secrets
  'base64', // can encode/decode secrets — blocked at binary level
  'dd',
  'tee', // can silently copy output to a file
]);

const DENIED_NPM_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'install',
  'i',
  'ci',
  'add',
  'publish',
  'pack',
  'deprecate',
  'unpublish',
  'audit', // can make network calls
  'fund',
  'set', // can modify .npmrc with token
  'login',
  'adduser',
  'logout',
  'link',
  'unlink',
  'run',
  'start',
  'stop',
  'restart',
  'test', // can execute arbitrary scripts
  'exec',
  'x',
  'update',
  'up',
  'upgrade',
]);

const ALLOWED_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'log',
  'show',
  'diff',
  'status',
  'blame',
  'shortlog',
  'ls-files',
  'ls-tree',
  'rev-parse',
  'rev-list',
  'cat-file',
  'describe',
  'tag',
  '--no-pager',
  'branch',
  'stash',
  'grep',
  'archive', // archive is read-only
  'format-patch', // read-only output
  'symbolic-ref',
  'name-rev',
  'for-each-ref',
  'check-ignore',
  'check-attr',
  'remote', // read-only subcommands checked further below
  'config', // checked further below for dangerous patterns
]);

const DENIED_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'push',
  'fetch',
  'pull',
  'clone',
  'submodule',
  'filter-branch',
  'replace',
  'fast-import',
  'gc',
  'prune',
  'repack',
  'apply',
  'am',
  'cherry-pick',
  'rebase',
  'merge',
  'reset',
  'commit',
  'add',
  'rm',
  'mv',
  'restore',
  'checkout',
  'switch',
  'init',
  'bisect',
  'worktree',
  'bundle',
  'clean',
  'update-ref',
  'update-index',
  'write-tree',
  'commit-tree',
  'read-tree',
  'hash-object',
  'update-server-info',
  'notes',
  'instaweb',
  'fsck', // can traverse loose objects
  'rerere',
  'credential',
  'send-email',
  'request-pull',
  'p4',
  'svn',
  'cvsserver',
]);

const DENIED_GIT_CONFIG_PATTERNS: readonly RegExp[] = [
  /core\.fsmonitor/i,
  /core\.hooksPath/i,
  /core\.gitProxy/i,
  /core\.editor/i,
  /sequence\.editor/i,
  /gpg\.program/i,
  /credential\.helper/i,
  /protocol\./i,
  /http\.proxy/i,
  /http\.cookieFile/i,
  /transfer\.fsckObjects/i,
  /uploadPack\./i,
  /receivepack\./i,
];

function isPythonInteractive(args: string[]): boolean {
  // No args or only flags that launch REPL
  const filtered = args.filter((a) => !a.startsWith('-'));
  if (filtered.length === 0) {
    // Check for -c, -m, or script file
    const flags = args.filter((a) => a.startsWith('-'));
    const hasC = flags.includes('-c');
    const hasM = flags.includes('-m');
    if (!hasC && !hasM) return true; // bare python / python -i
  }
  return false;
}

function isNodeInteractive(args: string[]): boolean {
  // node with no file arg and no -e launches REPL
  const hasFile = args.some((a) => !a.startsWith('-'));
  const hasE = args.includes('-e') || args.includes('--eval');
  return !hasFile && !hasE;
}

const DEFAULT_WORKSPACE_ROOTS = ['/workspace/pr', '/workspace/base', '/workspace'];

function isAllowedCdTarget(target: string, workspaceRoot?: string): boolean {
  // Explicit escape patterns — deny regardless of type
  if (target === '~' || target.startsWith('~/') || target === '-') return false;

  // Relative paths are allowed (stay within cwd)
  if (!target.startsWith('/')) return true;

  const allowed = workspaceRoot
    ? [workspaceRoot, workspaceRoot + '/pr', workspaceRoot + '/base']
    : DEFAULT_WORKSPACE_ROOTS;

  for (const root of allowed) {
    if (target === root || target.startsWith(root + '/')) return true;
  }
  return false;
}

function checkEnvHijacking(analysis: string): PolicyOutcome | null {
  if (
    /\bLD_PRELOAD\s*=/.test(analysis) ||
    /\bLD_LIBRARY_PATH\s*=/.test(analysis) ||
    /\bDYLD_INSERT_LIBRARIES\s*=/.test(analysis) ||
    /\bDYLD_LIBRARY_PATH\s*=/.test(analysis)
  ) {
    return deny('ld-preload', 'LD_PRELOAD / LD_LIBRARY_PATH / DYLD env hijacking is not allowed');
  }
  return null;
}

function checkHardDenyBinary(binaryBase: string, args: string[]): PolicyOutcome | null {
  if (!HARD_DENY_BINARIES.has(binaryBase)) return null;
  // Special carve-out: `tail -n N file` (non-interactive, non-follow) is OK
  if (binaryBase === 'tail') {
    const hasFollow = args.some((a) => a === '-f' || a === '--follow' || /^-[^-]*f/.test(a));
    if (!hasFollow) return allow;
  }
  return deny('denied-binary', `${binaryBase} is not allowed in the bash tool`);
}

function checkPackageManager(binaryBase: string, args: string[]): PolicyOutcome | null {
  if (!['npm', 'npx', 'yarn', 'pnpm', 'bun'].includes(binaryBase)) return null;
  const sub = args[0];
  if (!sub) {
    return deny('package-manager-interactive', `${binaryBase} without subcommand is not allowed`);
  }
  if (DENIED_NPM_SUBCOMMANDS.has(sub)) {
    return deny('npm-install', `${binaryBase} ${sub} is not allowed — no network package installs`);
  }
  return null;
}

function checkGitCommand(args: string[]): PolicyOutcome {
  const dashCIdx = args.indexOf('-c');
  if (dashCIdx !== -1) {
    const kvPair = args[dashCIdx + 1] ?? '';
    for (const pattern of DENIED_GIT_CONFIG_PATTERNS) {
      if (pattern.test(kvPair)) {
        return deny(
          'git-config-injection',
          `git -c ${kvPair} is not allowed — potential hook/config injection`,
        );
      }
    }
  }

  const subCmd = args.find((a) => !a.startsWith('-') && !a.includes('='));
  if (!subCmd) return allow; // git with no subcommand is harmless (shows usage)

  if (DENIED_GIT_SUBCOMMANDS.has(subCmd)) {
    return deny('git-denied-subcommand', `git ${subCmd} is not allowed`);
  }
  if (!ALLOWED_GIT_SUBCOMMANDS.has(subCmd)) {
    // Unknown subcommand — deny by default (allowlist approach)
    return deny('git-unknown-subcommand', `git ${subCmd} is not in the allowed subcommand list`);
  }

  if (subCmd === 'remote') {
    const remoteArgs = args.slice(args.indexOf('remote') + 1);
    const remoteSubCmd = remoteArgs.find((a) => !a.startsWith('-'));
    if (remoteSubCmd && !['get-url', 'show', '-v', '--verbose'].includes(remoteSubCmd)) {
      return deny('git-remote-write', `git remote ${remoteSubCmd} is not allowed`);
    }
  }

  return allow;
}

function checkInteractiveRepl(
  binaryBase: string,
  args: string[],
  raw: string,
): PolicyOutcome | null {
  if (['python', 'python3', 'python3.10', 'python3.11', 'python3.12'].includes(binaryBase)) {
    if (isPythonInteractive(args)) {
      return deny(
        'interactive-repl',
        `${binaryBase} without args or script launches an interactive REPL`,
      );
    }
    return allow;
  }

  if (binaryBase === 'node') {
    if (isNodeInteractive(args)) {
      return deny('interactive-repl', 'node without file/eval arg launches an interactive REPL');
    }
    return allow;
  }

  if (binaryBase === 'psql') {
    const hasCmd = args.includes('-c') || args.includes('--command');
    const hasFile = args.includes('-f') || args.includes('--file');
    if (!hasCmd && !hasFile) {
      return deny('interactive-repl', 'psql without -c or -f launches an interactive shell');
    }
    return allow;
  }

  if (binaryBase === 'mysql') {
    const hasE = args.includes('-e') || args.includes('--execute');
    if (!hasE) {
      return deny('interactive-repl', 'mysql without -e launches an interactive shell');
    }
    return allow;
  }

  if (binaryBase === 'sqlite3') {
    // Check raw command: a SQL keyword anywhere after the binary indicates a one-shot query.
    // We do NOT use args[] here because the parser splits on whitespace and strips quotes,
    // so '"SELECT * FROM users"' becomes ['"SELECT', '*', 'FROM', ...].
    const afterBinary = raw.replace(/^[^\s]+\s*/, '');
    const hasQuery =
      /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|PRAGMA|ATTACH)\b/i.test(afterBinary) ||
      /;/.test(afterBinary);
    if (!hasQuery) {
      return deny('interactive-repl', 'sqlite3 without a SQL query launches an interactive shell');
    }
    return allow;
  }

  if (['mongosh', 'ipython', 'deno'].includes(binaryBase)) {
    return deny(
      'interactive-repl',
      `${binaryBase} is not allowed — use python3, node, or sqlite3 equivalents`,
    );
  }

  return null;
}

function checkShellInvocation(
  binaryBase: string,
  args: string[],
  raw: string,
): PolicyOutcome | null {
  if (!['bash', 'sh', 'zsh'].includes(binaryBase)) return null;

  const dashCIdx = args.indexOf('-c');
  if (dashCIdx !== -1) {
    const afterDashC = raw.replace(/^.*?\s-c\s+/, '');
    // Strip single-quoted substrings (no expansion), then check remainder for $.
    // We intentionally keep double-quoted content because $VAR expands inside "...".
    const withoutSQ = afterDashC.replace(/'[^']*'/g, "'__SQ__'");
    if (/\$[A-Za-z_{(0-9#@*?!]/.test(withoutSQ) || /`/.test(withoutSQ)) {
      return deny(
        'shell-expansion-in-literal',
        `${binaryBase} -c with variable/subshell expansion in literal is not allowed`,
      );
    }
    return allow;
  }

  if (args.length === 0) {
    return deny('interactive-repl', `${binaryBase} without args launches an interactive shell`);
  }
  return allow;
}

function checkPathAccess(
  binaryBase: string,
  args: string[],
  workspaceRoot?: string,
): PolicyOutcome | null {
  if (binaryBase === 'cd') {
    const target = args[0];
    if (target && !isAllowedCdTarget(target, workspaceRoot)) {
      return deny('cd-outside-workspace', `cd to ${target} is outside the allowed workspace`);
    }
    return allow;
  }

  if (['cat', 'head', 'less', 'more', 'cp', 'mv'].includes(binaryBase)) {
    const pathArgs = args.filter((a) => !a.startsWith('-'));
    for (const p of pathArgs) {
      // Resolve relative paths against workspaceRoot so ../../etc/passwd is caught.
      // Only check when workspaceRoot is known; without it we cannot resolve safely.
      const resolved = p.startsWith('/') ? p : workspaceRoot ? resolve(workspaceRoot, p) : null;
      if (resolved !== null && !isAllowedCdTarget(resolved, workspaceRoot)) {
        return deny(
          'path-outside-workspace',
          `${binaryBase} with path outside workspace is not allowed: ${p}`,
        );
      }
    }
  }

  return null;
}

function checkSingleCommand(cmd: ParsedCommand, config: PolicyConfig): PolicyOutcome {
  const { raw, binary, args, hasBackground, hasControlChars } = cmd;

  if (!binary) return allow;
  if (hasControlChars) return deny('control-chars', 'Command contains NUL or embedded newline');
  if (hasBackground)
    return deny('background', 'Trailing & is not allowed — use synchronous commands only');

  const analysis = toAnalysisCopy(raw);
  const binaryBase = binary.replace(/^.*\//, '');

  if (binaryBase === 'nohup' || binaryBase === 'disown') {
    return deny('background', `${binaryBase} is not allowed — no background processes`);
  }

  let result: PolicyOutcome | null;

  if ((result = checkEnvHijacking(analysis))) return result;
  if ((result = checkHardDenyBinary(binaryBase, args))) return result;
  if (config.extraDeniedBinaries?.includes(binaryBase)) {
    return deny('extra-denied-binary', `${binaryBase} is not allowed per config`);
  }
  if ((result = checkPackageManager(binaryBase, args))) return result;
  if (binaryBase === 'git') return checkGitCommand(args);
  if ((result = checkInteractiveRepl(binaryBase, args, raw))) return result;
  if ((result = checkShellInvocation(binaryBase, args, raw))) return result;
  if ((result = checkPathAccess(binaryBase, args, config.workspaceRoot))) return result;

  if (config.extraDenyPatterns) {
    for (const pattern of config.extraDenyPatterns) {
      if (new RegExp(pattern).test(analysis)) {
        return deny('extra-deny-pattern', `Command matched extra deny pattern: ${pattern}`);
      }
    }
  }

  return allow;
}

function checkStructural(cmd: string): PolicyOutcome | null {
  const analysis = toAnalysisCopy(cmd);

  if (/(?:^|\s)>\s*\//.test(analysis)) {
    return deny('redirection', 'Output redirection to absolute path is not allowed');
  }
  if (/(?:^|\s)>>\s*\//.test(analysis)) {
    return deny('redirection', 'Output append-redirection to absolute path is not allowed');
  }
  if (/(?:^|\s)<\(/.test(analysis)) {
    // Process substitution — allowed; do not block
  }

  if (/\x00/.test(cmd)) {
    return deny('control-chars', 'Command contains NUL byte');
  }

  return null;
}

export function evaluatePolicy(command: string, config: PolicyConfig = {}): PolicyOutcome {
  if (!command || command.trim() === '') {
    return deny('empty-command', 'Empty command is not allowed');
  }

  const structural = checkStructural(command);
  if (structural) return structural;

  const tokenised = tokenise(command);
  if (tokenised.parseError) {
    return deny('parse-error', tokenised.parseErrorMessage ?? 'Failed to parse command');
  }

  for (const cmd of tokenised.commands) {
    const result = checkSingleCommand(cmd, config);
    if (result.deny) return result;
  }

  return allow;
}
