import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshInterval, runWorker } from './worker.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('worker lifecycle', () => {
  it('defaults to a daily refresh and rejects intervals that would cause rapid timer overflows', () => {
    vi.stubEnv('RAVEN_SCRAPE_INTERVAL_SECONDS', undefined);
    expect(refreshInterval()).toBe(86_400_000);
    expect(refreshInterval('60')).toBe(60_000);
    for (const value of ['', '0', '-1', 'NaN', '1.5', '2147484']) expect(() => refreshInterval(value)).toThrow();
  });

  it('runs immediately, waits between runs, retries failures, and stops promptly during the wait', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const controller = new AbortController();
    const scrape = vi.fn().mockRejectedValueOnce(new Error('temporary outage')).mockResolvedValue(undefined);
    const running = runWorker(controller.signal, 1000, scrape);
    await vi.advanceTimersByTimeAsync(0);
    expect(scrape).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('RavenData scrape failed: temporary outage');
    await vi.advanceTimersByTimeAsync(999);
    expect(scrape).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(scrape).toHaveBeenCalledTimes(2);
    controller.abort();
    await running;
    await vi.advanceTimersByTimeAsync(5000);
    expect(scrape).toHaveBeenCalledTimes(2);
  });

  it('never overlaps scrapes and forwards shutdown to the current scrape', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const scrape = vi.fn((signal: AbortSignal) => new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })));
    const running = runWorker(controller.signal, 1000, scrape);
    await vi.advanceTimersByTimeAsync(5000);
    expect(scrape).toHaveBeenCalledExactlyOnceWith(controller.signal);
    controller.abort();
    await running;
    expect(scrape).toHaveBeenCalledTimes(1);
  });
});
