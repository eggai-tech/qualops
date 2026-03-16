import { readFileSync } from 'fs';
import { join } from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  level: LogLevel;
  enableColors: boolean;
  enableTimestamps: boolean;
  prefix?: string;
}

class Logger {
  private config: LoggerConfig;
  private logLevels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  private colors: Record<LogLevel, string> = {
    debug: '\x1b[36m', // Cyan
    info: '\x1b[32m', // Green
    warn: '\x1b[33m', // Yellow
    error: '\x1b[31m', // Red
  };

  private resetColor = '\x1b[0m';

  constructor(config?: Partial<LoggerConfig>) {
    const defaultConfig = this.loadConfigFromFile();

    this.config = {
      level: 'debug',
      enableColors: true,
      enableTimestamps: true,
      ...defaultConfig,
      ...config,
    };
  }

  private loadConfigFromFile(): Partial<LoggerConfig> {
    try {
      const configPath = join(process.cwd(), '.qualopsrc.json');
      const configFile = readFileSync(configPath, 'utf8');
      const config = JSON.parse(configFile);
      return config.logger || {};
    } catch {
      return {};
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return this.logLevels[level] >= this.logLevels[this.config.level];
  }

  private formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
    const parts: string[] = [];

    if (this.config.enableTimestamps) {
      const timestamp = new Date().toISOString();
      parts.push(`[${timestamp}]`);
    }

    const levelStr = level.toUpperCase().padEnd(5);
    if (this.config.enableColors) {
      parts.push(`${this.colors[level]}${levelStr}${this.resetColor}`);
    } else {
      parts.push(`[${levelStr}]`);
    }

    if (this.config.prefix) {
      parts.push(`[${this.config.prefix}]`);
    }

    const formattedMessage =
      args.length > 0
        ? message +
          ' ' +
          args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ')
        : message;

    parts.push(formattedMessage);

    return parts.join(' ');
  }

  debug(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('debug')) return;
    console.log(this.formatMessage('debug', message, ...args));
  }

  info(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('info')) return;
    console.log(this.formatMessage('info', message, ...args));
  }

  warn(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('warn')) return;
    console.warn(this.formatMessage('warn', message, ...args));
  }

  error(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('error')) return;
    console.error(this.formatMessage('error', message, ...args));
  }

  start(message: string, ...args: unknown[]): void {
    this.info(`[START] ${message}`, ...args);
  }

  summary(message: string, ...args: unknown[]): void {
    this.info(`[SUMMARY] ${message}`, ...args);
  }

  timing(message: string, ...args: unknown[]): void {
    this.info(`[TIMING] ${message}`, ...args);
  }

  cache(message: string, ...args: unknown[]): void {
    this.debug(`[CACHE] ${message}`, ...args);
  }

  ai(message: string, ...args: unknown[]): void {
    this.info(`[AI] ${message}`, ...args);
  }

  extract(message: string, ...args: unknown[]): void {
    this.info(`[EXTRACT] ${message}`, ...args);
  }

  git(message: string, ...args: unknown[]): void {
    this.info(`[GIT] ${message}`, ...args);
  }

  security(message: string, ...args: unknown[]): void {
    this.warn(`[SECURITY] ${message}`, ...args);
  }

  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): LoggerConfig {
    return { ...this.config };
  }
}

export const logger = new Logger();

export { Logger };

export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);
export const start = logger.start.bind(logger);
export const summary = logger.summary.bind(logger);
export const timing = logger.timing.bind(logger);
export const cache = logger.cache.bind(logger);
export const ai = logger.ai.bind(logger);
export const extract = logger.extract.bind(logger);
export const git = logger.git.bind(logger);
export const security = logger.security.bind(logger);
