import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Builder, By, error, until, type Locator, type WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { Select } from 'selenium-webdriver/lib/select.js';
import { parseCourses, parseSubjects, type ScrapedCourse } from './parser.js';
import { publishCourses } from './publish.js';

const waitMs = 10_000;
const timetable = '/html/body/div[3]/table[1]/tbody/tr[3]/td[2]/span/ul/li[1]/a[3]';
const submit = '/html/body/div[3]/form/table[2]/tbody/tr[5]/td/input[1]';
const results = "div[width='1205'] > table[width='1200'] > tbody";
const returnToSearch = '//input[@type="submit" and @value="Return to Search" and @title="Click to go back to the Search Criteria page"]';

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

export async function scrapeCourses(driver: WebDriver, credentials: { username: string; password: string }): Promise<ScrapedCourse[]> {
  const located = (locator: Locator) => driver.wait(until.elementLocated(locator), waitMs);
  const clickable = async (locator: Locator) => {
    const element = await located(locator);
    await driver.wait(async () => await element.isDisplayed() && await element.isEnabled(), waitMs);
    return element;
  };

  await driver.get('https://central.carleton.ca/');
  await (await located(By.id('userNameInput'))).sendKeys(credentials.username);
  await (await located(By.id('passwordInput'))).sendKeys(credentials.password);
  await (await clickable(By.id('submitButton'))).click();
  await (await clickable(By.xpath(timetable))).click();
  await new Select(await located(By.id('term_code'))).selectByVisibleText('Summer 2025 (May-August)');
  await driver.sleep(3000);
  await (await clickable(By.xpath('//*[@id="ws_div"]/input[1]'))).click();
  await driver.sleep(3000);
  const subjects = parseSubjects(await (await driver.findElement(By.id('subj_id'))).getAttribute('innerHTML') ?? '');
  const courses: ScrapedCourse[] = [];

  for (const subject of subjects) {
    const button = await located(By.xpath(submit));
    await driver.executeScript("document.getElementById('subj_id').value = arguments[0];", subject);
    await button.click();
    let html = '';
    try {
      html = await (await located(By.css(results))).getAttribute('innerHTML') ?? '';
    } catch (failure) {
      if (!(failure instanceof error.TimeoutError) && !(failure instanceof error.NoSuchElementError)) throw failure;
    }
    await (await located(By.xpath(returnToSearch))).click();
    const parsed = parseCourses(html);
    courses.push(...parsed);
    console.log('----------------------');
    console.log(`${subject} has ${parsed.length} classes`);
  }
  return courses;
}

export async function runScrape(signal?: AbortSignal) {
  const credentials = readCredentials();
  signal?.throwIfAborted();
  const driver = await createDriver();
  let closing: Promise<void> | undefined;
  const close = () => closing ??= driver.quit();
  const abort = () => { void close().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const courses = await scrapeCourses(driver, credentials);
    signal?.throwIfAborted();
    return await publishCourses(courses);
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
