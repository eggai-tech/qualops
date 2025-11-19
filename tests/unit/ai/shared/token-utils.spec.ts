import type { TokenStats } from '@/ai/providers/index.ts';
import {
  addTokenStats,
  aggregateTokenStats,
  createEmptyTokenStats,
  estimateTokens,
  formatTokenStats,
} from '@/ai/shared/token-utils';

describe('createEmptyTokenStats', () => {
  it('should create empty token stats with all fields initialized to 0', () => {
    const result = createEmptyTokenStats();

    expect(result.totalInputTokens).toBe(0);
    expect(result.totalOutputTokens).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.invocationCount).toBe(0);
    expect(result.estimatedCost).toBe(0);
    expect(result.startTime).toBeInstanceOf(Date);
  });
});

describe('addTokenStats', () => {
  it('should add two token stats correctly', () => {
    const base: TokenStats = {
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalTokens: 150,
      invocationCount: 2,
      estimatedCost: 0.01,
      startTime: new Date('2024-01-01'),
    };

    const addition: TokenStats = {
      totalInputTokens: 200,
      totalOutputTokens: 100,
      totalTokens: 300,
      invocationCount: 3,
      estimatedCost: 0.02,
      startTime: new Date('2024-01-02'),
    };

    const result = addTokenStats(base, addition);

    expect(result.totalInputTokens).toBe(300);
    expect(result.totalOutputTokens).toBe(150);
    expect(result.totalTokens).toBe(450);
    expect(result.invocationCount).toBe(5);
    expect(result.estimatedCost).toBeCloseTo(0.03, 5);
    expect(result.startTime).toBe(base.startTime);
  });

  it('should return base stats when addition is null', () => {
    const base: TokenStats = {
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalTokens: 150,
      invocationCount: 2,
      estimatedCost: 0.01,
      startTime: new Date('2024-01-01'),
    };

    const result = addTokenStats(base, null);

    expect(result).toBe(base);
  });

  it('should return base stats when addition is undefined', () => {
    const base: TokenStats = {
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalTokens: 150,
      invocationCount: 2,
      estimatedCost: 0.01,
      startTime: new Date('2024-01-01'),
    };

    const result = addTokenStats(base, undefined);

    expect(result).toBe(base);
  });

  it('should handle missing fields in addition stats', () => {
    const base: TokenStats = {
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalTokens: 150,
      invocationCount: 2,
      estimatedCost: 0.01,
      startTime: new Date('2024-01-01'),
    };

    const addition: Partial<TokenStats> = {
      totalInputTokens: undefined,
      totalOutputTokens: undefined,
      totalTokens: 100,
      invocationCount: 1,
      estimatedCost: 0.005,
      startTime: new Date('2024-01-02'),
    };

    const result = addTokenStats(base, addition as TokenStats);

    expect(result.totalInputTokens).toBe(100); // 100 + 0
    expect(result.totalOutputTokens).toBe(50); // 50 + 0
    expect(result.totalTokens).toBe(250); // 150 + 100
  });

  it('should handle zero values in addition stats', () => {
    const base: TokenStats = {
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalTokens: 150,
      invocationCount: 2,
      estimatedCost: 0.01,
      startTime: new Date('2024-01-01'),
    };

    const addition: TokenStats = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      invocationCount: 1,
      estimatedCost: 0,
      startTime: new Date('2024-01-02'),
    };

    const result = addTokenStats(base, addition);

    expect(result.totalInputTokens).toBe(100); // 100 + 0
    expect(result.totalOutputTokens).toBe(50); // 50 + 0
    expect(result.totalTokens).toBe(150); // 150 + 0
    expect(result.invocationCount).toBe(3); // 2 + 1
    expect(result.estimatedCost).toBe(0.01); // 0.01 + 0
  });
});

