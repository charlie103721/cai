// M6 test
type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

import { isDev } from "../config";
const currentLevel: LogLevel = isDev ? "debug" : "info";

const formatDev = (level: LogLevel, msg: string, data?: Record<string, unknown>) => {
  const time = new Date().toLocaleTimeString();
  const tag = level.toUpperCase().padEnd(5);
  const extra = data ? " " + Object.entries(data).map(([k, v]) => `${k}=${v}`).join(" ") : "";
  return `${time} ${tag} ${msg}${extra}`;
};

const formatJson = (level: LogLevel, msg: string, data?: Record<string, unknown>) => {
  return JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...data });
};

const log = (level: LogLevel, msg: string, data?: Record<string, unknown>) => {
  if (LEVELS[level] < LEVELS[currentLevel]) return;

  const output = isDev ? formatDev(level, msg, data) : formatJson(level, msg, data);
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(output);
};

const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
};

export default logger;
