import { getGlobalAIProvider } from './factory.ts';
import type { AIProvider, TokenStats } from './provider.ts';
import { getGlobalTokenStats, resetTokenStats } from './token-stats.ts';

jest.mock('./factory.ts');
jest.mock('../../shared/utils/logger.ts');

const mockGetGlobalAIProvider = getGlobalAIProvider as jest.MockedFunction<typeof getGlobalAIProvider>;

describe('token-stats', () => {
  let mockProvider: jest.Mocked<AIProvider>;
  let mockTokenStats: TokenStats;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTokenStats = {
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      totalTokens: 1500,
      invocationCount: 5,
      startTime: new Date('2024-01-01'),
      estimatedCost: 0.05,
    };

    mockProvider = {
      name: 'test-provider',
      initialize: jest.fn(),
      complete: jest.fn(),
      completeWithStructure: jest.fn(),
      invoke: jest.fn(),
      isAvailable: jest.fn(),
      getModelName: jest.fn(),
      getMaxTokens: jest.fn(),
      getTemperature: jest.fn().mockReturnValue(0),
      getTokenStats: jest.fn().mockReturnValue(mockTokenStats),
      resetTokenStats: jest.fn(),
    };
  });

  describe('getGlobalTokenStats', () => {
    it('should return token stats from global provider', () => {
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      const stats = getGlobalTokenStats();

      expect(mockGetGlobalAIProvider).toHaveBeenCalled();
      expect(mockProvider.getTokenStats).toHaveBeenCalled();
      expect(stats).toEqual(mockTokenStats);
    });

    it('should return stats with correct totalInputTokens', () => {
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      const stats = getGlobalTokenStats();

      expect(stats.totalInputTokens).toBe(1000);
    });

    it('should return stats with correct totalOutputTokens', () => {
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      const stats = getGlobalTokenStats();

      expect(stats.totalOutputTokens).toBe(500);
    });

    it('should return stats with correct totalTokens', () => {
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      const stats = getGlobalTokenStats();

      expect(stats.totalTokens).toBe(1500);
    });

    it('should return stats with correct invocationCount', () => {
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      const stats = getGlobalTokenStats();

      expect(stats.invocationCount).toBe(5);
    });

    it('should return stats with correct estimatedCost', () => {
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      const stats = getGlobalTokenStats();

      expect(stats.estimatedCost).toBe(0.05);
    });

    it('should return stats with correct startTime', () => {
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      const stats = getGlobalTokenStats();

      expect(stats.startTime).toEqual(new Date('2024-01-01'));
    });

    it('should return default stats when provider not initialized', () => {
      mockGetGlobalAIProvider.mockImplementation(() => {
        throw new Error('Global AI provider not initialized');
      });

      const stats = getGlobalTokenStats();

      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.invocationCount).toBe(0);
      expect(stats.estimatedCost).toBe(0);
      expect(stats.startTime).toBeInstanceOf(Date);
    });

    it('should return default stats when getTokenStats is undefined', () => {
      const providerWithoutStats = {
        ...mockProvider,
        getTokenStats: undefined,
      };
      mockGetGlobalAIProvider.mockReturnValue(providerWithoutStats as any);

      const stats = getGlobalTokenStats();

      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.invocationCount).toBe(0);
      expect(stats.estimatedCost).toBe(0);
    });

    it('should return default stats when getTokenStats returns undefined', () => {
      mockProvider.getTokenStats = jest.fn().mockReturnValue(undefined);
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      const stats = getGlobalTokenStats();

      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.invocationCount).toBe(0);
      expect(stats.estimatedCost).toBe(0);
    });

    it('should handle provider throwing error', () => {
      mockGetGlobalAIProvider.mockImplementation(() => {
        throw new Error('Provider error');
      });

      const stats = getGlobalTokenStats();

      expect(stats).toEqual({
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        invocationCount: 0,
        startTime: expect.any(Date),
        estimatedCost: 0,
      });
    });

    it('should return zero stats when provider has no invocations', () => {
      const emptyStats: TokenStats = {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        invocationCount: 0,
        startTime: new Date(),
        estimatedCost: 0,
      };
      mockProvider.getTokenStats = jest.fn().mockReturnValue(emptyStats);
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      const stats = getGlobalTokenStats();

      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.invocationCount).toBe(0);
      expect(stats.estimatedCost).toBe(0);
    });

    it('should return stats with high token counts', () => {
      const highStats: TokenStats = {
        totalInputTokens: 1000000,
        totalOutputTokens: 500000,
        totalTokens: 1500000,
        invocationCount: 100,
        startTime: new Date(),
        estimatedCost: 50.0,
      };
      mockProvider.getTokenStats = jest.fn().mockReturnValue(highStats);
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      const stats = getGlobalTokenStats();

      expect(stats.totalInputTokens).toBe(1000000);
      expect(stats.totalOutputTokens).toBe(500000);
      expect(stats.totalTokens).toBe(1500000);
      expect(stats.invocationCount).toBe(100);
      expect(stats.estimatedCost).toBe(50.0);
    });

    it('should return stats from provider each time called', () => {
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      const stats1 = getGlobalTokenStats();
      const stats2 = getGlobalTokenStats();

      expect(stats1.totalInputTokens).toBe(1000);
      expect(stats2.totalInputTokens).toBe(1000);
      expect(mockProvider.getTokenStats).toHaveBeenCalledTimes(2);
    });
  });

  describe('resetTokenStats', () => {
    it('should call resetTokenStats on global provider', () => {
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      resetTokenStats();

      expect(mockGetGlobalAIProvider).toHaveBeenCalled();
      expect(mockProvider.resetTokenStats).toHaveBeenCalled();
    });

    it('should not throw when provider not initialized', () => {
      mockGetGlobalAIProvider.mockImplementation(() => {
        throw new Error('Global AI provider not initialized');
      });

      expect(() => resetTokenStats()).not.toThrow();
    });

    it('should not throw when resetTokenStats is undefined', () => {
      const providerWithoutReset = {
        ...mockProvider,
        resetTokenStats: undefined,
      };
      mockGetGlobalAIProvider.mockReturnValue(providerWithoutReset as any);

      expect(() => resetTokenStats()).not.toThrow();
    });

    it('should handle provider throwing error silently', () => {
      mockGetGlobalAIProvider.mockImplementation(() => {
        throw new Error('Provider error');
      });

      expect(() => resetTokenStats()).not.toThrow();
    });

    it('should call resetTokenStats exactly once', () => {
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      resetTokenStats();

      expect(mockProvider.resetTokenStats).toHaveBeenCalledTimes(1);
    });

    it('should reset stats when called multiple times', () => {
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      resetTokenStats();
      resetTokenStats();
      resetTokenStats();

      expect(mockProvider.resetTokenStats).toHaveBeenCalledTimes(3);
    });

    it('should work after provider has been used', () => {
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      getGlobalTokenStats();
      resetTokenStats();

      expect(mockProvider.resetTokenStats).toHaveBeenCalled();
    });

    it('should not affect getGlobalTokenStats calls', () => {
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      getGlobalTokenStats();
      resetTokenStats();
      getGlobalTokenStats();

      expect(mockProvider.getTokenStats).toHaveBeenCalledTimes(2);
      expect(mockProvider.resetTokenStats).toHaveBeenCalledTimes(1);
    });
  });

  describe('integration scenarios', () => {
    it('should get stats, reset, and get stats again', () => {
      const initialStats: TokenStats = {
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalTokens: 1500,
        invocationCount: 5,
        startTime: new Date(),
        estimatedCost: 0.05,
      };

      const resetStats: TokenStats = {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        invocationCount: 0,
        startTime: new Date(),
        estimatedCost: 0,
      };

      mockProvider.getTokenStats = jest.fn().mockReturnValueOnce(initialStats).mockReturnValueOnce(resetStats);

      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      const stats1 = getGlobalTokenStats();
      expect(stats1.totalTokens).toBe(1500);

      resetTokenStats();

      const stats2 = getGlobalTokenStats();
      expect(stats2.totalTokens).toBe(0);
    });

    it('should handle multiple providers lifecycle', () => {
      const provider1Stats: TokenStats = {
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
        invocationCount: 1,
        startTime: new Date(),
        estimatedCost: 0.01,
      };

      const provider2Stats: TokenStats = {
        totalInputTokens: 200,
        totalOutputTokens: 100,
        totalTokens: 300,
        invocationCount: 2,
        startTime: new Date(),
        estimatedCost: 0.02,
      };

      mockProvider.getTokenStats = jest.fn().mockReturnValue(provider1Stats);
      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      const stats1 = getGlobalTokenStats();
      expect(stats1.totalTokens).toBe(150);

      const mockProvider2 = { ...mockProvider, getTokenStats: jest.fn().mockReturnValue(provider2Stats) };
      mockGetGlobalAIProvider.mockReturnValue(mockProvider2 as any);

      const stats2 = getGlobalTokenStats();
      expect(stats2.totalTokens).toBe(300);
    });

    it('should work with fresh provider after error', () => {
      mockGetGlobalAIProvider.mockImplementationOnce(() => {
        throw new Error('Provider not initialized');
      });

      const stats1 = getGlobalTokenStats();
      expect(stats1.totalTokens).toBe(0);

      mockGetGlobalAIProvider.mockReturnValue(mockProvider);

      const stats2 = getGlobalTokenStats();
      expect(stats2.totalTokens).toBe(1500);
    });
  });
});
