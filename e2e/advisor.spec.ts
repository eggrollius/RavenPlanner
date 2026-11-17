import { expect, test } from '@playwright/test';
import { WebSocket as NodeSocket } from 'ws';
import { emptyPlan } from '../src/advisor/schema';
import type { AdvisorEvent } from '../src/advisor/contracts';

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
  await expect(page.getByRole('button', { name: 'Load model' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Manual planner' }).click();
  await expect(page.getByRole('button', { name: 'Remove COMP 1405' })).toBeVisible();
  await page.getByRole('button', { name: /AI advisor/ }).click();
  await page.getByRole('button', { name: 'Academic term: Fall 2026' }).click();
  await page.getByRole('option', { name: 'Summer 2026' }).click();
  await expect(page.getByText('A timetable, in your own words.')).toBeVisible();
});

test('real server model streams replies, refines a schedule, and serves HTTP concurrently', async ({ page, baseURL, request }, testInfo) => {
  test.skip(!process.env.RAVEN_AI_E2E, 'Opt-in native CPU test; install the server model first.');
  test.setTimeout(600000);
  const errors: string[] = []; const downloads: string[] = [];
  const frames: { event: AdvisorEvent; at: number }[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (req) => { if (/\.gguf|\.wasm|huggingface\.co/.test(req.url())) downloads.push(req.url()); });
  page.on('websocket', (socket) => { if (socket.url().endsWith('/api/advisor')) socket.on('framereceived', ({ payload }) => frames.push({ event: JSON.parse(String(payload)), at: Date.now() })); });
  await page.goto('/');
  await page.getByRole('button', { name: /AI advisor/ }).click();
  await expect(page.getByText('Advisor connected')).toBeVisible();
  const latencies: number[] = [];
  let probe = true;
  const probes = (async () => {
    while (probe) {
      const began = Date.now();
      const responses = await Promise.all([request.get('/api/health'), request.get('/api/course/search?query=ERTH+1006&term=FALL&year=2026')]);
      expect(responses.every((response) => response.ok())).toBe(true);
      latencies.push(Date.now() - began);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();
  const send = async (text: string, exerciseQueue = false) => {
    const offset = frames.length;
    await page.getByLabel('Message the advisor').fill(text);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByLabel('Advisor reply in progress')).toBeVisible({ timeout: 190000 });
    expect(frames.slice(offset).some(({ event }) => event.type === 'delta')).toBe(true);
    expect(frames.slice(offset).some(({ event }) => event.type === 'done')).toBe(false);
    if (exerciseQueue) {
      const origin = new URL(baseURL!).origin;
      const queued = new NodeSocket(`${origin.replace('http:', 'ws:')}/api/advisor`, { origin });
      try {
        await new Promise<void>((resolve, reject) => { queued.once('open', resolve); queued.once('error', reject); });
        const queuedEvents: AdvisorEvent[] = [];
        queued.on('message', (data) => queuedEvents.push(JSON.parse(data.toString())));
        queued.send(JSON.stringify({ type: 'turn', id: 'queued-student', catalog: { term: 'FALL', year: 2026 }, session: { plan: emptyPlan(), messages: [], previousCRNs: [] }, text: 'Take ERTH 1006.' }));
        await expect.poll(() => queuedEvents.some((event) => event.type === 'status' && event.position === 1)).toBe(true);
        queued.close();
        await expect.poll(async () => (await request.get('/api/advisor/status')).json().then((value) => value.queued)).toBe(0);
      } finally { queued.terminate(); }
    }
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden({ timeout: 190000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
    const events = frames.slice(offset).map(({ event }) => event);
    const done = events.find((event) => event.type === 'done');
    expect(done?.type).toBe('done');
    if (done?.type === 'done') expect(events.filter((event) => event.type === 'delta').map((event) => event.text).join('')).toBe(done.result.reply);
  };
  try {
    await send("I'm a 4th-year CS student. I want Fridays off, I like geology electives, and I hate Professor X.", true);
    await expect(page.getByLabel('Saved planning state')).toContainText('Year 4');
    await expect(page.getByRole('log')).toContainText('eligible');
    await send('I am eligible for COMP 1405, MATH 1007 and ERTH 1006. Take these three courses.');
    const tuesdayLoad = () => page.locator('.advisor .day-column').nth(1).locator('.class-block').evaluateAll((blocks) => Math.round(blocks.reduce((sum, block) => sum + Number.parseFloat((block as HTMLElement).style.height) * 9, 0)));
    const before = await tuesdayLoad();
    await send('Make my Tuesdays lighter, but keep my geology elective.');
    await expect(page.getByLabel('Saved planning state')).toContainText('Pinned · ERTH 1006');
    await expect(page.getByLabel('Saved planning state')).toContainText('Lighter Tue');
    await expect(page.getByLabel('Saved planning state')).toContainText('Fri off');
    await expect(page.locator('.advisor .day-column').nth(4).locator('.class-block')).toHaveCount(0);
    expect(await tuesdayLoad()).toBeLessThan(before);
    await page.screenshot({ path: testInfo.outputPath('server-advisor-desktop.png'), fullPage: true });
    await page.reload(); await page.getByRole('button', { name: /AI advisor/ }).click();
    await expect(page.getByLabel('Saved planning state')).toContainText('Pinned · ERTH 1006');
    await expect(page.locator('.advisor .class-block').first()).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('log').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.screenshot({ path: testInfo.outputPath('server-advisor-mobile.png'), fullPage: true });
    expect(downloads).toEqual([]); expect(errors).toEqual([]);
  } finally { probe = false; await probes; }
  latencies.sort((a, b) => a - b);
  expect(latencies.length).toBeGreaterThan(5);
  expect(latencies[Math.floor(latencies.length * 0.95)]).toBeLessThan(1000);
  console.log(JSON.stringify({ httpProbes: latencies.length, httpP95Ms: latencies[Math.floor(latencies.length * 0.95)], generatedChunks: frames.filter(({ event }) => event.type === 'delta').length }));
});
