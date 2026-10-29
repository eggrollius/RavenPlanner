import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScrapeLogger, failureDetails } from './logging.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function logPath() {
  const directory = mkdtempSync(join(tmpdir(), 'raven-logging-'));
  directories.push(directory);
  return join(directory, 'nested', 'scrape.jsonl');
}

describe('scraper debug file', () => {
  it('appends timestamped events and correlates independent runs without truncating the file', () => {
    const file = logPath();
    const first = createScrapeLogger({ RAVEN_SCRAPE_LOG_FILE: file });
    first.log('browser.wait.started', { step: 'sign-in', timeoutMs: 30000 });
    first.log('browser.wait.completed', { step: 'sign-in', elapsedMs: 123 });
    createScrapeLogger({ RAVEN_SCRAPE_LOG_FILE: file }).log('scrape.started');
    const records = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(records.map((record) => record.event)).toEqual(['browser.wait.started', 'browser.wait.completed', 'scrape.started']);
    expect(records[0]).toMatchObject({ time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), step: 'sign-in', timeoutMs: 30000 });
    expect(records[0].runId).toBe(records[1].runId);
    expect(records[0].runId).not.toBe(records[2].runId);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('redacts entered credentials, encoded secrets, and URL tokens in nested errors', () => {
    const file = logPath();
    const username = 'debug-user@example.com';
    const password = 'test password!?';
    const { log } = createScrapeLogger({ RAVEN_SCRAPE_LOG_FILE: file, CARLETON_CENTRAL_USERNAME: username, CARLETON_CENTRAL_PASSWORD: password });
    log('scrape.failed', {
      error: failureDetails(new Error(`failed for ${username} with ${password} or ${encodeURIComponent(password)}`)),
      page: 'https://url-user:url-password@sso.example/adfs/ls/?SAMLRequest=private-token#session-secret',
    });
    const content = readFileSync(file, 'utf8');
    for (const secret of [username, password, encodeURIComponent(password), 'url-user', 'url-password', 'private-token', 'session-secret']) expect(content).not.toContain(secret);
    expect(JSON.parse(content)).toMatchObject({
      error: { message: 'failed for [REDACTED] with [REDACTED] or [REDACTED]' },
      page: 'https://sso.example/adfs/ls/',
    });
  });

  it('keeps scraping and reports a single console error if the log becomes unwritable', () => {
    const file = logPath();
    const { log } = createScrapeLogger({ RAVEN_SCRAPE_LOG_FILE: file });
    const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    rmSync(join(file, '..'), { recursive: true });
    expect(() => log('browser.started')).not.toThrow();
    expect(() => log('browser.closed')).not.toThrow();
    expect(output).toHaveBeenCalledExactlyOnceWith('RavenData could not append to its debug log; continuing with console output.');
  });
});
