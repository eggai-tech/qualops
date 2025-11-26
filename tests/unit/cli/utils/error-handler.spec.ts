import { handleError, handleStageError, withErrorHandling } from '@/cli/utils/error-handler';
import { logger } from '@/shared/utils/logger';

jest.mock('@/shared/utils/logger');

const mockLogger = logger as jest.Mocked<typeof logger>;
const mockProcessExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

describe('handleError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('with Error instances', () => {
    it('should log error message without context', () => {
      const error = new Error('Test error message');

      handleError(error);

      expect(mockLogger.error).toHaveBeenCalledWith('Test error message');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log error message with context', () => {
      const error = new Error('Test error message');

      handleError(error, 'Database connection');

      expect(mockLogger.error).toHaveBeenCalledWith('Database connection: Test error message');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log stack trace when available', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.ts:10:5';

      handleError(error);

      expect(mockLogger.error).toHaveBeenCalledWith('Test error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Stack trace:',
        'Error: Test error\n    at test.ts:10:5',
      );
    });

    it('should not log stack trace when undefined', () => {
      const error = new Error('Test error');
      error.stack = undefined;

      handleError(error);

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith('Test error');
    });

    it('should not log stack trace when empty string', () => {
      const error = new Error('Test error');
      error.stack = '';

      handleError(error);

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith('Test error');
    });

    it('should handle error with multiline stack trace', () => {
      const error = new Error('Complex error');
      error.stack =
        'Error: Complex error\n    at func1 (file1.ts:10:5)\n    at func2 (file2.ts:20:10)';

      handleError(error);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Stack trace:',
        expect.stringContaining('func1'),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Stack trace:',
        expect.stringContaining('func2'),
      );
    });

    it('should handle error with empty message', () => {
      const error = new Error('');

      handleError(error);

      expect(mockLogger.error).toHaveBeenCalledWith('');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  describe('with non-Error values', () => {
    it('should log string error without context', () => {
      handleError('String error message');

      expect(mockLogger.error).toHaveBeenCalledWith('Unknown error:', 'String error message');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log string error with context', () => {
      handleError('String error', 'API call');

      expect(mockLogger.error).toHaveBeenCalledWith('API call: Unknown error:', 'String error');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log number error', () => {
      handleError(404);

      expect(mockLogger.error).toHaveBeenCalledWith('Unknown error:', 404);
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log boolean error', () => {
      handleError(false);

      expect(mockLogger.error).toHaveBeenCalledWith('Unknown error:', false);
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log null error', () => {
      handleError(null);

      expect(mockLogger.error).toHaveBeenCalledWith('Unknown error:', null);
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log undefined error', () => {
      handleError(undefined);

      expect(mockLogger.error).toHaveBeenCalledWith('Unknown error:', undefined);
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log object error', () => {
      const errorObj = { code: 'ERR001', message: 'Custom error' };

      handleError(errorObj);

      expect(mockLogger.error).toHaveBeenCalledWith('Unknown error:', errorObj);
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log array error', () => {
      const errorArray = ['error1', 'error2'];

      handleError(errorArray);

      expect(mockLogger.error).toHaveBeenCalledWith('Unknown error:', errorArray);
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log empty string error', () => {
      handleError('');

      expect(mockLogger.error).toHaveBeenCalledWith('Unknown error:', '');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  describe('context handling', () => {
    it('should handle empty string context', () => {
      const error = new Error('Test');

      handleError(error, '');

      expect(mockLogger.error).toHaveBeenCalledWith('Test');
    });

    it('should handle context with special characters', () => {
      const error = new Error('Test');

      handleError(error, 'DB-Connection@localhost:5432');

      expect(mockLogger.error).toHaveBeenCalledWith('DB-Connection@localhost:5432: Test');
    });

    it('should handle context with whitespace', () => {
      const error = new Error('Test');

      handleError(error, 'File Upload Operation');

      expect(mockLogger.error).toHaveBeenCalledWith('File Upload Operation: Test');
    });

    it('should not add colon when context is undefined', () => {
      const error = new Error('Test');

      handleError(error, undefined);

      expect(mockLogger.error).toHaveBeenCalledWith('Test');
      expect(mockLogger.error).not.toHaveBeenCalledWith(expect.stringContaining(':'));
    });
  });

  describe('process exit behavior', () => {
    it('should exit with code 1', () => {
      handleError(new Error('Test'));

      expect(mockProcessExit).toHaveBeenCalledWith(1);
      expect(mockProcessExit).toHaveBeenCalledTimes(1);
    });

    it('should exit even with non-Error values', () => {
      handleError('string error');

      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should exit even with null', () => {
      handleError(null);

      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });
});

describe('handleStageError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('with Error instances', () => {
    it('should log stage name with error message', () => {
      const error = new Error('Stage execution failed');

      handleStageError('analyze', error);

      expect(mockLogger.error).toHaveBeenCalledWith('analyze failed:', 'Stage execution failed');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log stack trace when available', () => {
      const error = new Error('Stage failed');
      error.stack = 'Error: Stage failed\n    at stage.ts:100:20';

      handleStageError('review', error);

      expect(mockLogger.error).toHaveBeenCalledWith('review failed:', 'Stage failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Stack trace:',
        'Error: Stage failed\n    at stage.ts:100:20',
      );
    });

    it('should not log stack trace when undefined', () => {
      const error = new Error('Stage failed');
      error.stack = undefined;

      handleStageError('fix', error);

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith('fix failed:', 'Stage failed');
    });

    it('should not log stack trace when empty string', () => {
      const error = new Error('Stage failed');
      error.stack = '';

      handleStageError('fix', error);

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });

    it('should handle error with complex stack trace', () => {
      const error = new Error('Complex stage error');
      error.stack =
        'Error: Complex stage error\n    at processFile (processor.ts:50:15)\n    at async runStage (stage.ts:200:5)';

      handleStageError('report', error);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Stack trace:',
        expect.stringContaining('processFile'),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Stack trace:',
        expect.stringContaining('runStage'),
      );
    });
  });

  describe('with non-Error values', () => {
    it('should log stage name with string error', () => {
      handleStageError('analyze', 'Configuration missing');

      expect(mockLogger.error).toHaveBeenCalledWith('analyze failed:', 'Configuration missing');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log stage name with number error', () => {
      handleStageError('review', 500);

      expect(mockLogger.error).toHaveBeenCalledWith('review failed:', 500);
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log stage name with boolean error', () => {
      handleStageError('judge', true);

      expect(mockLogger.error).toHaveBeenCalledWith('judge failed:', true);
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log stage name with null error', () => {
      handleStageError('fix', null);

      expect(mockLogger.error).toHaveBeenCalledWith('fix failed:', null);
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log stage name with undefined error', () => {
      handleStageError('report', undefined);

      expect(mockLogger.error).toHaveBeenCalledWith('report failed:', undefined);
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log stage name with object error', () => {
      const errorObj = { code: 500, details: 'Internal error' };

      handleStageError('judge', errorObj);

      expect(mockLogger.error).toHaveBeenCalledWith('judge failed:', errorObj);
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log stage name with array error', () => {
      const errors = ['error1', 'error2', 'error3'];

      handleStageError('analyze', errors);

      expect(mockLogger.error).toHaveBeenCalledWith('analyze failed:', errors);
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should log stage name with empty string error', () => {
      handleStageError('review', '');

      expect(mockLogger.error).toHaveBeenCalledWith('review failed:', '');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  describe('stage name handling', () => {
    it('should handle uppercase stage names', () => {
      handleStageError('ANALYZE', new Error('Test'));

      expect(mockLogger.error).toHaveBeenCalledWith('ANALYZE failed:', 'Test');
    });

    it('should handle mixed case stage names', () => {
      handleStageError('ReViEw', new Error('Test'));

      expect(mockLogger.error).toHaveBeenCalledWith('ReViEw failed:', 'Test');
    });

    it('should handle stage names with hyphens', () => {
      handleStageError('pre-process', new Error('Test'));

      expect(mockLogger.error).toHaveBeenCalledWith('pre-process failed:', 'Test');
    });

    it('should handle stage names with underscores', () => {
      handleStageError('post_process', new Error('Test'));

      expect(mockLogger.error).toHaveBeenCalledWith('post_process failed:', 'Test');
    });

    it('should handle empty stage name', () => {
      handleStageError('', new Error('Test'));

      expect(mockLogger.error).toHaveBeenCalledWith(' failed:', 'Test');
    });

    it('should handle stage names with spaces', () => {
      handleStageError('custom stage', new Error('Test'));

      expect(mockLogger.error).toHaveBeenCalledWith('custom stage failed:', 'Test');
    });
  });

  describe('process exit behavior', () => {
    it('should exit with code 1 on Error', () => {
      handleStageError('analyze', new Error('Test'));

      expect(mockProcessExit).toHaveBeenCalledWith(1);
      expect(mockProcessExit).toHaveBeenCalledTimes(1);
    });

    it('should exit with code 1 on non-Error values', () => {
      handleStageError('review', 'test error');

      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should exit with code 1 on null', () => {
      handleStageError('report', null);

      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });
});

describe('withErrorHandling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('successful execution', () => {
    it('should return result when function succeeds', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');
      const wrapped = withErrorHandling(mockFn);

      const result = await wrapped();

      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should pass arguments to wrapped function', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = withErrorHandling(mockFn);

      await wrapped('arg1', 'arg2', 'arg3');

      expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2', 'arg3');
    });

    it('should handle multiple arguments of different types', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = withErrorHandling(mockFn);

      await wrapped('string', 42, true, null, { key: 'value' });

      expect(mockFn).toHaveBeenCalledWith('string', 42, true, null, { key: 'value' });
    });

    it('should handle function with no arguments', async () => {
      const mockFn = jest.fn().mockResolvedValue('no args result');
      const wrapped = withErrorHandling(mockFn);

      const result = await wrapped();

      expect(result).toBe('no args result');
      expect(mockFn).toHaveBeenCalledWith();
    });

    it('should return undefined when function resolves with undefined', async () => {
      const mockFn = jest.fn().mockResolvedValue(undefined);
      const wrapped = withErrorHandling(mockFn);

      const result = await wrapped();

      expect(result).toBeUndefined();
    });

    it('should return null when function resolves with null', async () => {
      const mockFn = jest.fn().mockResolvedValue(null);
      const wrapped = withErrorHandling(mockFn);

      const result = await wrapped();

      expect(result).toBeNull();
    });

    it('should return complex objects', async () => {
      const complexObject = { data: [1, 2, 3], nested: { value: 'test' } };
      const mockFn = jest.fn().mockResolvedValue(complexObject);
      const wrapped = withErrorHandling(mockFn);

      const result = await wrapped();

      expect(result).toEqual(complexObject);
    });

    it('should return arrays', async () => {
      const array = [1, 'two', { three: 3 }, [4, 5]];
      const mockFn = jest.fn().mockResolvedValue(array);
      const wrapped = withErrorHandling(mockFn);

      const result = await wrapped();

      expect(result).toEqual(array);
    });

    it('should return primitive values', async () => {
      const mockFn1 = jest.fn().mockResolvedValue(42);
      const mockFn2 = jest.fn().mockResolvedValue('string');
      const mockFn3 = jest.fn().mockResolvedValue(true);

      const wrapped1 = withErrorHandling(mockFn1);
      const wrapped2 = withErrorHandling(mockFn2);
      const wrapped3 = withErrorHandling(mockFn3);

      expect(await wrapped1()).toBe(42);
      expect(await wrapped2()).toBe('string');
      expect(await wrapped3()).toBe(true);
    });
  });

  describe('error handling with context', () => {
    it('should call handleError with context when function fails', async () => {
      const error = new Error('Async failure');
      const mockFn = jest.fn().mockRejectedValue(error);
      const wrapped = withErrorHandling(mockFn, 'File processing');

      await wrapped();

      expect(mockLogger.error).toHaveBeenCalledWith('File processing: Async failure');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should call handleError without context when not provided', async () => {
      const error = new Error('Async failure');
      const mockFn = jest.fn().mockRejectedValue(error);
      const wrapped = withErrorHandling(mockFn);

      await wrapped();

      expect(mockLogger.error).toHaveBeenCalledWith('Async failure');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should handle empty string context', async () => {
      const error = new Error('Test error');
      const mockFn = jest.fn().mockRejectedValue(error);
      const wrapped = withErrorHandling(mockFn, '');

      await wrapped();

      expect(mockLogger.error).toHaveBeenCalledWith('Test error');
    });

    it('should preserve context with special characters', async () => {
      const error = new Error('Test error');
      const mockFn = jest.fn().mockRejectedValue(error);
      const wrapped = withErrorHandling(mockFn, 'DB@localhost:5432');

      await wrapped();

      expect(mockLogger.error).toHaveBeenCalledWith('DB@localhost:5432: Test error');
    });
  });

  describe('error handling with non-Error values', () => {
    it('should handle string rejection', async () => {
      const mockFn = jest.fn().mockRejectedValue('String error');
      const wrapped = withErrorHandling(mockFn, 'Context');

      await wrapped();

      expect(mockLogger.error).toHaveBeenCalledWith('Context: Unknown error:', 'String error');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should handle number rejection', async () => {
      const mockFn = jest.fn().mockRejectedValue(404);
      const wrapped = withErrorHandling(mockFn);

      await wrapped();

      expect(mockLogger.error).toHaveBeenCalledWith('Unknown error:', 404);
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should handle null rejection', async () => {
      const mockFn = jest.fn().mockRejectedValue(null);
      const wrapped = withErrorHandling(mockFn);

      await wrapped();

      expect(mockLogger.error).toHaveBeenCalledWith('Unknown error:', null);
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should handle undefined rejection', async () => {
      const mockFn = jest.fn().mockRejectedValue(undefined);
      const wrapped = withErrorHandling(mockFn);

      await wrapped();

      expect(mockLogger.error).toHaveBeenCalledWith('Unknown error:', undefined);
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should handle object rejection', async () => {
      const errorObj = { code: 'ERR001', message: 'Custom error object' };
      const mockFn = jest.fn().mockRejectedValue(errorObj);
      const wrapped = withErrorHandling(mockFn);

      await wrapped();

      expect(mockLogger.error).toHaveBeenCalledWith('Unknown error:', errorObj);
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  describe('stack trace handling', () => {
    it('should log stack trace from Error', async () => {
      const error = new Error('Test with stack');
      error.stack = 'Error: Test with stack\n    at test.ts:10:5';
      const mockFn = jest.fn().mockRejectedValue(error);
      const wrapped = withErrorHandling(mockFn);

      await wrapped();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Stack trace:',
        expect.stringContaining('test.ts:10:5'),
      );
    });

    it('should not log stack trace when undefined', async () => {
      const error = new Error('No stack');
      error.stack = undefined;
      const mockFn = jest.fn().mockRejectedValue(error);
      const wrapped = withErrorHandling(mockFn);

      await wrapped();

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).not.toHaveBeenCalledWith(expect.stringContaining('Stack trace'));
    });

    it('should not log stack trace for non-Error values', async () => {
      const mockFn = jest.fn().mockRejectedValue('string error');
      const wrapped = withErrorHandling(mockFn);

      await wrapped();

      expect(mockLogger.error).not.toHaveBeenCalledWith(expect.stringContaining('Stack trace'));
    });
  });

  describe('function behavior preservation', () => {
    it('should maintain async behavior', async () => {
      const mockFn = jest
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve('delayed'), 10)),
        );
      const wrapped = withErrorHandling(mockFn);

      const result = await wrapped();

      expect(result).toBe('delayed');
    });

    it('should call function only once', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');
      const wrapped = withErrorHandling(mockFn);

      await wrapped();

      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should allow multiple calls to wrapped function', async () => {
      const mockFn = jest
        .fn()
        .mockResolvedValueOnce('first')
        .mockResolvedValueOnce('second')
        .mockResolvedValueOnce('third');
      const wrapped = withErrorHandling(mockFn);

      expect(await wrapped()).toBe('first');
      expect(await wrapped()).toBe('second');
      expect(await wrapped()).toBe('third');
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it('should preserve this context', async () => {
      const obj = {
        value: 42,
        asyncMethod: async function () {
          return this.value;
        },
      };
      const wrapped = withErrorHandling(obj.asyncMethod.bind(obj));

      const result = await wrapped();

      expect(result).toBe(42);
    });

    it('should work with arrow functions', async () => {
      const arrowFn = async () => 'arrow result';
      const wrapped = withErrorHandling(arrowFn);

      const result = await wrapped();

      expect(result).toBe('arrow result');
    });

    it('should work with async function expressions', async () => {
      const asyncFn = async function () {
        return 'async function';
      };
      const wrapped = withErrorHandling(asyncFn);

      const result = await wrapped();

      expect(result).toBe('async function');
    });
  });

  describe('type safety and edge cases', () => {
    it('should handle functions that return Promises of different types', async () => {
      const fnString = async () => 'string';
      const fnNumber = async () => 123;
      const fnBoolean = async () => true;

      const wrappedString = withErrorHandling(fnString);
      const wrappedNumber = withErrorHandling(fnNumber);
      const wrappedBoolean = withErrorHandling(fnBoolean);

      expect(await wrappedString()).toBe('string');
      expect(await wrappedNumber()).toBe(123);
      expect(await wrappedBoolean()).toBe(true);
    });

    it('should handle variadic arguments', async () => {
      const mockFn = jest.fn(async (...args: number[]) => args.reduce((a, b) => a + b, 0));
      const wrapped = withErrorHandling(mockFn);

      const result = await wrapped(1, 2, 3, 4, 5);

      expect(result).toBe(15);
      expect(mockFn).toHaveBeenCalledWith(1, 2, 3, 4, 5);
    });

    it('should handle empty arguments', async () => {
      const mockFn = jest.fn(async () => 'no params');
      const wrapped = withErrorHandling(mockFn);

      const result = await wrapped();

      expect(result).toBe('no params');
    });

    it('should handle functions with optional parameters', async () => {
      const mockFn = jest.fn(
        async (required: string, optional?: number) => `${required}-${optional || 'none'}`,
      );
      const wrapped = withErrorHandling(mockFn);

      expect(await wrapped('test')).toBe('test-none');
      expect(await wrapped('test', 42)).toBe('test-42');
    });

    it('should not catch or suppress errors from handleError', async () => {
      const error = new Error('Test error');
      const mockFn = jest.fn().mockRejectedValue(error);
      const wrapped = withErrorHandling(mockFn, 'Context');

      await wrapped();

      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  describe('integration with different error scenarios', () => {
    it('should handle TypeError', async () => {
      const error = new TypeError('Type mismatch');
      const mockFn = jest.fn().mockRejectedValue(error);
      const wrapped = withErrorHandling(mockFn);

      await wrapped();

      expect(mockLogger.error).toHaveBeenCalledWith('Type mismatch');
    });

    it('should handle ReferenceError', async () => {
      const error = new ReferenceError('Variable not defined');
      const mockFn = jest.fn().mockRejectedValue(error);
      const wrapped = withErrorHandling(mockFn);

      await wrapped();

      expect(mockLogger.error).toHaveBeenCalledWith('Variable not defined');
    });

    it('should handle SyntaxError', async () => {
      const error = new SyntaxError('Invalid syntax');
      const mockFn = jest.fn().mockRejectedValue(error);
      const wrapped = withErrorHandling(mockFn);

      await wrapped();

      expect(mockLogger.error).toHaveBeenCalledWith('Invalid syntax');
    });

    it('should handle custom Error subclasses', async () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }

      const error = new CustomError('Custom error message');
      const mockFn = jest.fn().mockRejectedValue(error);
      const wrapped = withErrorHandling(mockFn);

      await wrapped();

      expect(mockLogger.error).toHaveBeenCalledWith('Custom error message');
    });

    it('should handle Error with additional properties', async () => {
      const error = new Error('Error with extra data') as Error & {
        code: string;
        statusCode: number;
      };
      error.code = 'E_CUSTOM';
      error.statusCode = 500;
      const mockFn = jest.fn().mockRejectedValue(error);
      const wrapped = withErrorHandling(mockFn);

      await wrapped();

      expect(mockLogger.error).toHaveBeenCalledWith('Error with extra data');
    });
  });

  describe('chaining and composition', () => {
    it('should allow wrapping already wrapped functions', async () => {
      const baseFn = jest.fn().mockResolvedValue('result');
      const wrapped1 = withErrorHandling(baseFn, 'Context 1');
      const wrapped2 = withErrorHandling(wrapped1, 'Context 2');

      const result = await wrapped2();

      expect(result).toBe('result');
      expect(baseFn).toHaveBeenCalledTimes(1);
    });

    it('should handle nested error contexts', async () => {
      const error = new Error('Nested error');
      const baseFn = jest.fn().mockRejectedValue(error);
      const wrapped1 = withErrorHandling(baseFn, 'Inner context');
      const wrapped2 = withErrorHandling(wrapped1, 'Outer context');

      await wrapped2();

      expect(mockProcessExit).toHaveBeenCalled();
    });
  });
});
