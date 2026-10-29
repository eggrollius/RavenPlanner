import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Builder, By, error, type Locator, type WebDriver, type WebElement } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { Select } from 'selenium-webdriver/lib/select.js';
import { parseCourses, parseSubjects, type ScrapedCourse } from './parser.js';
import { publishCourses } from './publish.js';
import { catalogFromCode, readCatalog } from '../server/catalog.js';
import { createScrapeLogger, failureDetails, noLog, safePageUrl, type ScrapeLog } from './logging.js';

const timetableUrl = 'https://central.carleton.ca/prod/bwysched.p_select_term?wsea_code=EXT';
const submit = 'input[type="submit"][value="Search"]';
const results = 'form[action$="bwysched.p_list_sections_chk"] div[style*="overflow"] > table > tbody';
const returnToSearch = 'input[type="submit"][value="Return to Search"]';

export function browserWaitMs(value = process.env.RAVEN_BROWSER_WAIT_MS ?? '30000') {
  const milliseconds = Number(value);
  if (!Number.isInteger(milliseconds) || milliseconds <= 0 || milliseconds > 300_000) {
    throw new Error('RAVEN_BROWSER_WAIT_MS must be an integer between 1 and 300000.');
  }
  return milliseconds;
}

async function waitForBrowser<T>(driver: WebDriver, description: string, condition: () => Promise<T | false>, log: ScrapeLog = noLog) {
  const timeoutMs = browserWaitMs();
  const started = Date.now();
  let polls = 0;
  log('browser.wait.started', { step: description, timeoutMs });
  try {
    const result = await driver.wait(async () => {
      polls += 1;
      return condition();
    }, timeoutMs, description);
    log('browser.wait.completed', { step: description, elapsedMs: Date.now() - started, polls });
    return result;
  } catch (failure) {
    if (!(failure instanceof error.TimeoutError)) {
      log('browser.wait.failed', { step: description, elapsedMs: Date.now() - started, polls, error: failureDetails(failure) });
      throw failure;
    }
    // Diagnostic failures must not replace the timeout. Omit URL credentials,
    // query strings and fragments, which can contain SSO tokens.
    const [location, title] = await Promise.allSettled([
      Promise.resolve().then(() => driver.getCurrentUrl()),
      Promise.resolve().then(() => driver.getTitle()),
    ]);
    const page = location.status === 'fulfilled' ? safePageUrl(location.value) : 'unavailable';
    const pageTitle = title.status === 'fulfilled' ? JSON.stringify(title.value.slice(0, 200)) : 'unavailable';
    log('browser.wait.timed_out', { step: description, timeoutMs, elapsedMs: Date.now() - started, polls, page, title: pageTitle });
    throw new error.TimeoutError(`Timed out after ${timeoutMs}ms while ${description}. Page: ${page}; title: ${pageTitle}.`);
  }
}

function transientElementFailure(failure: unknown) {
  return failure instanceof error.StaleElementReferenceError
    || failure instanceof error.NoSuchElementError
    || failure instanceof error.ElementNotInteractableError
    || failure instanceof error.ElementClickInterceptedError;
}

export async function withFreshElement<T>(driver: WebDriver, locator: Locator, action: (element: WebElement) => Promise<T>, clickable = false, description = `waiting for ${locator}`, log: ScrapeLog = noLog) {
  const result = await waitForBrowser(driver, description, async () => {
    try {
      const element = await driver.findElement(locator);
      if (clickable && (!(await element.isDisplayed()) || !(await element.isEnabled()))) return false;
      // Find and act in the same poll. A stale handle is never reused on retry.
      return { value: await action(element) };
    } catch (failure) {
      if (transientElementFailure(failure)) {
        log('browser.element.retry', { step: description, reason: (failure as Error).name });
        return false;
      }
      throw failure;
    }
  }, log);
  if (!result) throw new Error('Browser action did not complete');
  return result.value;
}