describe('aggregateTokenStats', () => {
  it('should aggregate multiple token stats', () => {
    const stats: TokenStats[] = [
      {
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
        invocationCount: 1,
        estimatedCost: 0.01,
        startTime: new Date('2024-01-01'),
      },
      {
        totalInputTokens: 200,
        totalOutputTokens: 100,
        totalTokens: 300,
        invocationCount: 2,
        estimatedCost: 0.02,
        startTime: new Date('2024-01-02'),
      },
      {
        totalInputTokens: 150,
        totalOutputTokens: 75,
        totalTokens: 225,
        invocationCount: 1,
        estimatedCost: 0.015,
        startTime: new Date('2024-01-03'),
      },
    ];

    const result = aggregateTokenStats(stats);

    expect(result.totalInputTokens).toBe(450);
    expect(result.totalOutputTokens).toBe(225);
    expect(result.totalTokens).toBe(675);
    expect(result.invocationCount).toBe(4);
    expect(result.estimatedCost).toBeCloseTo(0.045, 5);
  });

  it('should handle empty array', () => {
    const result = aggregateTokenStats([]);

    expect(result.totalInputTokens).toBe(0);
    expect(result.totalOutputTokens).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.invocationCount).toBe(0);
    expect(result.estimatedCost).toBe(0);
  });

  it('should skip null and undefined stats', () => {
    const stats: (TokenStats | null | undefined)[] = [
      {
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
        invocationCount: 1,
        estimatedCost: 0.01,
        startTime: new Date('2024-01-01'),
      },
      null,
      undefined,
      {
        totalInputTokens: 200,
        totalOutputTokens: 100,
        totalTokens: 300,
        invocationCount: 2,
        estimatedCost: 0.02,
        startTime: new Date('2024-01-02'),
      },
    ];

    const result = aggregateTokenStats(stats);

    expect(result.totalInputTokens).toBe(300);
    expect(result.totalOutputTokens).toBe(150);
    expect(result.totalTokens).toBe(450);
    expect(result.invocationCount).toBe(3);
  });
});

describe('formatTokenStats', () => {
  it('should format token stats with all fields', () => {
    const stats: TokenStats = {
      totalInputTokens: 12345,
      totalOutputTokens: 6789,
      totalTokens: 19134,
      invocationCount: 10,
      estimatedCost: 0.1234,
      startTime: new Date(Date.now() - 60 * 1000), // 1 minute ago
    };

    const result = formatTokenStats(stats);

    expect(result).toContain('Invocations: 10');
    expect(result).toContain('Input tokens: 12,345');
    expect(result).toContain('Output tokens: 6,789');
    expect(result).toContain('Total tokens: 19,134');
    expect(result).toContain('Estimated cost: $0.1234');
    expect(result).toContain('Avg tokens/call: 1913');
  });

  it('should handle zero invocations without division by zero', () => {
    const stats: TokenStats = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      invocationCount: 0,
      estimatedCost: 0,
      startTime: new Date(),
    };

    const result = formatTokenStats(stats);

    expect(result).toContain('Invocations: 0');
    expect(result).toContain('Avg tokens/call: 0');
  });

  it('should format runtime correctly', () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const stats: TokenStats = {
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalTokens: 150,
      invocationCount: 1,
      estimatedCost: 0.01,
      startTime: twoMinutesAgo,
    };

    const result = formatTokenStats(stats);

    expect(result).toMatch(/Runtime: [12]\.\d minutes/);
  });
});

describe('estimateTokens', () => {
  it('should estimate tokens for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should estimate tokens for simple text', () => {
    const result = estimateTokens('hello world');
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(10);
  });

  it('should estimate more tokens for longer text', () => {
    const shortText = 'hello';
    const longText = 'hello world this is a longer text with more words';
    expect(estimateTokens(longText)).toBeGreaterThan(estimateTokens(shortText));
  });

  it('should handle special characters', () => {
    const text = '!@#$%^&*()';
    expect(estimateTokens(text)).toBeGreaterThan(0);
  });

  it('should handle unicode characters', () => {
    const text = '你好世界';
    expect(estimateTokens(text)).toBeGreaterThan(0);
  });
});
