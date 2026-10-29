import { By, error, type WebDriver, type WebElement } from 'selenium-webdriver';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCatalog } from '../server/catalog.js';
import { availableCatalogs, scrapeCatalogs, scrapeSubjects, selectCatalogTerm, withFreshElement } from './scrape.js';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

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
    expect(await scrapeCatalogs(catalogs, scrape)).toEqual({ completed: 1, failed: 1 });
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

// Model Selenium's polling while avoiding real ten-second waits in unit tests.
function pollingDriver(findElement: ReturnType<typeof vi.fn>) {
  return {
    findElement,
    wait: vi.fn(async (condition: () => Promise<unknown>, timeout: number) => {
      expect(timeout).toBe(10_000);
      for (let poll = 0; poll < 4; poll += 1) {
        const result = await condition();
        if (result) return result;
      }
      throw new error.TimeoutError('Browser action timed out');
    }),
  } as unknown as WebDriver;
}

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
});

describe('subject fault isolation', () => {
  it('skips a failed ACCS subject and continues through later subjects in order', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const failure = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scrape = vi.fn(async (subject: string) => {
      if (subject === 'ACCS') throw new error.StaleElementReferenceError('stale element not found');
      return [{ crn: subject === 'COMP' ? '1' : '2', course_name: subject }];
    });
    expect(await scrapeSubjects(['ACCS', 'COMP', 'MATH'], scrape)).toEqual([{ crn: '1', course_name: 'COMP' }, { crn: '2', course_name: 'MATH' }]);
    expect(scrape.mock.calls.map(([subject]) => subject)).toEqual(['ACCS', 'COMP', 'MATH']);
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
    expect(await scrapeSubjects(['COMP', 'ACCS', 'MATH'], scrape)).toEqual([{ crn: '1', course_name: 'Intro' }]);
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
