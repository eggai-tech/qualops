import { getGlobalTokenStats } from '@/ai/providers';
import { formatTokenStats } from '@/ai/shared/token-utils';
import {
  generateTokenConsoleOutput,
  generateTokenUsageHTML,
  generateTokenUsageJSON,
  generateTokenUsageSection,
} from '@/stages/report/generators/token-generator';

jest.mock('@/ai/providers');
jest.mock('@/ai/shared/token-utils');

const mockGetGlobalTokenStats = getGlobalTokenStats as jest.MockedFunction<
  typeof getGlobalTokenStats
>;
const mockFormatTokenStats = formatTokenStats as jest.MockedFunction<typeof formatTokenStats>;

describe('token-generator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createMockTokenStats = (overrides?: any) => ({
    totalTokens: 10000,
    totalInputTokens: 6000,
    totalOutputTokens: 4000,
    invocationCount: 10,
    estimatedCost: 0.05,
    ...overrides,
  });

  describe('generateTokenUsageSection', () => {
    describe('basic functionality', () => {
      it('should generate token usage section', () => {
        const stats = createMockTokenStats();
        mockGetGlobalTokenStats.mockReturnValue(stats);
        mockFormatTokenStats.mockReturnValue('Formatted stats');

        const result = generateTokenUsageSection();

        expect(result.title).toBe('Resource Usage');
        expect(result.content).toContain('AI Token Usage');
        expect(result.content).toContain('Formatted stats');
      });

      it('should call getGlobalTokenStats', () => {
        const stats = createMockTokenStats();
        mockGetGlobalTokenStats.mockReturnValue(stats);
        mockFormatTokenStats.mockReturnValue('Stats');

        generateTokenUsageSection();

        expect(mockGetGlobalTokenStats).toHaveBeenCalledTimes(1);
      });

      it('should format token stats', () => {
        const stats = createMockTokenStats();
        mockGetGlobalTokenStats.mockReturnValue(stats);
        mockFormatTokenStats.mockReturnValue('Formatted');

        generateTokenUsageSection();

        expect(mockFormatTokenStats).toHaveBeenCalledWith(stats);
      });
    });

    describe('content formatting', () => {
      it('should include input tokens', () => {
        const stats = createMockTokenStats({ totalInputTokens: 5000 });
        mockGetGlobalTokenStats.mockReturnValue(stats);
        mockFormatTokenStats.mockReturnValue('Stats');

        const result = generateTokenUsageSection();

        expect(result.content).toContain('Input Tokens: 5,000');
      });

      it('should include output tokens', () => {
        const stats = createMockTokenStats({ totalOutputTokens: 3000 });
        mockGetGlobalTokenStats.mockReturnValue(stats);
        mockFormatTokenStats.mockReturnValue('Stats');

        const result = generateTokenUsageSection();

        expect(result.content).toContain('Output Tokens: 3,000');
      });

      it('should include API calls', () => {
        const stats = createMockTokenStats({ invocationCount: 25 });
        mockGetGlobalTokenStats.mockReturnValue(stats);
        mockFormatTokenStats.mockReturnValue('Stats');

        const result = generateTokenUsageSection();

        expect(result.content).toContain('API Calls: 25');
      });

      it('should include estimated cost', () => {
        const stats = createMockTokenStats({ estimatedCost: 0.1234 });
        mockGetGlobalTokenStats.mockReturnValue(stats);
        mockFormatTokenStats.mockReturnValue('Stats');

        const result = generateTokenUsageSection();

        expect(result.content).toContain('$0.1234');
      });

      it('should calculate average tokens per call', () => {
        const stats = createMockTokenStats({ totalTokens: 10000, invocationCount: 5 });
        mockGetGlobalTokenStats.mockReturnValue(stats);
        mockFormatTokenStats.mockReturnValue('Stats');

        const result = generateTokenUsageSection();

        expect(result.content).toContain('Average Tokens/Call: 2000');
      });

      it('should handle zero invocations', () => {
        const stats = createMockTokenStats({ invocationCount: 0 });
        mockGetGlobalTokenStats.mockReturnValue(stats);
        mockFormatTokenStats.mockReturnValue('Stats');

        const result = generateTokenUsageSection();

        expect(result.content).toContain('Average Tokens/Call: 0');
      });
    });

    describe('number formatting', () => {
      it('should format large numbers with commas', () => {
        const stats = createMockTokenStats({ totalInputTokens: 1234567 });
        mockGetGlobalTokenStats.mockReturnValue(stats);
        mockFormatTokenStats.mockReturnValue('Stats');

        const result = generateTokenUsageSection();

        expect(result.content).toContain('1,234,567');
      });

      it('should round average to integer', () => {
        const stats = createMockTokenStats({ totalTokens: 10001, invocationCount: 3 });
        mockGetGlobalTokenStats.mockReturnValue(stats);
        mockFormatTokenStats.mockReturnValue('Stats');

        const result = generateTokenUsageSection();

        expect(result.content).toContain('Average Tokens/Call: 3334');
      });
    });
  });

  describe('generateTokenUsageHTML', () => {
    describe('basic HTML generation', () => {
      it('should generate HTML with token stats', () => {
        const stats = createMockTokenStats();
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('AI Token Usage Analysis');
        expect(result).toContain('token-usage-section');
      });

      it('should include total tokens', () => {
        const stats = createMockTokenStats({ totalTokens: 50000 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('50,000');
        expect(result).toContain('Total Tokens');
      });

      it('should include API calls', () => {
        const stats = createMockTokenStats({ invocationCount: 42 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('42');
        expect(result).toContain('API Calls');
      });

      it('should include estimated cost', () => {
        const stats = createMockTokenStats({ estimatedCost: 0.0567 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('$0.0567');
        expect(result).toContain('Estimated Cost');
      });
    });

    describe('token distribution', () => {
      it('should show input token percentage', () => {
        const stats = createMockTokenStats({ totalTokens: 10000, totalInputTokens: 6000 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('60.0%');
        expect(result).toContain('Input: 6,000');
      });

      it('should show output token percentage', () => {
        const stats = createMockTokenStats({ totalTokens: 10000, totalOutputTokens: 4000 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('40.0%');
        expect(result).toContain('Output: 4,000');
      });

      it('should handle equal distribution', () => {
        const stats = createMockTokenStats({
          totalTokens: 10000,
          totalInputTokens: 5000,
          totalOutputTokens: 5000,
        });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('50.0%');
      });
    });

    describe('efficiency metrics', () => {
      it('should show average tokens per call', () => {
        const stats = createMockTokenStats({ totalTokens: 9000, invocationCount: 3 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('Average Tokens per Call:');
        expect(result).toContain('3000');
      });

      it('should show efficiency rating for excellent usage', () => {
        const stats = createMockTokenStats({ totalTokens: 500, invocationCount: 1 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('Excellent - Very efficient token usage');
      });

      it('should show efficiency rating for good usage', () => {
        const stats = createMockTokenStats({ totalTokens: 1500, invocationCount: 1 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('Good - Reasonable token usage');
      });

      it('should show efficiency rating for fair usage', () => {
        const stats = createMockTokenStats({ totalTokens: 3000, invocationCount: 1 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('Fair - Consider optimizing prompts');
      });

      it('should show efficiency rating for poor usage', () => {
        const stats = createMockTokenStats({ totalTokens: 10000, invocationCount: 1 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('Poor - High token usage, optimization needed');
      });

      it('should calculate input/output ratio', () => {
        const stats = createMockTokenStats({ totalInputTokens: 8000, totalOutputTokens: 2000 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('Input/Output Ratio:');
        expect(result).toContain('4.00:1');
      });

      it('should handle zero output tokens in ratio', () => {
        const stats = createMockTokenStats({ totalInputTokens: 1000, totalOutputTokens: 0 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).not.toContain('Infinity');
      });
    });

    describe('HTML structure', () => {
      it('should include token usage section class', () => {
        const stats = createMockTokenStats();
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('token-usage-section');
      });

      it('should include token overview', () => {
        const stats = createMockTokenStats();
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('token-overview');
      });

      it('should include token breakdown', () => {
        const stats = createMockTokenStats();
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('token-breakdown');
      });

      it('should include efficiency metrics section', () => {
        const stats = createMockTokenStats();
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageHTML();

        expect(result).toContain('efficiency-metrics');
      });
    });
  });

  describe('generateTokenUsageJSON', () => {
    describe('basic JSON generation', () => {
      it('should generate token usage JSON', () => {
        const stats = createMockTokenStats();
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageJSON();

        expect(result.totalTokens).toBe(10000);
        expect(result.inputTokens).toBe(6000);
        expect(result.outputTokens).toBe(4000);
        expect(result.apiCalls).toBe(10);
      });

      it('should include estimated cost', () => {
        const stats = createMockTokenStats({ estimatedCost: 0.123 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageJSON();

        expect(result.estimatedCost).toBe(0.123);
      });

      it('should calculate average tokens per call', () => {
        const stats = createMockTokenStats({ totalTokens: 15000, invocationCount: 5 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageJSON();

        expect(result.averageTokensPerCall).toBe(3000);
      });

      it('should handle zero invocations', () => {
        const stats = createMockTokenStats({ invocationCount: 0, totalTokens: 0 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageJSON();

        expect(result.averageTokensPerCall).toBe(0);
      });
    });

    describe('cost breakdown', () => {
      it('should calculate input cost', () => {
        const stats = createMockTokenStats({ totalInputTokens: 100000 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageJSON();

        expect(result.costBreakdown.inputCost).toBe(1);
      });

      it('should calculate output cost', () => {
        const stats = createMockTokenStats({ totalOutputTokens: 100000 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageJSON();

        expect(result.costBreakdown.outputCost).toBe(3);
      });

      it('should have separate input and output costs', () => {
        const stats = createMockTokenStats({ totalInputTokens: 50000, totalOutputTokens: 30000 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageJSON();

        expect(result.costBreakdown.inputCost).toBe(0.5);
        expect(result.costBreakdown.outputCost).toBe(0.9);
      });
    });

    describe('data structure', () => {
      it('should have all required fields', () => {
        const stats = createMockTokenStats();
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageJSON();

        expect(result).toHaveProperty('totalTokens');
        expect(result).toHaveProperty('inputTokens');
        expect(result).toHaveProperty('outputTokens');
        expect(result).toHaveProperty('apiCalls');
        expect(result).toHaveProperty('averageTokensPerCall');
        expect(result).toHaveProperty('estimatedCost');
        expect(result).toHaveProperty('costBreakdown');
      });

      it('should have cost breakdown fields', () => {
        const stats = createMockTokenStats();
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageJSON();

        expect(result.costBreakdown).toHaveProperty('inputCost');
        expect(result.costBreakdown).toHaveProperty('outputCost');
      });
    });

    describe('edge cases', () => {
      it('should handle very large token counts', () => {
        const stats = createMockTokenStats({
          totalTokens: 10000000,
          totalInputTokens: 6000000,
          totalOutputTokens: 4000000,
        });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageJSON();

        expect(result.totalTokens).toBe(10000000);
        expect(result.inputTokens).toBe(6000000);
        expect(result.outputTokens).toBe(4000000);
      });

      it('should handle zero values', () => {
        const stats = createMockTokenStats({
          totalTokens: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          invocationCount: 0,
        });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenUsageJSON();

        expect(result.totalTokens).toBe(0);
        expect(result.averageTokensPerCall).toBe(0);
      });
    });
  });

  describe('generateTokenConsoleOutput', () => {
    describe('basic console output', () => {
      it('should generate console output', () => {
        const stats = createMockTokenStats();
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenConsoleOutput();

        expect(result).toContain('Token Usage Summary');
        expect(result).toContain('Total Tokens:');
        expect(result).toContain('API Calls:');
        expect(result).toContain('Estimated Cost:');
      });

      it('should include total tokens', () => {
        const stats = createMockTokenStats({ totalTokens: 25000 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenConsoleOutput();

        expect(result).toContain('25,000');
      });

      it('should include API calls', () => {
        const stats = createMockTokenStats({ invocationCount: 15 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenConsoleOutput();

        expect(result).toContain('API Calls: 15');
      });

      it('should include estimated cost with 4 decimals', () => {
        const stats = createMockTokenStats({ estimatedCost: 0.12345 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenConsoleOutput();

        expect(result).toContain('$0.1235');
      });
    });

    describe('formatting', () => {
      it('should have header and footer separators', () => {
        const stats = createMockTokenStats();
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenConsoleOutput();

        expect(result).toContain('===');
      });

      it('should format large numbers with commas', () => {
        const stats = createMockTokenStats({ totalTokens: 1234567 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenConsoleOutput();

        expect(result).toContain('1,234,567');
      });

      it('should use newlines between lines', () => {
        const stats = createMockTokenStats();
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenConsoleOutput();

        const lines = result.split('\n');
        expect(lines.length).toBeGreaterThan(1);
      });
    });

    describe('edge cases', () => {
      it('should handle zero tokens', () => {
        const stats = createMockTokenStats({
          totalTokens: 0,
          invocationCount: 0,
          estimatedCost: 0,
        });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenConsoleOutput();

        expect(result).toContain('Total Tokens: 0');
        expect(result).toContain('$0.0000');
      });

      it('should handle very small cost', () => {
        const stats = createMockTokenStats({ estimatedCost: 0.0001 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenConsoleOutput();

        expect(result).toContain('$0.0001');
      });

      it('should handle very large cost', () => {
        const stats = createMockTokenStats({ estimatedCost: 123.4567 });
        mockGetGlobalTokenStats.mockReturnValue(stats);

        const result = generateTokenConsoleOutput();

        expect(result).toContain('$123.4567');
      });
    });
  });
});
