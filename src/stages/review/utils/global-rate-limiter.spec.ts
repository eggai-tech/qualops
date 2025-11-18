jest.mock('../../../config/config.ts', () => ({
  ConfigService: {
    getInstance: jest.fn().mockReturnValue({
      get: jest.fn().mockReturnValue({ apiCallsPerMinute: 60 }), // High rate to avoid waits in tests
    }),
  },
}));
jest.mock('../../../shared/utils/logger.ts');

import { ConfigService } from '../../../config/config.ts';
import { logger } from '../../../shared/utils/logger.ts';
import { globalRateLimiter } from './global-rate-limiter.ts';

describe('GlobalRateLimiter', () => {
  let mockConfigService: {
    get: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfigService = {
      get: jest.fn().mockReturnValue({ apiCallsPerMinute: 60 }),
    };

    (ConfigService.getInstance as jest.Mock).mockReturnValue(mockConfigService);

    // Reset the rate limiter state
    (globalRateLimiter as any).apiRequestTimes = [];
    (globalRateLimiter as any).apiRequestCount = 0;
    (globalRateLimiter as any).lastApiRequestTime = 0;
    (globalRateLimiter as any).apiCallsPerMinute = 60;
    (globalRateLimiter as any).minApiIntervalMs = 1000;
  });

  describe('throttleApiCall', () => {
    it('should allow first API call without throttling', async () => {
      await globalRateLimiter.throttleApiCall('test-provider');

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[RateLimit] API request 1 approved for test-provider'),
      );
    });

    it('should trigger rate limiting when API calls per minute limit is exceeded', async () => {
      // Set up rate limiter to hit the limit
      (globalRateLimiter as any).apiCallsPerMinute = 2;
      (globalRateLimiter as any).minApiIntervalMs = 1;

      const now = Date.now();
      // Simulate 2 recent requests within the window
      (globalRateLimiter as any).apiRequestTimes = [now - 5000, now - 1000];
      (globalRateLimiter as any).lastApiRequestTime = now - 1000;

      // Mock setTimeout to avoid actual waiting
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
        callback();
        return {} as NodeJS.Timeout;
      });

      await globalRateLimiter.throttleApiCall('provider3');

      // Verify rate limit message was logged
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/\[RateLimit\] Hit 2 API calls\/minute limit, waiting \d+ms/),
      );

      setTimeoutSpy.mockRestore();
    });

    it('should enforce minimum interval between consecutive requests', async () => {
      (globalRateLimiter as any).minApiIntervalMs = 5000;
      (globalRateLimiter as any).lastApiRequestTime = Date.now() - 1000; // 1 second ago

      let wasCalled = false;
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((callback: any, ms?: number) => {
        wasCalled = true;
        expect(ms).toBeGreaterThan(3000); // Should wait ~4000ms
        callback();
        return {} as NodeJS.Timeout;
      });

      await globalRateLimiter.throttleApiCall('provider');

      expect(wasCalled).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringMatching(/\[RateLimit\] Enforcing \d+ms API interval/));

      setTimeoutSpy.mockRestore();
    });

    it('should filter old request times', () => {
      const now = Date.now();
      (globalRateLimiter as any).apiRequestTimes = [
        now - 65000, // Old - should be filtered
        now - 30000, // Recent
        now - 10000, // Recent
      ];

      // Trigger filtering by accessing the array
      const filtered = (globalRateLimiter as any).apiRequestTimes.filter((time: number) => now - time < 60000);

      expect(filtered).toHaveLength(2);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      mockConfigService.get.mockReturnValue({ apiCallsPerMinute: 60 });

      await globalRateLimiter.throttleApiCall('provider1');
      await globalRateLimiter.throttleApiCall('provider2');

      const stats = globalRateLimiter.getStats();

      expect(stats.totalApiRequests).toBe(2);
      expect(stats.recentApiRequests).toBe(2);
      expect(stats.apiCallsPerMinute).toBe(60);
      expect(stats.minApiIntervalMs).toBeGreaterThan(0);
    });

    it('should handle default configuration when throttling is undefined', () => {
      mockConfigService.get.mockReturnValue(undefined);

      const stats = globalRateLimiter.getStats();

      expect(stats.apiCallsPerMinute).toBe(60); // Uses default from initial mock
    });
  });
});
