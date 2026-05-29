// Per-test timeout for real-API calls. Long enough to absorb provider retries on
// transient 5xx/429s without parking the runner indefinitely.
jest.setTimeout(120_000);

// Deliberately does NOT inject fake API keys (unlike tests/setup/integration.setup.ts).
// The smoke harness must read whatever the real environment provides so that providers
// without credentials are skipped, and providers with credentials make real calls.