async function waitForSearch(driver: WebDriver, log: ScrapeLog = noLog) {
  let returning = false;
  await waitForBrowser(driver, 'waiting for the subject search form or Return to Search button', async () => {
    try {
      const [subjects] = await driver.findElements(By.id('subj_id'));
      const [button] = await driver.findElements(By.css(submit));
      if (subjects && button && await subjects.isDisplayed() && await button.isDisplayed() && await button.isEnabled()) return true;
      if (!returning) {
        const [back] = await driver.findElements(By.css(returnToSearch));
        if (back && await back.isDisplayed() && await back.isEnabled()) {
          log('search.returning');
          await back.click();
          returning = true;
        }
      }
      return false;
    } catch (failure) {
      if (transientElementFailure(failure)) return false;
      throw failure;
    }
  }, log);
}

export async function readSubjectResults(driver: WebDriver, subject: string, log: ScrapeLog = noLog) {
  const result = await waitForBrowser(driver, `reading results for ${subject}`, async () => {
    try {
      // Inspect both markers in one DOM snapshot. Separate WebDriver calls can
      // straddle navigation and mistake a populated result page for an empty one.
      return await driver.executeScript<{ html: string } | null>(`
        if (document.readyState !== 'complete') return null;
        const table = document.querySelector(arguments[0]);
        if (table) return { html: table.innerHTML };
        if (document.querySelector(arguments[1])) return { html: '' };
        return null;
      `, results, returnToSearch) ?? false;
    } catch (failure) {
      if (transientElementFailure(failure)) return false;
      throw failure;
    }
  }, log);
  if (!result) throw new Error(`No result page for ${subject}`);
  return result.html;
}

export async function scrapeSubjects(subjects: string[], scrapeSubject: (subject: string) => Promise<ScrapedCourse[]>, signal?: AbortSignal, log: ScrapeLog = noLog) {
  const courses: ScrapedCourse[] = [];
  const failedSubjects: string[] = [];
  for (const subject of subjects) {
    signal?.throwIfAborted();
    const started = Date.now();
    log('subject.started', { subject });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const parsed = await scrapeSubject(subject);
        courses.push(...parsed);
        log('subject.completed', { subject, courses: parsed.length, attempts: attempt, elapsedMs: Date.now() - started });
        console.log('----------------------');
        console.log(`${subject} has ${parsed.length} classes`);
        break;
      } catch (failure) {
        signal?.throwIfAborted();
        if (attempt < 3) {
          log('subject.retrying', { subject, attempt, error: failureDetails(failure) });
          console.warn(`Retrying subject ${subject} after attempt ${attempt}: ${failure instanceof Error ? failure.message : failure}`);
          continue;
        }
        failedSubjects.push(subject);
        log('subject.failed', { subject, elapsedMs: Date.now() - started, error: failureDetails(failure) });
        console.error(`Skipping subject ${subject}: ${failure instanceof Error ? failure.message : failure}`);
      }
    }
  }
  console.log(`Subjects completed: ${subjects.length - failedSubjects.length}; failed: ${failedSubjects.length}${failedSubjects.length ? ` (${failedSubjects.join(', ')})` : ''}.`);
  log('subjects.completed', { completed: subjects.length - failedSubjects.length, failedSubjects, courses: courses.length });
  return { courses, failedSubjects };
}

function onPath(name: string) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const binary = join(directory, name);
    try { accessSync(binary, constants.X_OK); return binary; } catch { /* Try the next PATH entry. */ }
  }
}

export async function createDriver(): Promise<WebDriver> {
  browserWaitMs();
  const options = new chrome.Options();
  options.addArguments('--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1920,1080');
  const binary = process.env.GOOGLE_CHROME_BIN || onPath('chrome');
  if (binary) options.setChromeBinaryPath(binary);
  const builder = new Builder().forBrowser('chrome').setChromeOptions(options);
  const driver = process.env.CHROMEDRIVER_PATH || onPath('chromedriver');
  // Use the matched driver supplied by Heroku's Chrome for Testing buildpack.
  if (driver) builder.setChromeService(new chrome.ServiceBuilder(driver));
  return builder.build();
}

