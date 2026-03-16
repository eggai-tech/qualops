import { readFileSync } from 'fs';
import { join } from 'path';

import { Logger } from '@/shared/utils/logger';

jest.mock('fs');
jest.mock('path');

const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockJoin = join as jest.MockedFunction<typeof join>;

describe('Logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockJoin.mockReturnValue('/mocked/.qualops/.qualopsrc.json');
  });

  describe('loadConfigFromFile', () => {
    it('should read config from .qualops/.qualopsrc.json', () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({}));
      const cwd = process.cwd();

      new Logger();

      expect(mockJoin).toHaveBeenCalledWith(cwd, '.qualops/.qualopsrc.json');
    });

    it('should apply logger config loaded from file', () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ logger: { level: 'warn', enableColors: false } }),
      );

      const instance = new Logger();
      const config = instance.getConfig();

      expect(config.level).toBe('warn');
      expect(config.enableColors).toBe(false);
    });

    it('should fall back to defaults when config file is missing', () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const instance = new Logger();
      const config = instance.getConfig();

      expect(config.level).toBe('info');
      expect(config.enableColors).toBe(true);
      expect(config.enableTimestamps).toBe(true);
    });

    it('should fall back to defaults when config file has no logger section', () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ other: 'stuff' }));

      const instance = new Logger();

      expect(instance.getConfig().level).toBe('info');
    });

    it('should allow constructor config to override file config', () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ logger: { level: 'warn' } }));

      const instance = new Logger({ level: 'error' });

      expect(instance.getConfig().level).toBe('error');
    });
  });
});
