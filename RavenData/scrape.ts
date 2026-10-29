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

const timetable = '/html/body/div[3]/table[1]/tbody/tr[3]/td[2]/span/ul/li[1]/a[3]';
const submit = '/html/body/div[3]/form/table[2]/tbody/tr[5]/td/input[1]';
const results = "div[width='1205'] > table[width='1200'] > tbody";
const returnToSearch = '//input[@type="submit" and @value="Return to Search" and @title="Click to go back to the Search Criteria page"]';

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
      const [button] = await driver.findElements(By.xpath(submit));
      if (subjects && button && await subjects.isDisplayed() && await button.isDisplayed() && await button.isEnabled()) return true;
      if (!returning) {
        const [back] = await driver.findElements(By.xpath(returnToSearch));
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

export async function scrapeSubjects(subjects: string[], scrapeSubject: (subject: string) => Promise<ScrapedCourse[]>, signal?: AbortSignal, log: ScrapeLog = noLog) {
  const courses: ScrapedCourse[] = [];
  const failedSubjects: string[] = [];
  for (const subject of subjects) {
    signal?.throwIfAborted();
    const started = Date.now();
    log('subject.started', { subject });
    try {
      const parsed = await scrapeSubject(subject);
      courses.push(...parsed);
      log('subject.completed', { subject, courses: parsed.length, elapsedMs: Date.now() - started });
      console.log('----------------------');
      console.log(`${subject} has ${parsed.length} classes`);
    } catch (failure) {
      signal?.throwIfAborted();
      failedSubjects.push(subject);
      log('subject.failed', { subject, elapsedMs: Date.now() - started, error: failureDetails(failure) });
      console.error(`Skipping subject ${subject}: ${failure instanceof Error ? failure.message : failure}`);
    }
  }
  console.log(`Subjects completed: ${subjects.length - failedSubjects.length}; failed: ${failedSubjects.length}${failedSubjects.length ? ` (${failedSubjects.join(', ')})` : ''}.`);
  log('subjects.completed', { completed: subjects.length - failedSubjects.length, failedSubjects, courses: courses.length });
  return courses;
}

export function readCredentials() {
  const username = process.env.CARLETON_CENTRAL_USERNAME;
  const password = process.env.CARLETON_CENTRAL_PASSWORD;
  if (!username || !password) throw new Error('Environment variables CARLETON_CENTRAL_USERNAME and CARLETON_CENTRAL_PASSWORD must be set.');
  return { username, password };
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

async function openTimetable(driver: WebDriver, credentials: { username: string; password: string }, signal?: AbortSignal, log: ScrapeLog = noLog) {
  const act = <T>(locator: Locator, action: (element: WebElement) => Promise<T>, clickable: boolean, description: string) => withFreshElement(driver, locator, action, clickable, description, log);
  const click = (locator: Locator, description: string) => act(locator, (element) => element.click(), true, description);
  signal?.throwIfAborted();
  log('navigation.started', { page: 'https://central.carleton.ca/' });
  await driver.get('https://central.carleton.ca/');
  log('navigation.completed', { page: safePageUrl(await driver.getCurrentUrl()) });
  // Reuse the signed-in session when switching terms or recovering navigation.
  const needsLogin = await waitForBrowser(driver, 'waiting for the Carleton Central login form or signed-in timetable menu', async () => {
    try {
      if ((await driver.findElements(By.id('userNameInput'))).length) return { login: true };
      if ((await driver.findElements(By.xpath(timetable))).length) return { login: false };
      return false;
    } catch (failure) {
      if (transientElementFailure(failure)) return false;
      throw failure;
    }
  }, log);
  log('login.state', { loginRequired: Boolean(needsLogin && needsLogin.login) });
  if (needsLogin && needsLogin.login) {
    await act(By.id('userNameInput'), async (element) => { await element.clear(); await element.sendKeys(credentials.username); }, true, 'entering the Carleton Central username');
    await act(By.id('passwordInput'), async (element) => { await element.clear(); await element.sendKeys(credentials.password); }, true, 'entering the Carleton Central password');
    await click(By.id('submitButton'), 'submitting the Carleton Central login form');
  }
  await click(By.xpath(timetable), 'waiting for the signed-in timetable link');
}

export async function scrapeCourses(driver: WebDriver, credentials: { username: string; password: string }, catalog = readCatalog(), signal?: AbortSignal, log: ScrapeLog = noLog): Promise<ScrapedCourse[]> {
  const act = <T>(locator: Locator, action: (element: WebElement) => Promise<T>, clickable: boolean, description: string) => withFreshElement(driver, locator, action, clickable, description, log);
  const click = (locator: Locator, description: string) => act(locator, (element) => element.click(), true, description);
  const openSearch = async () => {
    await openTimetable(driver, credentials, signal, log);
    await act(By.id('term_code'), (element) => selectCatalogTerm(new Select(element), catalog), false, 'selecting the catalog term');
    log('catalog.selected', { ...catalog });
    await driver.sleep(3000);
    await click(By.xpath('//*[@id="ws_div"]/input[1]'), 'opening the subject search form');
    await driver.sleep(3000);
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
    await click(By.xpath(submit), `submitting the search for ${subject}`);
    let html = '';
    try {
      html = await act(By.css(results), (element) => element.getAttribute('innerHTML'), false, `reading results for ${subject}`) ?? '';
    } catch (failure) {
      if (!(failure instanceof error.TimeoutError) && !(failure instanceof error.NoSuchElementError)) throw failure;
      // A real empty-results page has a return button and no results table.
      // Exhausted stale-element retries or an unexpected page are failures.
      if ((await driver.findElements(By.css(results))).length || !(await driver.findElements(By.xpath(returnToSearch))).length) throw failure;
    }
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
  return { completed, failed };
}

export async function runScrape(signal?: AbortSignal, options: { dryRun?: boolean } = {}) {
  const { file, log } = createScrapeLogger();
  const started = Date.now();
  console.log(`RavenData debug log: ${file}`);
  log('scrape.started', { dryRun: Boolean(options.dryRun) });
  try {
    const credentials = readCredentials();
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
      await openTimetable(driver, credentials, signal, log);
      const catalogs = await withFreshElement(driver, By.id('term_code'), (element) => availableCatalogs(new Select(element)), false, 'discovering available catalog terms', log);
      log('catalogs.loaded', { catalogs });
      let scrapedCourses = 0;
      const result = await scrapeCatalogs(catalogs, async (selectedCatalog) => {
        const courses = await scrapeCourses(driver, credentials, selectedCatalog, signal, log);
        signal?.throwIfAborted();
        scrapedCourses += courses.length;
        if (options.dryRun) {
          console.log(`Dry run: scraped ${courses.length} courses for ${selectedCatalog.term} ${selectedCatalog.year}; publishing skipped.`);
          log('publish.skipped', { catalog: selectedCatalog, courses: courses.length, dryRun: true });
          return;
        }
        log('publish.started', { catalog: selectedCatalog, courses: courses.length });
        const published = await publishCourses(courses, undefined, (message) => { console.log(message); log('publish.message', { catalog: selectedCatalog, message }); }, selectedCatalog);
        log('publish.completed', { catalog: selectedCatalog, ...published });
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
