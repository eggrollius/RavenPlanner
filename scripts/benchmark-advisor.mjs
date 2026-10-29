/* global performance, location, navigator, AbortController, AbortSignal */
// Run against a local Vite server. Downloads stay in .local/models (never committed).
// npm run benchmark:advisor -- --base-url=http://127.0.0.1:5175
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const baseURL = process.argv.find((arg) => arg.startsWith('--base-url='))?.split('=')[1] || 'http://127.0.0.1:5173';
const modelIds = (process.argv.find((arg) => arg.startsWith('--models='))?.split('=')[1] || 'qwen,smol').split(',');
const caseNames = process.argv.find((arg) => arg.startsWith('--cases='))?.split('=')[1]?.split(',');
const runtimeSourceSHA256 = createHash('sha256').update((await Promise.all(['model', 'grounding', 'schema'].map((file) => readFile(`src/advisor/${file}.ts`)))).join('\n')).digest('hex');
const browser = await chromium.launchPersistentContext('.local/benchmark-browser', { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error(error.message));
  page.on('console', (message) => { if (message.text().startsWith('benchmark:')) console.log(message.text()); });
  await mkdir('docs/verification', { recursive: true });
  await page.exposeFunction('saveBenchmark', async (results) => writeFile('docs/verification/advisor-model-benchmark.json', JSON.stringify(results, null, 2) + '\n'));
  await page.goto(baseURL);
  const results = await page.evaluate(async ({ modelIds, caseNames, runtimeSourceSHA256 }) => {
    const { LocalModel } = await import('/src/advisor/model.ts');
    const { emptyPlan } = await import('/src/advisor/schema.ts');
    const cases = [
      { name: 'profile', text: "I'm a 4th-year CS student. Plan my schedule. I want Fridays off, I like geology electives, and I hate Professor X.", plan: emptyPlan(), expected: { tool: 'plan', patch: { program: 'CS', year: 4, daysOff: ['Fri'], electiveQuery: 'geology', avoidInstructors: ['X'] } } },
      { name: 'explicit-courses', text: 'I am eligible for COMP 1405, MATH 1007 and ERTH 1006. Take these three courses.', plan: { ...emptyPlan(), daysOff: ['Fri'] }, expected: { tool: 'plan', patch: { addCourses: ['COMP 1405', 'MATH 1007', 'ERTH 1006'], courseCount: 3 } } },
      { name: 'refinement', text: 'Make my Tuesdays lighter, but keep my geology elective.', plan: { ...emptyPlan(), courses: ['COMP 1405', 'ERTH 1006'], courseCount: 2, daysOff: ['Fri'] }, expected: { tool: 'plan', patch: { lightDays: ['Tue'], keepCourses: ['ERTH 1006'] } } },
      { name: 'release', text: 'Fridays are allowed now. Never schedule Professor X. No classes before 10:00.', plan: { ...emptyPlan(), daysOff: ['Fri'], avoidInstructors: ['X'] }, expected: { tool: 'plan', patch: { allowDays: ['Fri'], excludeInstructors: ['X'], earliest: '10:00' } } },
      { name: 'search', text: 'What geology electives are offered this term?', plan: emptyPlan(), expected: { tool: 'search' } },
    ];
    const subset = (actual, expected) => Object.entries(expected).every(([key, value]) => Array.isArray(value) ? JSON.stringify(actual?.[key]) === JSON.stringify(value) : value && typeof value === 'object' ? subset(actual?.[key], value) : actual?.[key] === value);
    const result = { date: new Date().toISOString(), runtimeSourceSHA256, userAgent: navigator.userAgent, results: [] };
    console.log('benchmark: storage', JSON.stringify(await navigator.storage.estimate()));
    for (const id of modelIds) {
      const model = new LocalModel();
      const start = performance.now();
      let lastProgress = '';
      await model.load(id, (text) => { const stage = text.startsWith('Downloading') ? text.split('/')[0].replace(/\d+/g, (n) => String(Math.floor(Number(n) / 100) * 100)) : text; if (stage !== lastProgress) { console.log('benchmark:', id, text); lastProgress = stage; } }, new AbortController().signal, `${location.origin}/.local/models/${id}.gguf`);
      console.log('benchmark:', id, 'loaded');
      const loadMs = Math.round(performance.now() - start);
      const casesResult = [];
      for (const test of cases.filter((test) => !caseNames || caseNames.includes(test.name))) {
        const began = performance.now();
        try {
          const decision = await model.decide({ plan: test.plan, messages: [{ role: 'user', content: test.text }], observations: [] }, AbortSignal.timeout(180000));
          const normalized = JSON.parse(JSON.stringify(decision));
          if (normalized.patch?.electiveQuery === 'ERTH') normalized.patch.electiveQuery = 'geology';
          const extraFields = decision.tool === 'plan' && Object.keys(decision.patch).some((key) => !Object.hasOwn(test.expected.patch || {}, key));
          const groundedQuery = decision.tool !== 'search' || /geolog|\berth\b|\bearth\b/i.test(decision.query);
          casesResult.push({ name: test.name, ms: Math.round(performance.now() - began), pass: subset(normalized, test.expected) && !extraFields && groundedQuery, decision });
        } catch (error) { casesResult.push({ name: test.name, ms: Math.round(performance.now() - began), pass: false, error: String(error) }); }
        console.log('benchmark:', id, JSON.stringify(casesResult.at(-1)));
      }
      result.results.push({ model: id, loadMs, threads: model.threads, cases: casesResult });
      await globalThis.saveBenchmark(result);
      await model.clearCache();
    }
    return result;
  }, { modelIds, caseNames, runtimeSourceSHA256 });
  await mkdir('docs/verification', { recursive: true });
  await writeFile('docs/verification/advisor-model-benchmark.json', JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
