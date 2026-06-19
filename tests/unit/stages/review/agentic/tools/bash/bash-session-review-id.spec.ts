// Tests for QUALOPS_REVIEW_ID validation in BashSession.start().
// We mock BashShellSession and detectSandboxDriver so the test doesn't spawn
// a real shell or require a sandbox driver to be available.

jest.mock('@/stages/review/agentic/tools/bash/session-impl', () => ({
  BashShellSession: {
    create: jest.fn().mockResolvedValue({ isAlive: true, dispose: jest.fn() }),
  },
}));
jest.mock('@/stages/review/agentic/tools/bash/modes/detect', () => ({
  detectSandboxDriver: jest.fn().mockReturnValue({ name: 'none' }),
}));
jest.mock('@/shared/utils/logger');

import { logger } from '@/shared/utils/logger';
import { BashSession } from '@/stages/review/agentic/tools/bash/session';

const mockLogger = logger as jest.Mocked<typeof logger>;

// Capture the reviewId passed to logger.info('[bash/session] BashSession started', ...)
function capturedReviewId(): string | undefined {
  const call = mockLogger.info.mock.calls.find((c) => String(c[0]).includes('BashSession started'));
  return (call?.[1] as { reviewId?: string } | undefined)?.reviewId;
}

describe('BashSession.start — QUALOPS_REVIEW_ID', () => {
  const originalEnv = process.env['QUALOPS_REVIEW_ID'];

  afterEach(async () => {
    if (originalEnv === undefined) {
      delete process.env['QUALOPS_REVIEW_ID'];
    } else {
      process.env['QUALOPS_REVIEW_ID'] = originalEnv;
    }
    jest.clearAllMocks();
  });

  it('uses QUALOPS_REVIEW_ID when it contains only safe characters', async () => {
    process.env['QUALOPS_REVIEW_ID'] = 'pr-123_abc-XYZ';
    const session = await BashSession.start({ mode: 'none' });
    expect(capturedReviewId()).toBe('pr-123_abc-XYZ');
    await session.dispose();
  });

  it('falls back to a UUID when QUALOPS_REVIEW_ID contains path traversal chars', async () => {
    process.env['QUALOPS_REVIEW_ID'] = '../evil/path';
    const session = await BashSession.start({ mode: 'none' });
    const id = capturedReviewId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(id).not.toBe('../evil/path');
    await session.dispose();
  });

  it('falls back to a UUID when QUALOPS_REVIEW_ID is absent', async () => {
    delete process.env['QUALOPS_REVIEW_ID'];
    const session = await BashSession.start({ mode: 'none' });
    expect(capturedReviewId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    await session.dispose();
  });

  it('falls back to a UUID when QUALOPS_REVIEW_ID contains shell metacharacters', async () => {
    process.env['QUALOPS_REVIEW_ID'] = 'id; rm -rf /';
    const session = await BashSession.start({ mode: 'none' });
    const id = capturedReviewId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    await session.dispose();
  });
});
