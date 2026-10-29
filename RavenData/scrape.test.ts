import { By, error, WebDriver, type WebElement } from 'selenium-webdriver';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCatalog } from '../server/catalog.js';
import { availableCatalogs, browserWaitMs, readSubjectResults, scrapeCatalogs, scrapeCourses, scrapeSubjects, selectCatalogTerm, withFreshElement } from './scrape.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function option(value: string, label: string) {
  return { getAttribute: vi.fn().mockResolvedValue(value), getText: vi.fn().mockResolvedValue(label) } as unknown as WebElement;
}

describe('Carleton term selection', () => {
  it('discovers all offered seasons and years, ignores other options, and refreshes the default first', async () => {
    vi.stubEnv('ACTIVE_TERM', 'FALL');
    vi.stubEnv('ACTIVE_YEAR', '2026');
    const dropdown = { getOptions: vi.fn().mockResolvedValue([
      option('', 'Select a term'), option('202630', 'Fall 2026'), option('202620', 'Summer 2026'),
      option('202710', 'Winter 2027'), option('202630', 'Fall again'), option('202640', 'Other'),
    ]) };
    expect(await availableCatalogs(dropdown)).toEqual([
      { term: 'FALL', year: 2026, termCode: '202630' },
      { term: 'WINTER', year: 2027, termCode: '202710' },
      { term: 'SUMMER', year: 2026, termCode: '202620' },
    ]);
  });

  it('does not require the configured default to be offered, and fails clearly if no terms are available', async () => {
    const dropdown = { getOptions: vi.fn().mockResolvedValue([option('202710', 'Winter 2027')]) };
    expect(await availableCatalogs(dropdown)).toEqual([{ term: 'WINTER', year: 2027, termCode: '202710' }]);
    dropdown.getOptions.mockResolvedValue([option('', 'Select a term')]);
    await expect(availableCatalogs(dropdown)).rejects.toThrow('no supported catalog terms');
  });

  it('continues to other catalogs after a failure and stops on shutdown', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const catalogs = [readCatalog({}), readCatalog({ ACTIVE_TERM: 'WINTER', ACTIVE_YEAR: '2027' })];
    const scrape = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(undefined);
    await expect(scrapeCatalogs(catalogs, scrape)).rejects.toThrow('1 of 2 catalogs could not be fully refreshed');
    expect(scrape.mock.calls.map(([catalog]) => catalog.term)).toEqual(['FALL', 'WINTER']);
    await expect(scrapeCatalogs(catalogs, vi.fn().mockRejectedValue(new Error('Offline')))).rejects.toThrow('No catalogs could be refreshed');
    const controller = new AbortController();
    const interrupted = vi.fn(async () => { controller.abort(); throw new Error('Closed'); });
    await expect(scrapeCatalogs(catalogs, interrupted, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(interrupted).toHaveBeenCalledTimes(1);
  });

  it('selects Fall 2026 by its value without depending on the displayed label', async () => {
    vi.stubEnv('ACTIVE_TERM', undefined);
    vi.stubEnv('ACTIVE_YEAR', undefined);
    const dropdown = {
      getOptions: vi.fn().mockResolvedValue([option('202620', 'Summer 2026'), option('202630', 'Fall 2026 (September - December)')]),
      selectByValue: vi.fn().mockResolvedValue(undefined),
    };
    await selectCatalogTerm(dropdown);
    expect(dropdown.selectByValue).toHaveBeenCalledExactlyOnceWith('202630');
  });

  it('honors the configured term and year for future catalog changes', async () => {
    const dropdown = {
      getOptions: vi.fn().mockResolvedValue([option('202630', 'Fall 2026'), option('202710', 'Winter 2027 (Jan-Apr)')]),
      selectByValue: vi.fn().mockResolvedValue(undefined),
    };
    await selectCatalogTerm(dropdown, readCatalog({ ACTIVE_TERM: 'WINTER', ACTIVE_YEAR: '2027' }));
    expect(dropdown.selectByValue).toHaveBeenCalledExactlyOnceWith('202710');
  });

  it('lists available terms when the requested term is unavailable', async () => {
    const dropdown = {
      getOptions: vi.fn().mockResolvedValue([option('', 'Select a term'), option('202710', 'Winter 2027')]),
      selectByValue: vi.fn(),
    };
    await expect(selectCatalogTerm(dropdown, readCatalog({}))).rejects.toThrow('does not offer FALL 2026 (202630). Available terms: Winter 2027 (202710). Set ACTIVE_TERM and ACTIVE_YEAR');
    expect(dropdown.selectByValue).not.toHaveBeenCalled();
  });
});

// Model Selenium's polling without waiting for the real browser timeout.
function pollingDriver(findElement: ReturnType<typeof vi.fn>) {
  return {
    findElement,
    getCurrentUrl: vi.fn().mockResolvedValue('https://central.carleton.ca/'),
    getTitle: vi.fn().mockResolvedValue('Carleton Central'),
    wait: vi.fn(async (condition: () => Promise<unknown>) => {
      for (let poll = 0; poll < 4; poll += 1) {
        const result = await condition();
        if (result) return result;
      }
      throw new error.TimeoutError('Browser action timed out');
    }),
  } as unknown as WebDriver;
}

describe('browser timeouts', () => {
  it('allows slower portal responses by default and validates the configured limit', () => {
    vi.stubEnv('RAVEN_BROWSER_WAIT_MS', undefined);
    expect(browserWaitMs()).toBe(30_000);
    vi.stubEnv('RAVEN_BROWSER_WAIT_MS', '60000');
    expect(browserWaitMs()).toBe(60_000);
    expect(browserWaitMs('300000')).toBe(300_000);
    for (const value of ['', '0', '-1', 'NaN', 'Infinity', '1.5', '300001']) expect(() => browserWaitMs(value)).toThrow('RAVEN_BROWSER_WAIT_MS');
  });

  it('waits through a fifteen-second page transition that exceeded the old limit', async () => {
    vi.useFakeTimers();
    vi.stubEnv('RAVEN_BROWSER_WAIT_MS', undefined);
    const started = Date.now();
    const field = { getAttribute: vi.fn().mockResolvedValue('ready') };
    const driver = pollingDriver(vi.fn(async () => {
      if (Date.now() - started < 15_000) throw new error.NoSuchElementError('still loading');
      return field;
    }));
    // Exercise Selenium's real polling and timeout behavior without Chrome.
    driver.wait = WebDriver.prototype.wait;
    const waiting = withFreshElement(driver, By.id('results'), (element) => element.getAttribute('innerHTML'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(field.getAttribute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(waiting).resolves.toBe('ready');
  });

  it('uses the configured timeout and identifies a blocked step without exposing URL tokens', async () => {
    vi.stubEnv('RAVEN_BROWSER_WAIT_MS', '60000');
    const driver = pollingDriver(vi.fn().mockRejectedValue(new error.NoSuchElementError('missing')));
    vi.mocked(driver.getCurrentUrl).mockResolvedValue('https://user:secret@sso.example/adfs/ls/?SAMLRequest=sensitive#token');
    vi.mocked(driver.getTitle).mockResolvedValue('Verify your identity');
    const waiting = withFreshElement(driver, By.id('menu'), (element) => element.click(), true, 'waiting for the signed-in timetable link');
    await expect(waiting).rejects.toBeInstanceOf(error.TimeoutError);
    await expect(waiting).rejects.toThrow('Timed out after 60000ms while waiting for the signed-in timetable link. Page: https://sso.example/adfs/ls/; title: "Verify your identity".');
    expect(driver.wait).toHaveBeenCalledWith(expect.any(Function), 60_000, 'waiting for the signed-in timetable link');
  });

  it('preserves the timeout when the browser cannot supply diagnostics', async () => {
    const driver = pollingDriver(vi.fn().mockRejectedValue(new error.StaleElementReferenceError('page changed')));
    vi.mocked(driver.getCurrentUrl).mockRejectedValue(new error.NoSuchSessionError('browser closed'));
    vi.mocked(driver.getTitle).mockRejectedValue(new error.NoSuchSessionError('browser closed'));
    await expect(withFreshElement(driver, By.id('search'), (element) => element.click())).rejects.toMatchObject({
      name: 'TimeoutError',
      message: expect.stringContaining('Page: unavailable; title: unavailable.'),
    });
  });

  it.each(['about:blank', 'chrome-error://chromewebdata/'])('identifies a browser error or blank page at %s', async (url) => {
    const driver = pollingDriver(vi.fn().mockRejectedValue(new error.NoSuchElementError('missing')));
    vi.mocked(driver.getCurrentUrl).mockResolvedValue(url);
    await expect(withFreshElement(driver, By.id('search'), (element) => element.click())).rejects.toThrow(`Page: ${url};`);
  });

  it('opens the public timetable without requiring student credentials and diagnoses a missing selector', async () => {
    vi.stubEnv('CARLETON_CENTRAL_USERNAME', undefined);
    vi.stubEnv('CARLETON_CENTRAL_PASSWORD', undefined);
    const driver = Object.assign(pollingDriver(vi.fn().mockRejectedValue(new error.NoSuchElementError('missing'))), {
      get: vi.fn().mockResolvedValue(undefined),
    });
    await expect(scrapeCourses(driver, readCatalog({}))).rejects.toThrow('waiting for the public timetable term selector');
    expect(driver.get).toHaveBeenCalledExactlyOnceWith('https://central.carleton.ca/prod/bwysched.p_select_term?wsea_code=EXT');
  });
});

describe('browser action recovery', () => {
  it('reacquires a button after a stale reference instead of reusing the failed handle', async () => {
    const stale = { isDisplayed: vi.fn().mockResolvedValue(true), isEnabled: vi.fn().mockResolvedValue(true), click: vi.fn().mockRejectedValue(new error.StaleElementReferenceError('page changed')) };
    const fresh = { isDisplayed: vi.fn().mockResolvedValue(true), isEnabled: vi.fn().mockResolvedValue(true), click: vi.fn().mockResolvedValue(undefined) };
    const find = vi.fn().mockResolvedValueOnce(stale).mockResolvedValue(fresh);
    await withFreshElement(pollingDriver(find), By.id('search'), (element) => element.click(), true);
    expect(find).toHaveBeenCalledTimes(2);
    expect(stale.click).toHaveBeenCalledTimes(1);
    expect(fresh.click).toHaveBeenCalledTimes(1);
  });

  it('waits for a missing or disabled element before acting', async () => {
    const disabled = { isDisplayed: vi.fn().mockResolvedValue(true), isEnabled: vi.fn().mockResolvedValue(false), click: vi.fn() };
    const ready = { isDisplayed: vi.fn().mockResolvedValue(true), isEnabled: vi.fn().mockResolvedValue(true), click: vi.fn().mockResolvedValue(undefined) };
    const find = vi.fn().mockRejectedValueOnce(new error.NoSuchElementError('loading')).mockResolvedValueOnce(disabled).mockResolvedValue(ready);
    await withFreshElement(pollingDriver(find), By.id('search'), (element) => element.click(), true);
    expect(disabled.click).not.toHaveBeenCalled();
    expect(ready.click).toHaveBeenCalledTimes(1);
  });

  it('can read empty HTML and does not mistake it for an incomplete wait', async () => {
    const element = { getAttribute: vi.fn().mockResolvedValue('') };
    const find = vi.fn().mockResolvedValue(element);
    expect(await withFreshElement(pollingDriver(find), By.id('results'), (element) => element.getAttribute('innerHTML'))).toBe('');
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('bounds retries and propagates nontransient browser errors immediately', async () => {
    const stale = vi.fn().mockRejectedValue(new error.StaleElementReferenceError('page changed'));
    await expect(withFreshElement(pollingDriver(stale), By.id('search'), (element) => element.click())).rejects.toBeInstanceOf(error.TimeoutError);
    const disconnected = vi.fn().mockRejectedValue(new error.NoSuchSessionError('browser disconnected'));
    await expect(withFreshElement(pollingDriver(disconnected), By.id('search'), (element) => element.click())).rejects.toBeInstanceOf(error.NoSuchSessionError);
    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  it('records the retry and the completed step without logging browser action arguments', async () => {
    const field = { sendKeys: vi.fn().mockResolvedValue(undefined) };
    const find = vi.fn().mockRejectedValueOnce(new error.StaleElementReferenceError('page changed')).mockResolvedValue(field);
    const log = vi.fn();
    await withFreshElement(pollingDriver(find), By.id('password'), (element) => element.sendKeys('test-password'), false, 'entering the password', log);
    expect(log).toHaveBeenCalledWith('browser.element.retry', { step: 'entering the password', reason: 'StaleElementReferenceError' });
    expect(log).toHaveBeenLastCalledWith('browser.wait.completed', { step: 'entering the password', elapsedMs: expect.any(Number), polls: 2 });
    expect(JSON.stringify(log.mock.calls)).not.toContain('test-password');
  });
});

describe('subject fault isolation', () => {
  it('skips a failed ACCS subject and continues through later subjects in order', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const failure = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scrape = vi.fn(async (subject: string) => {
      if (subject === 'ACCS') throw new error.StaleElementReferenceError('stale element not found');
      return [{ crn: subject === 'COMP' ? '1' : '2', course_name: subject }];
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await scrapeSubjects(['ACCS', 'COMP', 'MATH'], scrape)).toEqual({ courses: [{ crn: '1', course_name: 'COMP' }, { crn: '2', course_name: 'MATH' }], failedSubjects: ['ACCS'] });
    expect(scrape.mock.calls.map(([subject]) => subject)).toEqual(['ACCS', 'ACCS', 'ACCS', 'COMP', 'MATH']);
    expect(failure).toHaveBeenCalledWith('Skipping subject ACCS: stale element not found');
    expect(log).toHaveBeenLastCalledWith('Subjects completed: 2; failed: 1 (ACCS).');
  });

  it('preserves earlier results when parsing or navigation fails in a later subject', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scrape = vi.fn(async (subject: string) => {
      if (subject === 'ACCS') throw new Error('Invalid credits');
      if (subject === 'MATH') throw new error.TimeoutError('Unable to return to search');
      return [{ crn: '1', course_name: 'Intro' }];
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await scrapeSubjects(['COMP', 'ACCS', 'MATH'], scrape)).toEqual({ courses: [{ crn: '1', course_name: 'Intro' }], failedSubjects: ['ACCS', 'MATH'] });
  });

  it('retries a transient failure and retains the recovered courses exactly once', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const scrape = vi.fn().mockRejectedValueOnce(new error.TimeoutError('portal unavailable'))
      .mockResolvedValueOnce([{ crn: '1', course_name: 'Recovered' }])
      .mockResolvedValueOnce([{ crn: '2', course_name: 'Next' }]);
    const log = vi.fn();
    expect(await scrapeSubjects(['ACCS', 'COMP'], scrape, undefined, log)).toEqual({
      courses: [{ crn: '1', course_name: 'Recovered' }, { crn: '2', course_name: 'Next' }], failedSubjects: [],
    });
    expect(scrape.mock.calls.map(([subject]) => subject)).toEqual(['ACCS', 'ACCS', 'COMP']);
    expect(log).toHaveBeenCalledWith('subject.retrying', expect.objectContaining({ subject: 'ACCS', attempt: 1 }));
    expect(log).toHaveBeenCalledWith('subject.completed', expect.objectContaining({ subject: 'ACCS', attempts: 2 }));
  });

  it('honors shutdown during a failed subject without starting the next subject', async () => {
    const failure = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const controller = new AbortController();
    const scrape = vi.fn(async () => {
      controller.abort();
      throw new error.NoSuchSessionError('driver closed during shutdown');
    });
    await expect(scrapeSubjects(['ACCS', 'COMP'], scrape, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(scrape).toHaveBeenCalledTimes(1);
    expect(failure).not.toHaveBeenCalled();
  });
});

describe('subject result navigation', () => {
  it('waits for navigation and reads the result markers in one DOM snapshot', async () => {
    const driver = Object.assign(pollingDriver(vi.fn()), {
      executeScript: vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ html: '<tr>current courses</tr>' }),
    });
    expect(await readSubjectResults(driver, 'ACCS')).toBe('<tr>current courses</tr>');
    expect(driver.executeScript).toHaveBeenCalledTimes(2);
    expect(driver.executeScript).toHaveBeenCalledWith(
      expect.stringContaining('table.innerHTML'),
      expect.stringContaining('bwysched.p_list_sections_chk'),
      'input[type="submit"][value="Return to Search"]',
    );
    expect(driver.findElement).not.toHaveBeenCalled();
  });

  it('accepts a completed empty-results page without exhausting the timeout', async () => {
    const driver = Object.assign(pollingDriver(vi.fn()), {
      executeScript: vi.fn().mockResolvedValue({ html: '' }),
    });
    expect(await readSubjectResults(driver, 'ACCS')).toBe('');
    expect(driver.executeScript).toHaveBeenCalledTimes(1);
  });

  it('reports an unexpected page instead of treating it as an empty subject', async () => {
    const driver = Object.assign(pollingDriver(vi.fn()), {
      executeScript: vi.fn().mockResolvedValue(null),
    });
    await expect(readSubjectResults(driver, 'ACCS')).rejects.toThrow('reading results for ACCS');
  });
});
