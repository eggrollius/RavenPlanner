import { chromium, expect, test } from '@playwright/test';
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

test('keeps AI and manual workspaces separate and scopes chat state by term', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Department').fill('COMP');
  await page.getByLabel('Course number').fill('1405');
  await page.getByRole('button', { name: 'Add course' }).click();
  await expect(page.getByRole('button', { name: 'Remove COMP 1405' })).toBeVisible();
  await page.getByRole('button', { name: /AI advisor/ }).click();
  await expect(page.getByLabel('AI academic advisor')).toBeVisible();
  await expect(page.getByLabel('Department')).toBeHidden();
  await expect(page.getByRole('button', { name: /Send message/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Manual planner' }).click();
  await expect(page.getByRole('button', { name: 'Remove COMP 1405' })).toBeVisible();
  await page.getByRole('button', { name: /AI advisor/ }).click();
  await page.getByRole('button', { name: 'Academic term: Fall 2026' }).click();
  await page.getByRole('option', { name: 'Summer 2026' }).click();
  await expect(page.getByText('A timetable, in your own words.')).toBeVisible();
});

// Opt-in: uses real GGUF weights and real WASM CPU inference, never a mocked model.
// Place smol.gguf in .local/models and set RAVEN_AI_E2E=1. No large CI download.
test('real local model completes profile → clarification → schedule → refinement', async ({ baseURL }, testInfo) => {
  test.skip(!process.env.RAVEN_AI_E2E, 'Opt-in CPU model test: see docs/local-advisor.md');
  test.setTimeout(900000);
  const modelPath = path.resolve('.local/models/smol.gguf');
  const size = statSync(modelPath).size;
  // Stream weights over loopback. Sending hundreds of MB through CDP's
  // route.fulfill body unnecessarily duplicates weights in browser memory.
  const modelServer = createServer((request, response) => {
    response.writeHead(200, { 'content-length': size, 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' });
    if (request.method === 'HEAD') return response.end();
    const stream = createReadStream(modelPath);
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  });
  await new Promise<void>((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
  const modelPort = (modelServer.address() as { port: number }).port;
  // Persistent profiles exercise the on-disk cache rather than incognito OPFS.
  const context = await chromium.launchPersistentContext(testInfo.outputPath('browser-profile'), { baseURL, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  const page = await context.newPage();
  try {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('https://huggingface.co/**/raw/**', (route) => route.fulfill({ body: '', headers: { 'access-control-allow-origin': '*' } }));
    await page.route('https://huggingface.co/**/resolve/**/SmolLM2-360M-Instruct-Q4_K_M.gguf', (route) => route.fulfill({ status: 307, headers: { location: `http://127.0.0.1:${modelPort}/smol.gguf`, 'access-control-allow-origin': '*' } }));
    await page.goto('/');
    await page.getByRole('button', { name: /AI advisor/ }).click();
    await page.getByRole('button', { name: 'Load model' }).click();
    await Promise.race([
      page.getByRole('button', { name: 'Model ready' }).waitFor({ state: 'visible', timeout: 180000 }),
      page.getByRole('alert').waitFor({ state: 'visible', timeout: 180000 }).then(async () => { throw new Error(await page.getByRole('alert').innerText()); }),
    ]);
    console.log('Local AI E2E: real SmolLM2 model loaded on CPU.');
    const timings: { message: string; ms: number }[] = [];
    const externalRequests: string[] = [];
    page.on('request', (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:5174') && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(request.url())) externalRequests.push(request.url()); });
    const send = async (text: string) => {
      const started = Date.now();
      await page.getByLabel('Message the advisor').fill(text);
      await page.getByRole('button', { name: /Send message/ }).click();
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden({ timeout: 190000 });
      await expect(page.getByRole('alert')).toHaveCount(0);
      timings.push({ message: text, ms: Date.now() - started });
      console.log(`Local AI E2E: turn ${timings.length} completed in ${timings.at(-1)!.ms} ms.`);
    };
    await send("I'm a 4th-year CS student. Plan my schedule. I want Fridays off, I like geology electives, and I hate Professor X.");
    await expect(page.getByLabel('Saved planning state')).toContainText('Year 4');
    await expect(page.getByLabel('Saved planning state')).toContainText('Fri off');
    await expect(page.getByRole('log')).toContainText('eligible');
    await send('I am eligible for COMP 1405, MATH 1007 and ERTH 1006. Take these three courses.');
    await expect(page.locator('.advisor .class-block').filter({ hasText: 'ERTH 1006' }).first()).toBeVisible();
    await expect(page.locator('.advisor .day-column').nth(4).locator('.class-block')).toHaveCount(0);
    const tuesdayLoad = () => page.locator('.advisor .day-column').nth(1).locator('.class-block').evaluateAll((blocks) => Math.round(blocks.reduce((sum, block) => sum + Number.parseFloat((block as HTMLElement).style.height) * 9, 0)));
    const before = await tuesdayLoad();
    await send('Make my Tuesdays lighter, but keep my geology elective.');
    await expect(page.getByLabel('Saved planning state')).toContainText('Pinned · ERTH 1006');
    await expect(page.getByLabel('Saved planning state')).toContainText('Lighter Tue');
    await expect(page.getByLabel('Saved planning state')).toContainText('Fri off');
    await expect(page.locator('.advisor .day-column').nth(4).locator('.class-block')).toHaveCount(0);
    expect(await tuesdayLoad()).toBeLessThan(before);
    await page.screenshot({ path: testInfo.outputPath('local-advisor-desktop.png'), fullPage: true });
    await page.reload();
    await page.getByRole('button', { name: /AI advisor/ }).click();
    await expect(page.getByLabel('Saved planning state')).toContainText('Pinned · ERTH 1006');
    await expect(page.locator('.advisor .class-block').first()).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('log').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.screenshot({ path: testInfo.outputPath('local-advisor-mobile.png'), fullPage: true });
    expect(errors).toEqual([]);
    expect(externalRequests).toEqual([]);
    await testInfo.attach('workflow-metrics', { body: JSON.stringify({ model: 'SmolLM2-360M-Instruct-Q4_K_M', timings, tuesdayMinutesBefore: before, tuesdayMinutesAfter: await tuesdayLoad(), externalAIRequests: externalRequests, pageErrors: errors, reloadRestored: true }, null, 2), contentType: 'application/json' });
  } finally {
    await context.close().catch(() => {});
    await new Promise<void>((resolve) => modelServer.close(() => resolve()));
  }
});
