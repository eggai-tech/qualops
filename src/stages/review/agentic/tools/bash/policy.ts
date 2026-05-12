import {
  tokenise,
  toAnalysisCopy,
  flagValues,
  firstPositional,
  type ParsedCommand,
} from './parser.js';
import { resolveWithinCwd } from '../../../../../shared/utils/security.js';

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

  // Use resolveWithinCwd for each allowed root — it normalizes .. segments and
  // checks containment in one call, eliminating traversal bypasses like
  // /workspace/../etc/passwd that would fool a naive startsWith check.
  const allowed = workspaceRoot
    ? [workspaceRoot, workspaceRoot + '/pr', workspaceRoot + '/base']
    : DEFAULT_WORKSPACE_ROOTS;

  return allowed.some((root) => resolveWithinCwd(root, target) !== null);
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
  // Use firstPositional so flags before the subcommand (e.g. npm --loglevel=silent install)
  // are skipped and the actual subcommand is found regardless of position.
  const sub = firstPositional(args);
  if (!sub) {
    return deny('package-manager-interactive', `${binaryBase} without subcommand is not allowed`);
  }
  if (DENIED_NPM_SUBCOMMANDS.has(sub)) {
    return deny('npm-install', `${binaryBase} ${sub} is not allowed — no network package installs`);
  }
  return null;
}

function checkGitCommand(args: string[]): PolicyOutcome {
  // Check every -c occurrence — using flagValues handles space-separated (-c key=val),
  // concatenated (-ckey=val), and equals-form (-c=key=val) in a single pass.
  // The previous args.find() only inspected the first match, allowing multiple
  // -c flags where only the second contained the dangerous pattern.
  for (const kvPair of flagValues(args, '-c')) {
    for (const pattern of DENIED_GIT_CONFIG_PATTERNS) {
      if (pattern.test(kvPair)) {
        return deny(
          'git-config-injection',
          `git -c ${kvPair} is not allowed — potential hook/config injection`,
        );
      }
    }
  }

  // firstPositional correctly skips all flags regardless of position.
  // The previous args.find(!startsWith('-') && !includes('=')) was fragile:
  // !includes('=') was meant to skip KEY=VAL env assignments, but those are
  // already stripped by parseLogicalCommand before args is built.
  const subCmd = firstPositional(args);
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

  if (subCmd === 'config') {
    // Only allow read-only config operations. Write operations (no --get/--list flag)
    // could set core.hooksPath or other dangerous values.
    const configArgs = args.slice(args.indexOf('config') + 1);
    const hasReadFlag = configArgs.some((a) =>
      ['--get', '--get-all', '--get-regexp', '--list', '-l', '--name-only'].includes(a),
    );
    if (!hasReadFlag) {
      return deny(
        'git-config-write',
        'git config without a read-only flag (--get, --list, etc.) is not allowed',
      );
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
    // Use flagValues so equals-form (--command=SELECT, --file=/path) is recognised.
    // args.includes('--command') would miss '--command=SELECT' since that is a single token.
    const hasCmd = flagValues(args, '-c', '--command').length > 0;
    const hasFile = flagValues(args, '-f', '--file').length > 0;
    if (!hasCmd && !hasFile) {
      return deny('interactive-repl', 'psql without -c or -f launches an interactive shell');
    }
    return allow;
  }

  if (binaryBase === 'mysql') {
    // Same fix: --execute=SELECT would be missed by args.includes('--execute').
    const hasE = flagValues(args, '-e', '--execute').length > 0;
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

  // Match both `-c script` (space-separated) and `-cscript` (concatenated).
  // bash -c'cmd' is valid shell syntax and would bypass an indexOf('-c') check.
  const dashCArg = args.find((a) => a === '-c' || a.startsWith('-c'));
  if (dashCArg !== undefined) {
    if (dashCArg !== '-c') {
      // Concatenated form (e.g. bash -c'cmd' or bash -c"cmd"): deny outright because
      // the script content spans tokens in a way our whitespace tokenizer cannot reliably
      // inspect. The safe path is to require the space-separated form.
      return deny(
        'shell-expansion-in-literal',
        `${binaryBase} -c with concatenated script (no space after -c) is not allowed`,
      );
    }
    // Space-separated form: inspect the script for variable/subshell expansion.
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

  if (['cat', 'head', 'less', 'more', 'cp', 'mv', 'tee', 'ln'].includes(binaryBase)) {
    const pathArgs = args.filter((a) => !a.startsWith('-'));
    for (const p of pathArgs) {
      // For relative paths, resolve against workspace root before checking.
      // resolveWithinCwd normalizes .. segments and returns null if the resolved
      // path escapes the root — deny in that case.
      // For absolute paths, isAllowedCdTarget handles normalization via resolveWithinCwd.
      if (!p.startsWith('/')) {
        const base = workspaceRoot ?? DEFAULT_WORKSPACE_ROOTS[0]!;
        if (resolveWithinCwd(base, p) === null) {
          return deny(
            'path-outside-workspace',
            `${binaryBase} with path outside workspace is not allowed: ${p}`,
          );
        }
        continue;
      }
      if (!isAllowedCdTarget(p, workspaceRoot)) {
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
