import { config as dotenvConfig } from 'dotenv';

// Load .env before any module that reads process.env (e.g. envConfig singleton).
// This must happen in setupFilesAfterEnv, which runs before the spec is imported.
dotenvConfig();

// Per-test timeout for real-API calls. Long enough to absorb provider retries on
// transient 5xx/429s without parking the runner indefinitely.
jest.setTimeout(120_000);
