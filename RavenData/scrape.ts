import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Builder, By, error, type Locator, type WebDriver, type WebElement } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { Select } from 'selenium-webdriver/lib/select.js';
import { parseCourses, parseSubjects, type ScrapedCourse } from './parser.js';
import { publishCourses } from './publish.js';
import { readCatalog } from '../server/catalog.js';

const waitMs = 10_000;
const timetable = '/html/body/div[3]/table[1]/tbody/tr[3]/td[2]/span/ul/li[1]/a[3]';
const submit = '/html/body/div[3]/form/table[2]/tbody/tr[5]/td/input[1]';
const results = "div[width='1205'] > table[width='1200'] > tbody";
const returnToSearch = '//input[@type="submit" and @value="Return to Search" and @title="Click to go back to the Search Criteria page"]';

function transientElementFailure(failure: unknown) {
  return failure instanceof error.StaleElementReferenceError
    || failure instanceof error.NoSuchElementError
    || failure instanceof error.ElementNotInteractableError
    || failure instanceof error.ElementClickInterceptedError;
}

export async function withFreshElement<T>(driver: WebDriver, locator: Locator, action: (element: WebElement) => Promise<T>, clickable = false) {
  const result = await driver.wait(async () => {
    try {
      const element = await driver.findElement(locator);
      if (clickable && (!(await element.isDisplayed()) || !(await element.isEnabled()))) return false;
      // Find and act in the same poll. A stale handle is never reused on retry.
      return { value: await action(element) };
    } catch (failure) {
      if (transientElementFailure(failure)) return false;
      throw failure;
    }
  }, waitMs);
  if (!result) throw new Error('Browser action did not complete');
  return result.value;
}

async function waitForSearch(driver: WebDriver) {
  let returning = false;
  await driver.wait(async () => {
    try {
      const [subjects] = await driver.findElements(By.id('subj_id'));
      const [button] = await driver.findElements(By.xpath(submit));
      if (subjects && button && await subjects.isDisplayed() && await button.isDisplayed() && await button.isEnabled()) return true;
      if (!returning) {
        const [back] = await driver.findElements(By.xpath(returnToSearch));
        if (back && await back.isDisplayed() && await back.isEnabled()) {
          await back.click();
          returning = true;
        }
      }
      return false;
    } catch (failure) {
      if (transientElementFailure(failure)) return false;
      throw failure;
    }
  }, waitMs);
}

export async function scrapeSubjects(subjects: string[], scrapeSubject: (subject: string) => Promise<ScrapedCourse[]>, signal?: AbortSignal) {
  const courses: ScrapedCourse[] = [];
  const failedSubjects: string[] = [];
  for (const subject of subjects) {
    signal?.throwIfAborted();
    try {
      const parsed = await scrapeSubject(subject);
      courses.push(...parsed);
      console.log('----------------------');
      console.log(`${subject} has ${parsed.length} classes`);
    } catch (failure) {
      signal?.throwIfAborted();
      failedSubjects.push(subject);
      console.error(`Skipping subject ${subject}: ${failure instanceof Error ? failure.message : failure}`);
    }
  }
  console.log(`Subjects completed: ${subjects.length - failedSubjects.length}; failed: ${failedSubjects.length}${failedSubjects.length ? ` (${failedSubjects.join(', ')})` : ''}.`);
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

export async function scrapeCourses(driver: WebDriver, credentials: { username: string; password: string }, catalog = readCatalog(), signal?: AbortSignal): Promise<ScrapedCourse[]> {
  const click = (locator: Locator) => withFreshElement(driver, locator, (element) => element.click(), true);
  const openSearch = async () => {
    signal?.throwIfAborted();
    await driver.get('https://central.carleton.ca/');
    // Recovery can return to a session that is already signed in.
    const needsLogin = await driver.wait(async () => {
      try {
        if ((await driver.findElements(By.id('userNameInput'))).length) return { login: true };
        if ((await driver.findElements(By.xpath(timetable))).length) return { login: false };
        return false;
      } catch (failure) {
        if (transientElementFailure(failure)) return false;
        throw failure;
      }
    }, waitMs);
    if (needsLogin && needsLogin.login) {
      await withFreshElement(driver, By.id('userNameInput'), async (element) => { await element.clear(); await element.sendKeys(credentials.username); }, true);
      await withFreshElement(driver, By.id('passwordInput'), async (element) => { await element.clear(); await element.sendKeys(credentials.password); }, true);
      await click(By.id('submitButton'));
    }
    await click(By.xpath(timetable));
    await withFreshElement(driver, By.id('term_code'), (element) => selectCatalogTerm(new Select(element), catalog));
    await driver.sleep(3000);
    await click(By.xpath('//*[@id="ws_div"]/input[1]'));
    await driver.sleep(3000);
    await waitForSearch(driver);
  };

  await openSearch();
  const subjects = parseSubjects(await withFreshElement(driver, By.id('subj_id'), (element) => element.getAttribute('innerHTML')) ?? '');

  return scrapeSubjects(subjects, async (subject) => {
    try {
      await waitForSearch(driver);
    } catch (failure) {
      signal?.throwIfAborted();
      console.warn(`Recovering search page before ${subject}: ${failure instanceof Error ? failure.message : failure}`);
      await openSearch();
    }
    signal?.throwIfAborted();
    const selected = await withFreshElement(driver, By.id('subj_id'), (element) => driver.executeScript('arguments[0].value = arguments[1]; return arguments[0].value;', element, subject));
    if (selected !== subject) throw new Error(`Subject ${subject} is no longer available in the search form`);
    // Locate the button after selecting the subject, since the DOM may change.
    await click(By.xpath(submit));
    let html = '';
    try {
      html = await withFreshElement(driver, By.css(results), (element) => element.getAttribute('innerHTML')) ?? '';
    } catch (failure) {
      if (!(failure instanceof error.TimeoutError) && !(failure instanceof error.NoSuchElementError)) throw failure;
      // A real empty-results page has a return button and no results table.
      // Exhausted stale-element retries or an unexpected page are failures.
      if ((await driver.findElements(By.css(results))).length || !(await driver.findElements(By.xpath(returnToSearch))).length) throw failure;
    }
    // Retain parsed courses before navigating away, even if recovery later fails.
    return parseCourses(html);
  }, signal);
}

export async function runScrape(signal?: AbortSignal) {
  const credentials = readCredentials();
  const catalog = readCatalog();
  signal?.throwIfAborted();
  const driver = await createDriver();
  let closing: Promise<void> | undefined;
  const close = () => closing ??= driver.quit();
  const abort = () => { void close().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const courses = await scrapeCourses(driver, credentials, catalog, signal);
    signal?.throwIfAborted();
    return await publishCourses(courses, undefined, undefined, catalog);
  } finally {
    signal?.removeEventListener('abort', abort);
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  runScrape(controller.signal).catch((failure: unknown) => {
    if (!controller.signal.aborted) {
      console.error(`Error: ${failure instanceof Error ? failure.message : failure}`);
      process.exitCode = 1;
    }
  });
}