export async function selectCatalogTerm(dropdown: Pick<Select, 'getOptions' | 'selectByValue'>, catalog = readCatalog()) {
  const options = await Promise.all((await dropdown.getOptions()).map(async (option) => ({
    value: await option.getAttribute('value'),
    label: await option.getText(),
  })));
  if (!options.some((option) => option.value === catalog.termCode)) {
    const available = options.filter((option) => option.value).map((option) => `${option.label} (${option.value})`).join(', ');
    throw new Error(`Carleton Central does not offer ${catalog.term} ${catalog.year} (${catalog.termCode}). Available terms: ${available || 'none'}. Set ACTIVE_TERM and ACTIVE_YEAR to an offered term.`);
  }
  await dropdown.selectByValue(catalog.termCode);
}

export async function availableCatalogs(dropdown: Pick<Select, 'getOptions'>) {
  const codes = await Promise.all((await dropdown.getOptions()).map((option) => option.getAttribute('value')));
  const catalogs = [...new Set(codes)].flatMap((code) => {
    const catalog = code ? catalogFromCode(code) : undefined;
    return catalog ? [catalog] : [];
  });
  if (!catalogs.length) throw new Error('Carleton Central offers no supported catalog terms.');
  const preferred = readCatalog().termCode;
  return catalogs.sort((a, b) => Number(b.termCode === preferred) - Number(a.termCode === preferred) || b.termCode.localeCompare(a.termCode));
}

async function openTimetable(driver: WebDriver, signal?: AbortSignal, log: ScrapeLog = noLog) {
  signal?.throwIfAborted();
  // The public timetable exposes the catalog without a student SSO session.
  log('navigation.started', { page: timetableUrl });
  await driver.get(timetableUrl);
  log('navigation.completed', { page: safePageUrl(await driver.getCurrentUrl()) });
  await withFreshElement(driver, By.id('term_code'), async () => undefined, true, 'waiting for the public timetable term selector', log);
}

export async function scrapeCourses(driver: WebDriver, catalog = readCatalog(), signal?: AbortSignal, log: ScrapeLog = noLog) {
  const act = <T>(locator: Locator, action: (element: WebElement) => Promise<T>, clickable: boolean, description: string) => withFreshElement(driver, locator, action, clickable, description, log);
  const click = (locator: Locator, description: string) => act(locator, (element) => element.click(), true, description);
  const openSearch = async () => {
    await openTimetable(driver, signal, log);
    await act(By.id('term_code'), (element) => selectCatalogTerm(new Select(element), catalog), false, 'selecting the catalog term');
    log('catalog.selected', { ...catalog });
    await click(By.css('input[type="submit"][value="Proceed to Search"]'), 'opening the subject search form');
    await waitForSearch(driver, log);
  };

  await openSearch();
  const subjects = parseSubjects(await act(By.id('subj_id'), (element) => element.getAttribute('innerHTML'), false, 'reading the available subjects') ?? '');
  log('subjects.loaded', { subjects });

  return scrapeSubjects(subjects, async (subject) => {
    try {
      await waitForSearch(driver, log);
    } catch (failure) {
      signal?.throwIfAborted();
      console.warn(`Recovering search page before ${subject}: ${failure instanceof Error ? failure.message : failure}`);
      log('search.recovering', { subject, error: failureDetails(failure) });
      await openSearch();
    }
    signal?.throwIfAborted();
    const selected = await act(By.id('subj_id'), (element) => driver.executeScript('arguments[0].value = arguments[1]; return arguments[0].value;', element, subject), false, `selecting subject ${subject}`);
    if (selected !== subject) throw new Error(`Subject ${subject} is no longer available in the search form`);
    // Locate the button after selecting the subject, since the DOM may change.
    await click(By.css(submit), `submitting the search for ${subject}`);
    const html = await readSubjectResults(driver, subject, log);
    // Retain parsed courses before navigating away, even if recovery later fails.
    return parseCourses(html);
  }, signal, log);
}

