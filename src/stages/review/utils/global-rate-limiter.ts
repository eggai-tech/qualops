import { ConfigService } from '../../../config/config';
import { logger } from '../../../shared/utils/logger';

class GlobalRateLimiter {
  private lastApiRequestTime = 0;
  private apiRequestCount = 0;
  private readonly minApiIntervalMs: number;
  private apiRequestTimes: number[] = [];
  private readonly apiCallsPerMinute: number;

  constructor() {
    const config = ConfigService.getInstance();
    const throttling = config.get('throttling');
    this.apiCallsPerMinute = throttling?.apiCallsPerMinute || 2;
    this.minApiIntervalMs = Math.ceil(60000 / this.apiCallsPerMinute);
  }

  async throttleApiCall(providerName: string): Promise<void> {
    const now = Date.now();

    this.apiRequestTimes = this.apiRequestTimes.filter((time) => now - time < 60000);

    if (this.apiRequestTimes.length >= this.apiCallsPerMinute) {
      const oldestRequest = Math.min(...this.apiRequestTimes);
      const waitTime = 60000 - (now - oldestRequest) + 1000;

      if (waitTime > 0) {
        logger.debug(
          `[RateLimit] Hit ${this.apiCallsPerMinute} API calls/minute limit, waiting ${waitTime}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    const timeSinceLastRequest = now - this.lastApiRequestTime;
    if (timeSinceLastRequest < this.minApiIntervalMs) {
      const waitTime = this.minApiIntervalMs - timeSinceLastRequest;
      logger.debug(
        `[RateLimit] Enforcing ${this.minApiIntervalMs}ms API interval, waiting ${waitTime}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastApiRequestTime = Date.now();
    this.apiRequestTimes.push(this.lastApiRequestTime);
    this.apiRequestCount++;

    logger.debug(`[RateLimit] API request ${this.apiRequestCount} approved for ${providerName}`);
  }

  getStats() {
    return {
      totalApiRequests: this.apiRequestCount,
      recentApiRequests: this.apiRequestTimes.length,
      apiCallsPerMinute: this.apiCallsPerMinute,
      minApiIntervalMs: this.minApiIntervalMs,
    };
  }
}

/**
 * Lazy singleton. Construction touches `ConfigService.getInstance()`, which can
 * throw `ConfigParseError` / `ConfigValidationError` for a broken config.
 * Building eagerly at module-load time would let those errors escape
 * `cli.ts`'s `withErrorHandling` wrapper — deferring construction until first
 * use keeps config errors inside the CLI error boundary.
 */
let instance: GlobalRateLimiter | undefined;

export function getGlobalRateLimiter(): GlobalRateLimiter {
  if (!instance) instance = new GlobalRateLimiter();
  return instance;
}
