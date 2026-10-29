import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export type ScrapeLog = (event: string, details?: Record<string, unknown>) => void;
export const noLog: ScrapeLog = () => undefined;

export function safePageUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'about:', 'chrome-error:'].includes(url.protocol)) return `${url.protocol} page`;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return 'unavailable';
  }
}

export function failureDetails(failure: unknown) {
  return failure instanceof Error
    ? { name: failure.name, message: failure.message, stack: failure.stack }
    : { message: String(failure) };
}

export function createScrapeLogger(env: NodeJS.ProcessEnv = process.env) {
  const file = resolve(env.RAVEN_SCRAPE_LOG_FILE || 'logs/scrape.jsonl');
  const runId = randomUUID();
  const secrets = [env.CARLETON_CENTRAL_USERNAME, env.CARLETON_CENTRAL_PASSWORD]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => [value, encodeURIComponent(value)])
    .sort((a, b) => b.length - a.length);
  const redact = (_key: string, value: unknown) => {
    if (typeof value !== 'string') return value;
    let redacted = value;
    for (const secret of secrets) redacted = redacted.split(secret).join('[REDACTED]');
    return redacted.replace(/https?:\/\/[^\s"<>]+/g, safePageUrl);
  };
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  // Verify the path before launching Chrome; new log files are owner-only.
  appendFileSync(file, '', { mode: 0o600 });
  let writable = true;
  const log: ScrapeLog = (event, details = {}) => {
    if (!writable) return;
    try {
      appendFileSync(file, `${JSON.stringify({ time: new Date().toISOString(), runId, event, ...details }, redact)}\n`, { mode: 0o600 });
    } catch {
      writable = false;
      console.error('RavenData could not append to its debug log; continuing with console output.');
    }
  };
  return { file, log };
}
