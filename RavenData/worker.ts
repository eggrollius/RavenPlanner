import { pathToFileURL } from 'node:url';
import { readCredentials, runScrape } from './scrape.js';

export function refreshInterval(value = process.env.RAVEN_SCRAPE_INTERVAL_SECONDS ?? '86400') {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > 2_147_483) {
    throw new Error('RAVEN_SCRAPE_INTERVAL_SECONDS must be an integer between 1 and 2147483.');
  }
  return seconds * 1000;
}

function waitForRefresh(intervalMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(finish, intervalMs);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

export async function runWorker(signal: AbortSignal, intervalMs = refreshInterval(), scrape: (signal: AbortSignal) => Promise<unknown> = runScrape) {
  while (!signal.aborted) {
    try {
      await scrape(signal);
    } catch (failure) {
      if (!signal.aborted) console.error(`RavenData scrape failed: ${failure instanceof Error ? failure.message : failure}`);
    }
    if (signal.aborted) break;
    await waitForRefresh(intervalMs, signal);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  try {
    readCredentials();
    await runWorker(controller.signal);
  } catch (failure) {
    console.error(`Error: ${failure instanceof Error ? failure.message : failure}`);
    process.exitCode = 1;
  }
}
