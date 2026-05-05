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

  test('sets QUALOPS_ENV_SCRUBBED=1', () => {
    const { env } = scrubEnv({});
    expect(env['QUALOPS_ENV_SCRUBBED']).toBe('1');
  });

  test('idempotent: QUALOPS_ENV_SCRUBBED=1 survives scrub', () => {
    const { env } = scrubEnv({ QUALOPS_ENV_SCRUBBED: '1' });
    expect(env['QUALOPS_ENV_SCRUBBED']).toBe('1');
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