export async function scrapeCatalogs(catalogs: Awaited<ReturnType<typeof availableCatalogs>>, scrape: (catalog: typeof catalogs[number]) => Promise<unknown>, signal?: AbortSignal, log: ScrapeLog = noLog) {
  let completed = 0;
  let failed = 0;
  for (const catalog of catalogs) {
    signal?.throwIfAborted();
    const started = Date.now();
    log('catalog.started', { catalog });
    try {
      console.log(`Refreshing ${catalog.term} ${catalog.year} (${catalog.termCode}).`);
      await scrape(catalog);
      completed += 1;
      log('catalog.completed', { catalog, elapsedMs: Date.now() - started });
    } catch (failure) {
      signal?.throwIfAborted();
      failed += 1;
      log('catalog.failed', { catalog, elapsedMs: Date.now() - started, error: failureDetails(failure) });
      console.error(`Skipping catalog ${catalog.term} ${catalog.year}: ${failure instanceof Error ? failure.message : failure}`);
    }
  }
  log('catalogs.completed', { completed, failed });
  if (!completed) throw new Error('No catalogs could be refreshed.');
  console.log(`Catalogs completed: ${completed}; failed: ${failed}.`);
  if (failed) throw new Error(`${failed} of ${catalogs.length} catalogs could not be fully refreshed.`);
  return { completed, failed };
}

export async function runScrape(signal?: AbortSignal, options: { dryRun?: boolean } = {}) {
  const { file, log } = createScrapeLogger();
  const started = Date.now();
  console.log(`RavenData debug log: ${file}`);
  log('scrape.started', { dryRun: Boolean(options.dryRun) });
  try {
    const catalog = readCatalog();
    signal?.throwIfAborted();
    log('browser.starting', { catalog, timeoutMs: browserWaitMs() });
    const driver = await createDriver();
    log('browser.started');
    let closing: Promise<void> | undefined;
    const close = () => closing ??= driver.quit();
    const abort = () => { void close().catch(() => undefined); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      signal?.throwIfAborted();
      await openTimetable(driver, signal, log);
      const catalogs = await withFreshElement(driver, By.id('term_code'), (element) => availableCatalogs(new Select(element)), false, 'discovering available catalog terms', log);
      log('catalogs.loaded', { catalogs });
      let scrapedCourses = 0;
      const result = await scrapeCatalogs(catalogs, async (selectedCatalog) => {
        const { courses, failedSubjects } = await scrapeCourses(driver, selectedCatalog, signal, log);
        signal?.throwIfAborted();
        scrapedCourses += courses.length;
        let failedOperations = 0;
        if (options.dryRun) {
          console.log(`Dry run: scraped ${courses.length} courses for ${selectedCatalog.term} ${selectedCatalog.year}; publishing skipped.`);
          log('publish.skipped', { catalog: selectedCatalog, courses: courses.length, dryRun: true });
        } else {
          log('publish.started', { catalog: selectedCatalog, courses: courses.length });
          const published = await publishCourses(courses, undefined, (message) => { console.log(message); log('publish.message', { catalog: selectedCatalog, message }); }, selectedCatalog);
          log('publish.completed', { catalog: selectedCatalog, ...published });
          failedOperations = published.failedOperations;
        }
        if (failedSubjects.length || failedOperations) {
          throw new Error(`Incomplete ${selectedCatalog.term} ${selectedCatalog.year} refresh: failed subjects: ${failedSubjects.join(', ') || 'none'}; failed publishing operations: ${failedOperations}.`);
        }
      }, signal, log);
      log('scrape.completed', { ...result, scrapedCourses, dryRun: Boolean(options.dryRun), elapsedMs: Date.now() - started });
      return result;
    } finally {
      signal?.removeEventListener('abort', abort);
      await close();
      log('browser.closed');
    }
  } catch (failure) {
    log(signal?.aborted ? 'scrape.aborted' : 'scrape.failed', { elapsedMs: Date.now() - started, error: failureDetails(failure) });
    throw failure;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  runScrape(controller.signal, { dryRun: process.argv.includes('--dry-run') }).catch((failure: unknown) => {
    if (!controller.signal.aborted) {
      console.error(`Error: ${failure instanceof Error ? failure.message : failure}`);
      process.exitCode = 1;
    }
  });
}
