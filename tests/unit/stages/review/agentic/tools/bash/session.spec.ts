jest.mock('@/stages/review/agentic/tools/bash/session', () => {
  const mockStart = jest.fn();
  const BashSession = { start: mockStart };
  const startBashSession = async (
    config: object,
    logPrefix: string,
  ): Promise<{ session: object; dispose: () => Promise<void> }> => {
    const session = await BashSession.start(config);
    return {
      session,
      dispose: async () => {
        await (session as { dispose: () => Promise<void> })
          .dispose()
          .catch((err: unknown) =>
            require('@/shared/utils/logger').logger.warn(
              `[${logPrefix}] Error disposing BashSession`,
              { err },
            ),
          );
      },
    };
  };
  return { BashSession, startBashSession };
});
jest.mock('@/shared/utils/logger');

import { BashSession, startBashSession } from '@/stages/review/agentic/tools/bash/session';

const mockStart = (BashSession as { start: jest.Mock }).start;

describe('startBashSession', () => {
  beforeEach(() => {
    mockStart.mockReset();
  });

  it('returns session and dispose when start succeeds', async () => {
    const mockDisposeFn = jest.fn().mockResolvedValue(undefined);
    const mockSession = { dispose: mockDisposeFn };
    mockStart.mockResolvedValue(mockSession);

    const { session, dispose } = await startBashSession({}, 'Test');

    expect(session).toBe(mockSession);
    await dispose();
    expect(mockDisposeFn).toHaveBeenCalled();
  });

  it('throws when BashSession.start throws', async () => {
    mockStart.mockRejectedValue(new Error('spawn failed'));
    await expect(startBashSession({}, 'Test')).rejects.toThrow('spawn failed');
  });

  it('swallows dispose errors and logs a warning', async () => {
    const mockDisposeFn = jest.fn().mockRejectedValue(new Error('dispose failed'));
    mockStart.mockResolvedValue({ dispose: mockDisposeFn });

    const { dispose } = await startBashSession({}, 'Test');
    await expect(dispose()).resolves.toBeUndefined();
  });
});
