/**
 * Simple structured logger respecting logging.level config.
 */

const LEVELS = { DEBUG: 0, INFO: 1, WARNING: 2, ERROR: 3 } as const;
type LogLevel = keyof typeof LEVELS;

let currentLevel: LogLevel = "WARNING";

export function setLogLevel(level: string): void {
  const upper = level.toUpperCase();
  if (upper in LEVELS) {
    currentLevel = upper as LogLevel;
  }
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

export function debug(message: string): void {
  if (shouldLog("DEBUG")) process.stderr.write(`DEBUG: ${message}\n`);
}

export function info(message: string): void {
  if (shouldLog("INFO")) process.stderr.write(`INFO: ${message}\n`);
}

export function warn(message: string): void {
  if (shouldLog("WARNING")) process.stderr.write(`WARNING: ${message}\n`);
}

export function error(message: string): void {
  if (shouldLog("ERROR")) process.stderr.write(`ERROR: ${message}\n`);
}
